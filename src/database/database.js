import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPitchChannels,
  syncPitchChannels,
} from "../config/pitch-channels.js";
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const defaultDatabasePath = path.resolve(
  process.env.DATABASE_PATH || path.join(projectRoot, "data/pitchary.sqlite"),
);
export function openDatabase(
  filename = defaultDatabasePath,
  { channelConfigPath } = {},
) {
  const channelDefinitions = loadPitchChannels(channelConfigPath);
  if (filename !== ":memory:")
    mkdirSync(path.dirname(path.resolve(filename)), {
      recursive: true,
      mode: 0o700,
    });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
  );
  const folder = fileURLToPath(new URL("./migrations/", import.meta.url));
  const files = readdirSync(folder)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  let current = db.prepare("PRAGMA user_version").get().user_version;
  if (current > files.length) {
    db.close();
    throw new Error("Database schema is newer than this application.");
  }
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (version <= current) continue;
    const sql = readFileSync(path.join(folder, file), "utf8");
    const rebuild = sql.startsWith("-- foreign_keys=OFF");
    // SQLite requires this outside the transaction when rebuilding FK tables.
    if (rebuild) db.exec("PRAGMA foreign_keys = OFF");
    try {
      transaction(db, () => {
        let migration = sql;
        if (file === "011_import_source_id.sql") {
          const columns = db
            .prepare("PRAGMA table_info(finance_invoices)")
            .all();
          if (columns.some(({ name }) => name === "source_legacy_id"))
            migration = "SELECT 1;";
          else {
            // Existing schemas used a product-specific source ID column.
            // Keep its import UUID namespace so repeated imports retain IDs.
            const sources = columns.filter(({ name }) =>
              /^source_[a-z_]+_id$/i.test(name),
            );
            if (sources.length !== 1)
              throw new Error(
                "Cannot identify the invoice import source column.",
              );
            const name = sources[0].name;
            if (name !== "source_import_id")
              db.prepare(
                "INSERT INTO finance_settings(key,value,updated_at) VALUES('legacy_import_namespace',?,?) ON CONFLICT(key) DO NOTHING",
              ).run(name.slice(7, -3), new Date().toISOString());
            migration = sql.replace("source_import_id", `"${name}"`);
          }
        }
        db.exec(migration);
        if (db.prepare("PRAGMA foreign_key_check").all().length)
          throw new Error(`Foreign key violation after migration ${file}.`);
        db.exec(`PRAGMA user_version = ${version}`);
      });
    } catch (error) {
      db.close();
      throw error;
    } finally {
      if (rebuild && db.isOpen) db.exec("PRAGMA foreign_keys = ON");
    }
    current = version;
  }
  try {
    transaction(db, () => syncPitchChannels(db, channelDefinitions));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = callback();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
