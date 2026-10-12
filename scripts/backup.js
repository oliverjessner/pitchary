import { backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { openDatabase, projectRoot } from "../src/database/database.js";
const target = path.resolve(
  process.argv[2] ??
    path.join(
      projectRoot,
      "backups",
      `pitchary-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
    ),
);
if (existsSync(target))
  throw new Error("Zieldatei existiert bereits; kein Überschreiben.");
mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const db = openDatabase();
try {
  await backup(db, target);
  console.log(`Backup erstellt: ${target}`);
} finally {
  db.close();
}
