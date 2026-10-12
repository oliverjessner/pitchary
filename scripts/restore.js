import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw new Error(
    "Aufruf: npm run restore -- BACKUP.sqlite NEUE-DATENBANK.sqlite",
  );
if (!existsSync(source) || existsSync(destination))
  throw new Error(
    "Quelle muss existieren; Ziel muss neu sein. Server vor dem Wechsel stoppen.",
  );
const db = new DatabaseSync(path.resolve(source), { readOnly: true });
try {
  if (
    db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw new Error("Backup ist beschädigt.");
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='customer_services'",
      )
      .get()
  )
    throw new Error("Keine Pitchary-Datenbank.");
  mkdirSync(path.dirname(path.resolve(destination)), {
    recursive: true,
    mode: 0o700,
  });
  await backup(db, path.resolve(destination));
  console.log(`Wiederhergestellt: ${path.resolve(destination)}`);
} finally {
  db.close();
}
