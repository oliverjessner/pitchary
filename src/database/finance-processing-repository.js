import { transaction } from "./database.js";

export function createFinanceProcessingRepository(db) {
  return {
    databasePath() {
      return db.location("main");
    },
    setting(key) {
      return (
        db.prepare("SELECT value FROM finance_settings WHERE key=?").get(key)
          ?.value ?? ""
      );
    },
    saveSetting(key, value, now) {
      return db
        .prepare(
          "INSERT INTO finance_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .run(key, value, now);
    },
    removeSetting(key) {
      return db.prepare("DELETE FROM finance_settings WHERE key=?").run(key);
    },
    findByPath(filename, category) {
      return (
        db
          .prepare(
            "SELECT id,file_hash,file_modified_at,ingestion_status FROM finance_invoices WHERE file_path=? AND category=?",
          )
          .get(filename, category) ?? null
      );
    },
    findByHash(hash, category) {
      return (
        db
          .prepare(
            "SELECT id,file_hash,file_modified_at,ingestion_status FROM finance_invoices WHERE file_hash=? AND category=? ORDER BY created_at LIMIT 1",
          )
          .get(hash, category) ?? null
      );
    },
    folderInvoices(category) {
      return db
        .prepare(
          "SELECT id,file_path FROM finance_invoices WHERE category=? AND file_path IS NOT NULL AND ingestion_status!='missing'",
        )
        .all(category);
    },
    transaction(callback) {
      return transaction(db, callback);
    },
  };
}
