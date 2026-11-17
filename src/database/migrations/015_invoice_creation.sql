ALTER TABLE finance_customer_profiles ADD COLUMN additional_name TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN street TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN country_code TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN vat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN tax_id TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN customer_number TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN invoice_email TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN endpoint_id TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN endpoint_scheme TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_customer_profiles ADD COLUMN buyer_reference TEXT NOT NULL DEFAULT '';

CREATE TABLE invoice_documents (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','issued')),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 invoice_id TEXT UNIQUE REFERENCES finance_invoices(id) ON DELETE RESTRICT,
 xml_data BLOB,
 validation_json TEXT CHECK(validation_json IS NULL OR json_valid(validation_json)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((state='draft' AND invoice_id IS NULL) OR (state='issued' AND invoice_id IS NOT NULL))
) STRICT;
CREATE TABLE invoice_document_lines (
 document_id TEXT NOT NULL REFERENCES invoice_documents(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>0),
 customer_service_id TEXT REFERENCES customer_services(id) ON DELETE SET NULL,
 line_json TEXT NOT NULL CHECK(json_valid(line_json)),
 PRIMARY KEY(document_id,position)
) STRICT;
CREATE INDEX invoice_document_customer ON invoice_documents(customer_id,state);
CREATE INDEX invoice_line_relationship ON invoice_document_lines(customer_service_id);
CREATE TRIGGER invoice_document_immutable BEFORE UPDATE ON invoice_documents
 WHEN OLD.state='issued' AND (
  NEW.state IS NOT OLD.state OR NEW.content_json IS NOT OLD.content_json OR
  NEW.version IS NOT OLD.version OR NEW.invoice_id IS NOT OLD.invoice_id OR
  NEW.xml_data IS NOT OLD.xml_data OR NEW.validation_json IS NOT OLD.validation_json OR
  NEW.created_at IS NOT OLD.created_at
 ) BEGIN SELECT RAISE(ABORT,'Issued invoice document is immutable'); END;
CREATE TRIGGER invoice_document_delete BEFORE DELETE ON invoice_documents
 WHEN OLD.state='issued'
 BEGIN SELECT RAISE(ABORT,'Issued invoice document is immutable'); END;
CREATE TRIGGER invoice_document_line_update BEFORE UPDATE ON invoice_document_lines
 WHEN EXISTS(SELECT 1 FROM invoice_documents WHERE id=OLD.document_id AND state='issued') AND (
  NEW.document_id IS NOT OLD.document_id OR NEW.position IS NOT OLD.position OR NEW.line_json IS NOT OLD.line_json
 ) BEGIN SELECT RAISE(ABORT,'Issued invoice lines are immutable'); END;
CREATE TRIGGER invoice_document_line_delete BEFORE DELETE ON invoice_document_lines
 WHEN EXISTS(SELECT 1 FROM invoice_documents WHERE id=OLD.document_id AND state='issued')
 BEGIN SELECT RAISE(ABORT,'Issued invoice lines are immutable'); END;
CREATE TRIGGER invoice_document_line_insert BEFORE INSERT ON invoice_document_lines
 WHEN EXISTS(SELECT 1 FROM invoice_documents WHERE id=NEW.document_id AND state='issued')
 BEGIN SELECT RAISE(ABORT,'Issued invoice lines are immutable'); END;
