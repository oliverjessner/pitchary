import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const defaultDatabasePath = path.resolve(
  process.env.DATABASE_PATH || path.join(projectRoot, "data/pitchary.sqlite"),
);
export function openDatabase(filename = defaultDatabasePath) {
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
    transaction(db, () =>
      db.exec(
        `${readFileSync(path.join(folder, file), "utf8")}\nPRAGMA user_version = ${version};`,
      ),
    );
    current = version;
  }
  return db;
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
