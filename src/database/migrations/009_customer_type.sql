ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'lead'
 CHECK(customer_type IN ('lead','customer'));

CREATE VIEW finance_invoice_customer_classification AS
 SELECT i.id,
  CASE WHEN customer.invoice_id IS NOT NULL
   THEN json_extract(customer.override_value,'$') ELSE i.customer_id END AS customer_id,
  CASE WHEN category.invoice_id IS NOT NULL
   THEN json_extract(category.override_value,'$') ELSE i.category END AS category
 FROM finance_invoices i
 LEFT JOIN finance_invoice_overrides customer ON customer.invoice_id=i.id AND customer.field_name='customer_id'
 LEFT JOIN finance_invoice_overrides category ON category.invoice_id=i.id AND category.field_name='category';

UPDATE customers SET customer_type='customer'
 WHERE id IN (SELECT customer_id FROM finance_invoice_customer_classification WHERE category='revenue');

CREATE TRIGGER permanent_customer_type BEFORE UPDATE OF customer_type ON customers
 WHEN OLD.customer_type='customer' AND NEW.customer_type!='customer'
 BEGIN SELECT RAISE(ABORT,'Customer classification is permanent'); END;
