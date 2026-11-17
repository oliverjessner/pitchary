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
const initializingProfile = new WeakSet();
const insertingEntity = new WeakSet();
const numberingTriggers = new Set([
  "customer_number_on_create",
  "customer_number_profile_insert",
  "customer_number_profile_update",
]);

// This capability stays inside the INSERT-only repository. It can initialize
// an email once for an ID that repository has just inserted, then is revoked.
// The SQL statement is fixed; no supplied SQL runs while authorization is open.
export function createMCPProfileInitialization(db) {
  const created = new Set();
  return {
    insert(callback) {
      insertingEntity.add(db);
      try {
        return callback();
      } finally {
        insertingEntity.delete(db);
      }
    },
    created(id) {
      created.add(id);
    },
    initialize(id, email, at) {
      if (!created.delete(id) || !db.isTransaction)
        throw new Error(
          "New customer profile initialization requires its creation transaction.",
        );
      if (!email) return;
      initializingProfile.add(db);
      try {
        db.prepare(
          "UPDATE finance_customer_profiles SET general_email=?,updated_at=? WHERE customer_id=?",
        ).run(email, at, id);
      } finally {
        initializingProfile.delete(db);
      }
    },
  };
}

export function restrictMCPDatabase(db) {
  if (typeof db.setAuthorizer !== "function")
    throw new Error(
      "Pitchary MCP requires Node.js 26 with SQLite authorization support.",
    );
  db.setAuthorizer((action, table, value, database, trigger) => {
    // Unknown triggers must never gain write access through a permitted insert.
    if (
      trigger &&
      action === constants.SQLITE_INSERT &&
      !(
        trigger === "customer_number_on_create" &&
        table === "finance_customer_profiles"
      )
    )
      return constants.SQLITE_DENY;
    if (database && database !== "main") return constants.SQLITE_DENY;
    if (action === constants.SQLITE_READ)
      return readableTables.has(table) ||
        (table === "customer_number_sequence" &&
          numberingTriggers.has(trigger) &&
          ["id", "next_value"].includes(value)) ||
        pitchCountColumns.get(table)?.has(value) ||
        // SQLite checks this nullable foreign key when inserting a new profile.
        (table === "finance_invoices" && value === "id") ||
        // Parent inserts check outstanding child foreign keys without exposing
        // any invoice content or amounts to the MCP.
        (insertingEntity.has(db) &&
          ((table === "invoice_documents" &&
            ["customer_id", "employee_id"].includes(value)) ||
            (table === "finance_invoices" && value === "customer_id") ||
            (table === "customer_services" &&
              ["customer_id", "primary_employee_id"].includes(value)) ||
            (table === "activities" && value === "employee_id")))
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    if (action === constants.SQLITE_INSERT)
      return insertableTables.has(table)
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION)
      return functions.has(value) ||
        (numberingTriggers.has(trigger) &&
          ["printf", "substr", "upper", "max", "glob"].includes(value))
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    if (action === constants.SQLITE_UPDATE)
      return (table === "customer_number_sequence" &&
        [
          "customer_number_profile_insert",
          "customer_number_profile_update",
        ].includes(trigger) &&
        value === "next_value") ||
        (table === "finance_customer_profiles" &&
          !trigger &&
          initializingProfile.has(db) &&
          ["general_email", "updated_at"].includes(value))
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
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
    for (const table of [
      ...readableTables,
      ...pitchCountColumns.keys(),
      "customer_number_sequence",
    ]) {
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
