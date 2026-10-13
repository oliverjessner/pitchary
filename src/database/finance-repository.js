import { transaction } from "./database.js";

export const financeInvoiceColumns = [
  "id",
  ...[
    "source_billly_id",
    "file_path",
    "file_name",
    "pdf_data",
    "file_hash",
    "file_modified_at",
    "ingestion_status",
    "ocr_text",
    "extracted_json",
    "confidence_score",
    "extraction_notes",
    "created_at",
    "updated_at",
  ],
  ...[
    "category",
    "invoice_number",
    "invoice_date",
    "due_date",
    "counterparty_name",
    "total_amount_minor",
    "currency",
    "tax_amount_minor",
    "net_amount_minor",
    "status",
    "paid_at",
    "send_date",
    "document_language",
    "tags",
    "customer_id",
    "customer_service_id",
  ],
];
const projection =
  financeInvoiceColumns.filter((key) => key !== "pdf_data").join(",") +
  ",pdf_data IS NOT NULL AS has_file";
export function createFinanceRepository(db) {
  let savepoint = 0;
  let operationDepth = 0;
  const pendingClassification = new Set();
  const promoteCustomer = db.prepare(
    "UPDATE customers SET customer_type='customer' WHERE customer_type='lead' AND id IN (SELECT customer_id FROM finance_invoice_customer_classification WHERE id=? AND category='revenue')",
  );
  const flushClassification = () => {
    for (const id of pendingClassification) promoteCustomer.run(id);
    pendingClassification.clear();
  };
  const invoiceStatement = (sql, idIndex) => {
    const statement = db.prepare(sql);
    return {
      run(...args) {
        const result = statement.run(...args);
        pendingClassification.add(args[idIndex]);
        if (!operationDepth && !db.isTransaction) flushClassification();
        return result;
      },
    };
  };
  const repo = {
    databasePath: db.location("main"),
    customer: db.prepare(
      "SELECT id,name,note,website,logo_mime,logo_data IS NOT NULL AS has_logo,created_at,updated_at,archived_at,customer_type FROM customers WHERE id=?",
    ),
    invoice: db.prepare(
      `SELECT ${projection} FROM finance_invoices WHERE id=?`,
    ),
    overrides: db.prepare(
      "SELECT field_name,override_value FROM finance_invoice_overrides WHERE invoice_id=? ORDER BY field_name",
    ),
    customerName: db.prepare("SELECT name FROM customers WHERE id=?"),
    relationship: db.prepare(
      "SELECT cs.id,cs.customer_id,cs.status,s.name AS service_name FROM customer_services cs JOIN services s ON s.id=cs.service_id WHERE cs.id=?",
    ),
    invoices: db.prepare(
      `SELECT ${projection} FROM finance_invoices ORDER BY created_at DESC,id`,
    ),
    relationshipCustomer: db.prepare(
      "SELECT customer_id FROM customer_services WHERE id=?",
    ),
    companyName: db.prepare(
      "SELECT value FROM finance_settings WHERE key='company_name'",
    ),
    customerAliases: db.prepare(
      "SELECT value FROM finance_settings WHERE key='finance_customer_aliases'",
    ),
    saveCustomerAliases: db.prepare(
      "INSERT INTO finance_settings(key,value,updated_at) VALUES('finance_customer_aliases',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    ),
    customerCandidates: db.prepare(
      "SELECT id,name,archived_at FROM customers ORDER BY archived_at IS NOT NULL,created_at,id",
    ),
    insertCustomer: db.prepare(
      "INSERT INTO customers(id,name,note,website,created_at,updated_at,archived_at) VALUES(?,?,'','',?,?,NULL)",
    ),
    saveOverride: db.prepare(
      "INSERT INTO finance_invoice_overrides(invoice_id,field_name,override_value,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(invoice_id,field_name) DO UPDATE SET override_value=excluded.override_value,updated_at=excluded.updated_at",
    ),
    setInvoiceCustomer: invoiceStatement(
      "UPDATE finance_invoices SET customer_id=? WHERE id=?",
      1,
    ),
    profile: db.prepare(
      "SELECT billing_address,general_email,enrichment_status,enriched_at,enrichment_invoice_id,created_at AS profile_created_at,updated_at AS profile_updated_at FROM finance_customer_profiles WHERE customer_id=?",
    ),
    billlyInvoice: db.prepare(
      "SELECT id FROM finance_invoices WHERE source_billly_id=?",
    ),
    touchInvoice: invoiceStatement(
      "UPDATE finance_invoices SET updated_at=? WHERE id=?",
      1,
    ),
    clearOverrides: db.prepare(
      "DELETE FROM finance_invoice_overrides WHERE invoice_id=?",
    ),
    clearOverride: db.prepare(
      "DELETE FROM finance_invoice_overrides WHERE invoice_id=? AND field_name=?",
    ),
    clearPaymentDate: db.prepare(
      "DELETE FROM finance_invoice_overrides WHERE invoice_id=? AND field_name='paid_at'",
    ),
    clearAssociationOverrides: db.prepare(
      "DELETE FROM finance_invoice_overrides WHERE invoice_id=? AND field_name IN ('customer_id','customer_service_id')",
    ),
    ignoredDocuments: db.prepare(
      "SELECT value FROM finance_settings WHERE key='finance_ignored_docs'",
    ),
    saveIgnoredDocuments: db.prepare(
      "INSERT INTO finance_settings(key,value,updated_at) VALUES('finance_ignored_docs',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    ),
    deleteInvoice: db.prepare("DELETE FROM finance_invoices WHERE id=?"),
    invoiceFile: db.prepare(
      "SELECT pdf_data,file_name FROM finance_invoices WHERE id=?",
    ),
    insertLog: db.prepare(
      "INSERT INTO finance_processing_logs(id,invoice_id,process_type,status,message,created_at) VALUES(?,?,?,?,?,?)",
    ),
    importLog: db.prepare(
      "INSERT INTO finance_processing_logs(id,invoice_id,process_type,status,message,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    ),
    invoiceLogs: db.prepare(
      "SELECT * FROM finance_processing_logs WHERE invoice_id=? ORDER BY created_at DESC,rowid DESC",
    ),
    profileCustomerIds: db.prepare(
      "SELECT customer_id FROM finance_customer_profiles",
    ),
    customers: db.prepare(
      "SELECT id,name,note,website,logo_mime,logo_data IS NOT NULL AS has_logo,created_at,updated_at,archived_at,customer_type FROM customers ORDER BY name COLLATE NOCASE,id",
    ),
    employees: db.prepare(
      "SELECT * FROM employees WHERE customer_id=? ORDER BY name COLLATE NOCASE,id",
    ),
    renameCustomer: db.prepare(
      "UPDATE customers SET name=?,updated_at=? WHERE id=?",
    ),
    saveProfile: db.prepare(
      "INSERT INTO finance_customer_profiles(customer_id,billing_address,general_email,enrichment_status,enriched_at,enrichment_invoice_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET billing_address=excluded.billing_address,general_email=excluded.general_email,enrichment_status=excluded.enrichment_status,enriched_at=excluded.enriched_at,enrichment_invoice_id=excluded.enrichment_invoice_id,updated_at=excluded.updated_at",
    ),
    customerId: db.prepare("SELECT id FROM customers WHERE id=?"),
    contactCandidates: db.prepare(
      "SELECT id,name,email FROM employees WHERE customer_id=? ORDER BY archived_at IS NOT NULL,created_at,id",
    ),
    setEmployeeEmail: db.prepare(
      "UPDATE employees SET email=?,updated_at=? WHERE id=?",
    ),
    employeeId: db.prepare("SELECT id FROM employees WHERE id=?"),
    insertEmployee: db.prepare(
      "INSERT INTO employees(id,customer_id,name,email,position,linkedin,created_at,updated_at,archived_at) VALUES(?,?,?,?,'','',?,?,NULL)",
    ),
    atomic(callback) {
      const previous = new Set(pendingClassification);
      const execute = () => {
        operationDepth++;
        try {
          const value = callback();
          // Classify only final effective invoice values. A Billly import or
          // batch reassignment can stage several corrections in nested calls.
          if (operationDepth === 1) flushClassification();
          return value;
        } finally {
          operationDepth--;
        }
      };
      try {
        if (!db.isTransaction) return transaction(db, execute);
        const name = `finance_${++savepoint}`;
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
      } catch (error) {
        pendingClassification.clear();
        for (const id of previous) pendingClassification.add(id);
        throw error;
      }
    },
    saveInvoice(keys, values) {
      if (
        !keys.length ||
        keys.some((key) => !financeInvoiceColumns.includes(key))
      )
        throw new Error("Unknown invoice column");
      db.prepare(
        `INSERT INTO finance_invoices(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((key) => !["id", "created_at"].includes(key))
          .map((key) => `${key}=excluded.${key}`)
          .join(",")}`,
      ).run(...values);
      pendingClassification.add(values[keys.indexOf("id")]);
      if (!operationDepth && !db.isTransaction) flushClassification();
    },
  };
  return repo;
}
