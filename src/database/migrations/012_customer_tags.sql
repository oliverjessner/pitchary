CREATE TABLE customer_tag_assignments (
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 tag_id TEXT NOT NULL REFERENCES service_tags(id) ON DELETE CASCADE,
 PRIMARY KEY(customer_id,tag_id)
) STRICT;
CREATE INDEX customer_tags_usage ON customer_tag_assignments(tag_id,customer_id);
