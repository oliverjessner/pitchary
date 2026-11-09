import { statSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, constants } from "node:sqlite";

const readableTables = new Set([
  "customers",
  "employees",
  "services",
  "service_tags",
  "customer_tag_assignments",
  "service_tag_assignments",
  "finance_customer_profiles",
  "pitch_channels",
]);
// Service pitch totals need only relationship keys and event classifications.
// Keep notes, prices and the rest of these records inaccessible to the MCP.
const pitchCountColumns = new Map([
  ["customer_services", new Set(["id", "service_id", ""])],
  [
    "customer_service_status_history",
    new Set(["customer_service_id", "to_status", ""]),
  ],
  ["activities", new Set(["customer_service_id", "type", ""])],
]);
const insertableTables = new Set([
  "customers",
  "employees",
  "services",
  "customer_tag_assignments",
  "service_tag_assignments",
  "finance_customer_profiles",
]);
const functions = new Set(["length", "trim", "coalesce", "count", "like"]);

export function restrictMCPDatabase(db) {
  if (typeof db.setAuthorizer !== "function")
    throw new Error(
      "Pitchary MCP requires Node.js 26 with SQLite authorization support.",
    );
  db.setAuthorizer((action, table, value, database, trigger) => {
    // Unknown triggers must never gain write access through a permitted insert.
    if (trigger && action === constants.SQLITE_INSERT)
      return constants.SQLITE_DENY;
    if (database && database !== "main") return constants.SQLITE_DENY;
    if (action === constants.SQLITE_READ)
      return readableTables.has(table) ||
        pitchCountColumns.get(table)?.has(value) ||
        // SQLite checks this nullable foreign key when inserting a new profile.
        (table === "finance_invoices" && value === "id")
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    if (action === constants.SQLITE_INSERT)
      return insertableTables.has(table)
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION)
      return functions.has(value) ? constants.SQLITE_OK : constants.SQLITE_DENY;
    if (
      action === constants.SQLITE_SELECT ||
      action === constants.SQLITE_TRANSACTION
    )
      return constants.SQLITE_OK;
    // In particular: UPDATE, DELETE, PRAGMA, ATTACH and every schema change.
    return constants.SQLITE_DENY;
  });
  return db;
}

export function openMCPDatabase(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename))
    throw new Error(
      "Provide an absolute existing database path with --database or DATABASE_PATH.",
    );
  if (!statSync(filename).isFile())
    throw new Error("MCP database must be an existing regular file.");
  const db = new DatabaseSync(filename, {
    timeout: 5000,
    enableForeignKeyConstraints: true,
    allowExtension: false,
    defensive: true,
  });
  try {
    // Read schema metadata only. Starting the MCP never runs migrations or
    // synchronizes channel configuration; the application owns those writes.
    const migrations = readdirSync(
      new URL("../database/migrations/", import.meta.url),
    )
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .map((name) => Number(name.split("_")[0]));
    if (
      db.prepare("PRAGMA user_version").get().user_version !==
      Math.max(...migrations)
    )
      throw new Error(
        "Database schema does not match this Pitchary version. Open the database in the matching Pitchary application first.",
      );
    for (const table of [...readableTables, ...pitchCountColumns.keys()]) {
      const row = db
        .prepare("SELECT type FROM sqlite_schema WHERE name=?")
        .get(table);
      if (row?.type !== "table")
        throw new Error("Database is not a supported Pitchary database.");
    }
    return restrictMCPDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
