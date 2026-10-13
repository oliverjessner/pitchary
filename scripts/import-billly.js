import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  defaultDatabasePath,
  openDatabase,
  projectRoot,
} from "../src/database/database.js";
import { createFinance } from "../src/business/finance.js";
import { inspectBillly, importBillly } from "../src/business/billly-import.js";
import { defaultBilllySource } from "../src/config/billly-source.js";

function argumentsFrom(argv) {
  const result = {
    source: defaultBilllySource(),
    database: defaultDatabasePath,
    apply: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--apply") result.apply = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else if (argument === "--source" || argument === "--database") {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} benötigt einen Dateipfad.`);
      result[argument.slice(2)] = path.resolve(value);
    } else throw new Error(`Unbekanntes Argument: ${argument}`);
  }
  return result;
}

async function run() {
  const options = argumentsFrom(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Billly-Import (standardmäßig nur Prüfung)\n\nnode scripts/import-billly.js [--source /pfad/billly.sqlite] [--database /pfad/pitchary.sqlite] [--apply]\n\n--apply erstellt zuerst ein Backup der vorhandenen Pitchary-Datenbank. Die Quelle bleibt unverändert. E-Mail-Funktionen und Zugangsdaten werden nicht übernommen.",
    );
    return;
  }
  const inspected = inspectBillly(options.source);
  const source = realpathSync(options.source);
  const target = path.resolve(options.database);
  if ((existsSync(target) ? realpathSync(target) : target) === source)
    throw new Error("Quell- und Zieldatenbank müssen verschieden sein.");
  if (!options.apply) {
    console.log(
      JSON.stringify(
        { ...inspected, dry_run: true, imported: 0, skipped: 0 },
        null,
        2,
      ),
    );
    return;
  }

  let backupPath = null;
  if (existsSync(target)) {
    const backupFolder =
      target === defaultDatabasePath
        ? path.join(projectRoot, "backups")
        : path.join(path.dirname(target), "backups");
    mkdirSync(backupFolder, { recursive: true, mode: 0o700 });
    backupPath = path.join(
      backupFolder,
      `pitchary-before-billly-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
    );
    if (existsSync(backupPath))
      throw new Error("Die Backup-Datei existiert bereits.");
    const original = new DatabaseSync(target, { readOnly: true });
    try {
      await backup(original, backupPath);
      chmodSync(backupPath, 0o600);
    } finally {
      original.close();
    }
  }
  const db = openDatabase(target);
  try {
    const result = importBillly(source, createFinance(db), { dryRun: false });
    console.log(
      JSON.stringify({ ...result, backup_path: backupPath }, null, 2),
    );
  } finally {
    db.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
