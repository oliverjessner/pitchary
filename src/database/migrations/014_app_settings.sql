CREATE TABLE app_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 language TEXT NOT NULL CHECK(language IN ('de','en')),
 updated_at TEXT NOT NULL
) STRICT;
INSERT INTO app_settings(id,language,updated_at) VALUES(1,'de',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
