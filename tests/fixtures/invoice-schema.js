// Only used when rebuilding historical test databases from a current schema.
// The fixtures contain no authored invoices; production never downgrades data.
export function removeInvoiceCreationSchema(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS customer_number_on_create;
    DROP TRIGGER IF EXISTS customer_number_profile_insert;
    DROP TRIGGER IF EXISTS customer_number_profile_update;
    DROP INDEX IF EXISTS finance_customer_number_unique;
    DROP TABLE IF EXISTS customer_number_sequence;
  `);
  db.exec("DROP TABLE invoice_document_lines; DROP TABLE invoice_documents;");
  for (const column of [
    "additional_name",
    "street",
    "postal_code",
    "city",
    "country_code",
    "vat_id",
    "tax_id",
    "customer_number",
    "invoice_email",
    "endpoint_id",
    "endpoint_scheme",
    "buyer_reference",
  ])
    db.exec(`ALTER TABLE finance_customer_profiles DROP COLUMN ${column}`);
}
