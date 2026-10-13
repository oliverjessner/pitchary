import { DatabaseSync } from "node:sqlite";

const readableTables = new Set([
  "invoices",
  "invoice_overrides",
  "customers",
  "customer_contacts",
  "settings",
]);
const nonSecretSettingKeys = [
  "revenue_folder",
  "payable_folder",
  "company_name",
  "company_address",
  "company_email",
];

/** A consistent, read-only view of one legacy Billly database. */
export function openBilllyRepository(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; BEGIN;");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    const columns = (table) => {
      if (!readableTables.has(table))
        throw new Error("Unsupported Billly table.");
      return new Set(
        tables.has(table)
          ? db
              .prepare(`PRAGMA table_info(${table})`)
              .all()
              .map((row) => row.name)
          : [],
      );
    };
    return {
      canonical: filename,
      tables,
      columns,
      schemaVersion() {
        return db.prepare("PRAGMA user_version").get().user_version;
      },
      invoices() {
        return db
          .prepare("SELECT * FROM invoices ORDER BY created_at, id")
          .all();
      },
      overrides() {
        return tables.has("invoice_overrides")
          ? db
              .prepare(
                "SELECT invoice_id, field_name, override_value FROM invoice_overrides ORDER BY invoice_id, field_name",
              )
              .all()
          : [];
      },
      customers() {
        return tables.has("customers")
          ? db.prepare("SELECT * FROM customers ORDER BY id").all()
          : [];
      },
      contacts() {
        return tables.has("customer_contacts")
          ? db
              .prepare(
                "SELECT id, customer_id, name, email FROM customer_contacts",
              )
              .all()
          : [];
      },
      nonSecretSettings() {
        const fields = columns("settings");
        if (!fields.has("key") || !fields.has("value")) return {};
        const statement = db.prepare(
          "SELECT value FROM settings WHERE key = ?",
        );
        const result = {};
        // Credential, OAuth and mail settings are never queried.
        for (const key of nonSecretSettingKeys) {
          const row = statement.get(key);
          if (row) result[key] = row.value;
        }
        return result;
      },
      close() {
        if (db.isOpen) db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
