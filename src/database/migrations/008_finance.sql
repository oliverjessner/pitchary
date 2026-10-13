CREATE TABLE finance_invoices (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 source_billly_id TEXT UNIQUE,
 category TEXT NOT NULL CHECK(category IN ('revenue','payable')),
 file_path TEXT,
 file_name TEXT NOT NULL DEFAULT '',
 pdf_data BLOB,
 file_hash TEXT NOT NULL DEFAULT '',
 file_modified_at TEXT,
 ingestion_status TEXT NOT NULL DEFAULT 'pending' CHECK(ingestion_status IN ('pending','processed','failed','missing')),
 ocr_text TEXT,
 extracted_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extracted_json)),
 confidence_score REAL NOT NULL DEFAULT 0 CHECK(confidence_score BETWEEN 0 AND 1),
 invoice_number TEXT,
 invoice_date TEXT,
 due_date TEXT,
 counterparty_name TEXT,
 total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(total_amount_minor BETWEEN -1000000000000 AND 1000000000000),
 currency TEXT NOT NULL DEFAULT 'EUR' CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*'),
 tax_amount_minor INTEGER CHECK(tax_amount_minor IS NULL OR tax_amount_minor BETWEEN -1000000000000 AND 1000000000000),
 net_amount_minor INTEGER CHECK(net_amount_minor IS NULL OR net_amount_minor BETWEEN -1000000000000 AND 1000000000000),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid')),
 paid_at TEXT,
 send_date TEXT,
 document_language TEXT,
 tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags)='array'),
 extraction_notes TEXT NOT NULL DEFAULT '',
 customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
 customer_service_id TEXT REFERENCES customer_services(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE finance_invoice_overrides (
 invoice_id TEXT NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
 field_name TEXT NOT NULL CHECK(field_name IN ('category','invoice_number','invoice_date','due_date','counterparty_name','total_amount_minor','currency','tax_amount_minor','net_amount_minor','status','paid_at','send_date','document_language','tags','customer_id','customer_service_id')),
 override_value TEXT NOT NULL CHECK(json_valid(override_value)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(invoice_id,field_name)
) STRICT;
CREATE TABLE finance_processing_logs (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 invoice_id TEXT REFERENCES finance_invoices(id) ON DELETE CASCADE,
 process_type TEXT NOT NULL,
 status TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE finance_customer_profiles (
 customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
 billing_address TEXT NOT NULL DEFAULT '',
 general_email TEXT NOT NULL DEFAULT '',
 enrichment_status TEXT NOT NULL DEFAULT 'pending' CHECK(enrichment_status IN ('pending','completed','skipped','failed')),
 enriched_at TEXT,
 enrichment_invoice_id TEXT REFERENCES finance_invoices(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE finance_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX finance_invoice_category_date ON finance_invoices(category,invoice_date);
CREATE INDEX finance_invoice_customer ON finance_invoices(customer_id);
CREATE INDEX finance_invoice_relationship ON finance_invoices(customer_service_id);
CREATE INDEX finance_invoice_hash ON finance_invoices(file_hash);
CREATE INDEX finance_invoice_status ON finance_invoices(status,due_date);
CREATE INDEX finance_log_invoice ON finance_processing_logs(invoice_id,created_at);
CREATE TRIGGER finance_invoice_customer_insert BEFORE INSERT ON finance_invoices
 WHEN NEW.customer_service_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM customer_services WHERE id=NEW.customer_service_id AND customer_id=NEW.customer_id
 ) BEGIN SELECT RAISE(ABORT,'Invoice relationship belongs to another customer'); END;
CREATE TRIGGER finance_invoice_customer_update BEFORE UPDATE OF customer_id,customer_service_id ON finance_invoices
 WHEN NEW.customer_service_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM customer_services WHERE id=NEW.customer_service_id AND customer_id=NEW.customer_id
 ) BEGIN SELECT RAISE(ABORT,'Invoice relationship belongs to another customer'); END;
CREATE TRIGGER finance_relationship_unlink BEFORE DELETE ON customer_services BEGIN
 DELETE FROM finance_invoice_overrides WHERE field_name='customer_service_id' AND json_extract(override_value,'$')=OLD.id;
END;
CREATE TRIGGER finance_customer_unlink BEFORE DELETE ON customers BEGIN
 DELETE FROM finance_invoice_overrides WHERE field_name='customer_id' AND json_extract(override_value,'$')=OLD.id;
END;
