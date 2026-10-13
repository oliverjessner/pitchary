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
        db.exec(sql);
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
