CREATE TABLE service_tags (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 name_key TEXT NOT NULL UNIQUE,
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 color TEXT NOT NULL CHECK(length(color)=7 AND substr(color,1,1)='#' AND substr(color,2) NOT GLOB '*[^0-9a-fA-F]*'),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE service_tag_assignments (
 service_id TEXT NOT NULL REFERENCES services(id),
 tag_id TEXT NOT NULL REFERENCES service_tags(id) ON DELETE CASCADE,
 PRIMARY KEY(service_id,tag_id)
) STRICT;
CREATE INDEX service_tags_usage ON service_tag_assignments(tag_id,service_id);
