-- foreign_keys=OFF
CREATE TABLE pitch_channels (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
 label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
 sort_order INTEGER NOT NULL DEFAULT 999
) STRICT;
INSERT INTO pitch_channels(id,label)
 SELECT pitch_channel,pitch_channel FROM customer_services
 UNION SELECT channel,channel FROM activities WHERE channel IS NOT NULL;
CREATE TABLE customer_services_next (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_id TEXT NOT NULL REFERENCES customers(id), service_id TEXT NOT NULL REFERENCES services(id),
 primary_employee_id TEXT, status TEXT NOT NULL CHECK(status IN ('open','pitched','ghosted','accepted','done','rejected')),
 first_pitched_price_minor INTEGER CHECK(first_pitched_price_minor BETWEEN 0 AND 1000000000000),
 current_offered_price_minor INTEGER NOT NULL CHECK(current_offered_price_minor BETWEEN 0 AND 1000000000000),
 accepted_price_minor INTEGER CHECK(accepted_price_minor BETWEEN 0 AND 1000000000000),
 currency TEXT NOT NULL CHECK(currency IN ('EUR','USD','GBP')),
 billing_type TEXT NOT NULL CHECK(billing_type IN ('one_time','monthly','yearly','hourly','daily')),
 pitch_channel TEXT NOT NULL REFERENCES pitch_channels(id),
 status_since TEXT NOT NULL, rejection_reason TEXT CHECK(rejection_reason IS NULL OR json_valid(rejection_reason)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
 FOREIGN KEY(primary_employee_id,customer_id) REFERENCES employees(id,customer_id),
 CHECK(status NOT IN ('accepted','done') OR accepted_price_minor IS NOT NULL),
 CHECK(status!='rejected' OR rejection_reason IS NOT NULL)
) STRICT;
CREATE TABLE customer_service_status_history_next (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_service_id TEXT NOT NULL REFERENCES customer_services_next(id),
 from_status TEXT CHECK(from_status IS NULL OR from_status IN ('open','pitched','ghosted','accepted','done','rejected')),
 to_status TEXT NOT NULL CHECK(to_status IN ('open','pitched','ghosted','accepted','done','rejected')),
 reason TEXT, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL
) STRICT;
CREATE TABLE activities_next (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_service_id TEXT NOT NULL REFERENCES customer_services_next(id),
 employee_id TEXT REFERENCES employees(id), type TEXT NOT NULL CHECK(type IN ('pitch','follow_up','call','meeting','note','price_change')),
 channel TEXT REFERENCES pitch_channels(id),
 note TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
 price_field TEXT CHECK(price_field IS NULL OR price_field IN ('current_offered_price_minor','accepted_price_minor')),
 previous_price_minor INTEGER CHECK(previous_price_minor IS NULL OR previous_price_minor BETWEEN 0 AND 1000000000000),
 new_price_minor INTEGER CHECK(new_price_minor IS NULL OR new_price_minor BETWEEN 0 AND 1000000000000),
 CHECK((type='price_change' AND price_field IS NOT NULL AND new_price_minor IS NOT NULL) OR (type!='price_change' AND price_field IS NULL AND previous_price_minor IS NULL AND new_price_minor IS NULL))
) STRICT;
INSERT INTO customer_services_next (rowid,id,customer_id,service_id,primary_employee_id,status,first_pitched_price_minor,current_offered_price_minor,accepted_price_minor,currency,billing_type,pitch_channel,status_since,rejection_reason,created_at,updated_at,archived_at) SELECT rowid,* FROM customer_services;
INSERT INTO customer_service_status_history_next (rowid,id,customer_service_id,from_status,to_status,reason,occurred_at,recorded_at) SELECT rowid,* FROM customer_service_status_history;
INSERT INTO activities_next (rowid,id,customer_service_id,employee_id,type,channel,note,occurred_at,created_at,price_field,previous_price_minor,new_price_minor) SELECT rowid,* FROM activities;
DROP TABLE activities;
DROP TABLE customer_service_status_history;
DROP TABLE customer_services;
ALTER TABLE customer_services_next RENAME TO customer_services;
ALTER TABLE customer_service_status_history_next RENAME TO customer_service_status_history;
ALTER TABLE activities_next RENAME TO activities;
CREATE INDEX relationships_customer ON customer_services(customer_id);
CREATE INDEX relationships_service ON customer_services(service_id);
CREATE INDEX relationships_status ON customer_services(status,status_since);
CREATE INDEX relationships_cohort ON customer_services(created_at,pitch_channel);
CREATE INDEX relationships_archive ON customer_services(archived_at);
CREATE INDEX history_relationship ON customer_service_status_history(customer_service_id,occurred_at,recorded_at);
CREATE INDEX activities_relationship ON activities(customer_service_id,occurred_at);
CREATE INDEX activities_occurred ON activities(occurred_at);
CREATE TRIGGER immutable_history_update BEFORE UPDATE ON customer_service_status_history BEGIN SELECT RAISE(ABORT,'Status history is immutable'); END;
CREATE TRIGGER immutable_history_delete BEFORE DELETE ON customer_service_status_history WHEN EXISTS (SELECT 1 FROM customer_services WHERE id=OLD.customer_service_id)
BEGIN SELECT RAISE(ABORT,'Status history is immutable'); END;
CREATE TRIGGER immutable_activity_update BEFORE UPDATE ON activities BEGIN SELECT RAISE(ABORT,'Activities are immutable'); END;
CREATE TRIGGER immutable_activity_delete BEFORE DELETE ON activities WHEN EXISTS (SELECT 1 FROM customer_services WHERE id=OLD.customer_service_id)
BEGIN SELECT RAISE(ABORT,'Activities are immutable'); END;
CREATE TRIGGER activity_customer_insert BEFORE INSERT ON activities WHEN NEW.employee_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM employees e JOIN customer_services cs ON cs.customer_id=e.customer_id WHERE e.id=NEW.employee_id AND cs.id=NEW.customer_service_id
) BEGIN SELECT RAISE(ABORT,'Contact belongs to another customer'); END;
CREATE TRIGGER delete_relationship_events AFTER DELETE ON customer_services BEGIN
 DELETE FROM activities WHERE customer_service_id=OLD.id;
 DELETE FROM customer_service_status_history WHERE customer_service_id=OLD.id;
END;
