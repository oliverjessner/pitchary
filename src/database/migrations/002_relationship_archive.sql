ALTER TABLE customer_services ADD COLUMN archived_at TEXT;
CREATE INDEX relationships_archive ON customer_services(archived_at);
