-- Customer numbers belong to the existing billing profile. Preserve every
-- nonempty legacy identifier and assign new numbers only where none existed.
CREATE TABLE customer_number_sequence (
 id INTEGER PRIMARY KEY CHECK(id=1),
 next_value INTEGER NOT NULL CHECK(next_value BETWEEN 1 AND 1000000000000)
) STRICT;
INSERT INTO customer_number_sequence(id,next_value)
 SELECT 1,COALESCE(MAX(CAST(substr(customer_number,3) AS INTEGER)),0)+1
 FROM finance_customer_profiles
 WHERE upper(substr(customer_number,1,2))='K-'
  AND length(substr(customer_number,3)) BETWEEN 1 AND 12
  AND substr(customer_number,3) NOT GLOB '*[^0-9]*';

INSERT INTO finance_customer_profiles(customer_id,created_at,updated_at)
 SELECT id,created_at,updated_at FROM customers WHERE true
 ON CONFLICT(customer_id) DO NOTHING;
CREATE TEMP TABLE customer_number_backfill AS
 SELECT p.customer_id,(SELECT next_value FROM customer_number_sequence WHERE id=1)
  +row_number() OVER(ORDER BY c.created_at,c.id)-1 AS number
 FROM finance_customer_profiles p JOIN customers c ON c.id=p.customer_id
 WHERE trim(p.customer_number)='';
UPDATE finance_customer_profiles
 SET customer_number=(SELECT printf('K-%05d',number) FROM customer_number_backfill b WHERE b.customer_id=finance_customer_profiles.customer_id)
 WHERE customer_id IN (SELECT customer_id FROM customer_number_backfill);
UPDATE customer_number_sequence SET next_value=next_value+(SELECT count(*) FROM customer_number_backfill) WHERE id=1;
DROP TABLE customer_number_backfill;

CREATE UNIQUE INDEX finance_customer_number_unique
 ON finance_customer_profiles(trim(customer_number) COLLATE NOCASE)
 WHERE customer_number<>'';

CREATE TRIGGER customer_number_profile_insert AFTER INSERT ON finance_customer_profiles
 WHEN upper(substr(NEW.customer_number,1,2))='K-'
  AND length(substr(NEW.customer_number,3)) BETWEEN 1 AND 12
  AND substr(NEW.customer_number,3) NOT GLOB '*[^0-9]*'
 BEGIN
  UPDATE customer_number_sequence SET next_value=max(next_value,CAST(substr(NEW.customer_number,3) AS INTEGER)+1) WHERE id=1;
 END;
CREATE TRIGGER customer_number_profile_update AFTER UPDATE OF customer_number ON finance_customer_profiles
 WHEN upper(substr(NEW.customer_number,1,2))='K-'
  AND length(substr(NEW.customer_number,3)) BETWEEN 1 AND 12
  AND substr(NEW.customer_number,3) NOT GLOB '*[^0-9]*'
 BEGIN
  UPDATE customer_number_sequence SET next_value=max(next_value,CAST(substr(NEW.customer_number,3) AS INTEGER)+1) WHERE id=1;
 END;
CREATE TRIGGER customer_number_on_create AFTER INSERT ON customers
 BEGIN
  SELECT CASE WHEN (SELECT next_value FROM customer_number_sequence WHERE id=1)>999999999999
   THEN RAISE(ABORT,'Customer number sequence is exhausted') END;
  INSERT INTO finance_customer_profiles(customer_id,customer_number,created_at,updated_at)
   VALUES(NEW.id,printf('K-%05d',(SELECT next_value FROM customer_number_sequence WHERE id=1)),NEW.created_at,NEW.updated_at);
 END;

-- Existing issued PDFs/XML and their snapshots are untouched. A former single
-- service day becomes a same-day period only for editable drafts.
UPDATE invoice_documents
 SET content_json=json_remove(json_set(content_json,
  '$.service_period_start',CASE WHEN COALESCE(json_extract(content_json,'$.service_period_start'),'')='' THEN json_extract(content_json,'$.service_date') ELSE json_extract(content_json,'$.service_period_start') END,
  '$.service_period_end',CASE WHEN COALESCE(json_extract(content_json,'$.service_period_end'),'')='' THEN json_extract(content_json,'$.service_date') ELSE json_extract(content_json,'$.service_period_end') END),
  '$.service_date'),version=version+1
 WHERE state='draft' AND COALESCE(json_extract(content_json,'$.service_date'),'')<>'';
