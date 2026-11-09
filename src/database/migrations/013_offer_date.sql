ALTER TABLE customer_services ADD COLUMN offer_date TEXT NOT NULL DEFAULT '';
UPDATE customer_services SET offer_date=substr(created_at,1,10);
