import { transaction } from "./database.js";

export function createCustomerMergeRepository(db) {
  let sequence = 0;
  const repo = {
    customer: db.prepare("SELECT * FROM customers WHERE id=?"),
    profile: db.prepare(
      "SELECT * FROM finance_customer_profiles WHERE customer_id=?",
    ),
    setting: db.prepare("SELECT value FROM finance_settings WHERE key=?"),
    saveSetting: db.prepare(
      "INSERT INTO finance_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    ),
    moveEmployees: db.prepare(
      "UPDATE employees SET customer_id=? WHERE customer_id=?",
    ),
    copyCustomerTags: db.prepare(
      "INSERT OR IGNORE INTO customer_tag_assignments(customer_id,tag_id) SELECT ?,tag_id FROM customer_tag_assignments WHERE customer_id=?",
    ),
    moveRelationships: db.prepare(
      "UPDATE customer_services SET customer_id=? WHERE customer_id=?",
    ),
    moveInvoices: db.prepare(
      "UPDATE finance_invoices SET customer_id=? WHERE customer_id=?",
    ),
    moveInvoiceOverrides: db.prepare(
      "UPDATE finance_invoice_overrides SET override_value=? WHERE field_name='customer_id' AND json_extract(override_value,'$')=?",
    ),
    saveCustomer: db.prepare(
      "UPDATE customers SET note=?,website=?,logo_mime=?,logo_data=?,customer_type=?,updated_at=? WHERE id=?",
    ),
    saveProfile: db.prepare(
      "INSERT INTO finance_customer_profiles(customer_id,billing_address,general_email,enrichment_status,enriched_at,enrichment_invoice_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET billing_address=excluded.billing_address,general_email=excluded.general_email,enrichment_status=excluded.enrichment_status,enriched_at=excluded.enriched_at,enrichment_invoice_id=excluded.enrichment_invoice_id,created_at=excluded.created_at,updated_at=excluded.updated_at",
    ),
    deleteCustomer: db.prepare("DELETE FROM customers WHERE id=?"),
    remainingReferences: db.prepare(
      "SELECT (SELECT count(*) FROM employees WHERE customer_id=?)+(SELECT count(*) FROM customer_services WHERE customer_id=?)+(SELECT count(*) FROM finance_invoices WHERE customer_id=?)+(SELECT count(*) FROM finance_invoice_overrides WHERE field_name='customer_id' AND json_extract(override_value,'$')=?) AS n",
    ),
    effectiveInvoiceLinks: db.prepare(
      "SELECT i.id,CASE WHEN customer.invoice_id IS NOT NULL THEN json_extract(customer.override_value,'$') ELSE i.customer_id END AS customer_id,CASE WHEN relationship.invoice_id IS NOT NULL THEN json_extract(relationship.override_value,'$') ELSE i.customer_service_id END AS customer_service_id,cs.customer_id AS relationship_customer_id FROM finance_invoices i LEFT JOIN finance_invoice_overrides customer ON customer.invoice_id=i.id AND customer.field_name='customer_id' LEFT JOIN finance_invoice_overrides relationship ON relationship.invoice_id=i.id AND relationship.field_name='customer_service_id' LEFT JOIN customer_services cs ON cs.id=CASE WHEN relationship.invoice_id IS NOT NULL THEN json_extract(relationship.override_value,'$') ELSE i.customer_service_id END WHERE (i.customer_id IN (?,?) OR json_extract(customer.override_value,'$') IN (?,?) OR cs.customer_id IN (?,?))",
    ),
    foreignKeyViolations: () => db.prepare("PRAGMA foreign_key_check").all(),
    foreignKeysEnabled: () =>
      Boolean(db.prepare("PRAGMA foreign_keys").get().foreign_keys),
    atomic(callback) {
      const previous = Boolean(
        db.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys,
      );
      const execute = () => {
        db.exec("PRAGMA defer_foreign_keys=ON");
        try {
          return callback();
        } finally {
          db.exec(`PRAGMA defer_foreign_keys=${previous ? "ON" : "OFF"}`);
        }
      };
      if (!db.isTransaction) return transaction(db, execute);
      const name = `customer_merge_${++sequence}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = execute();
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw error;
      }
    },
  };
  return repo;
}
