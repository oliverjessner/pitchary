CREATE TABLE customers (
 id TEXT PRIMARY KEY CHECK(length(id)=36), name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
) STRICT;
CREATE TABLE employees (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_id TEXT NOT NULL REFERENCES customers(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), email TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '', linkedin TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, UNIQUE(id,customer_id)
) STRICT;
CREATE TABLE services (
 id TEXT PRIMARY KEY CHECK(length(id)=36), name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
) STRICT;
CREATE TABLE customer_services (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_id TEXT NOT NULL REFERENCES customers(id), service_id TEXT NOT NULL REFERENCES services(id),
 primary_employee_id TEXT, status TEXT NOT NULL CHECK(status IN ('open','pitched','accepted','done','rejected')),
 first_pitched_price_minor INTEGER CHECK(first_pitched_price_minor BETWEEN 0 AND 1000000000000),
 current_offered_price_minor INTEGER NOT NULL CHECK(current_offered_price_minor BETWEEN 0 AND 1000000000000),
 accepted_price_minor INTEGER CHECK(accepted_price_minor BETWEEN 0 AND 1000000000000),
 currency TEXT NOT NULL CHECK(currency IN ('EUR','USD','GBP')),
 billing_type TEXT NOT NULL CHECK(billing_type IN ('one_time','monthly','yearly','hourly','daily')),
 pitch_channel TEXT NOT NULL CHECK(pitch_channel IN ('linkedin','email','phone','meeting','other')),
 status_since TEXT NOT NULL, rejection_reason TEXT CHECK(rejection_reason IS NULL OR json_valid(rejection_reason)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(primary_employee_id,customer_id) REFERENCES employees(id,customer_id),
 CHECK(status NOT IN ('accepted','done') OR accepted_price_minor IS NOT NULL),
 CHECK(status!='rejected' OR rejection_reason IS NOT NULL)
) STRICT;
CREATE TABLE customer_service_status_history (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_service_id TEXT NOT NULL REFERENCES customer_services(id),
 from_status TEXT CHECK(from_status IS NULL OR from_status IN ('open','pitched','accepted','done','rejected')),
 to_status TEXT NOT NULL CHECK(to_status IN ('open','pitched','accepted','done','rejected')),
 reason TEXT, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL
) STRICT;
CREATE TABLE activities (
 id TEXT PRIMARY KEY CHECK(length(id)=36), customer_service_id TEXT NOT NULL REFERENCES customer_services(id),
 employee_id TEXT REFERENCES employees(id), type TEXT NOT NULL CHECK(type IN ('pitch','follow_up','call','meeting','note','price_change')),
 channel TEXT CHECK(channel IS NULL OR channel IN ('linkedin','email','phone','meeting','other')),
 note TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
 price_field TEXT CHECK(price_field IS NULL OR price_field IN ('current_offered_price_minor','accepted_price_minor')),
 previous_price_minor INTEGER CHECK(previous_price_minor IS NULL OR previous_price_minor BETWEEN 0 AND 1000000000000),
 new_price_minor INTEGER CHECK(new_price_minor IS NULL OR new_price_minor BETWEEN 0 AND 1000000000000),
 CHECK((type='price_change' AND price_field IS NOT NULL AND new_price_minor IS NOT NULL) OR (type!='price_change' AND price_field IS NULL AND previous_price_minor IS NULL AND new_price_minor IS NULL))
) STRICT;
CREATE INDEX employees_customer ON employees(customer_id,archived_at);
CREATE INDEX relationships_customer ON customer_services(customer_id);
CREATE INDEX relationships_service ON customer_services(service_id);
CREATE INDEX relationships_status ON customer_services(status,status_since);
CREATE INDEX relationships_cohort ON customer_services(created_at,pitch_channel);
CREATE INDEX history_relationship ON customer_service_status_history(customer_service_id,occurred_at,recorded_at);
CREATE INDEX activities_relationship ON activities(customer_service_id,occurred_at);
CREATE INDEX activities_occurred ON activities(occurred_at);
CREATE TRIGGER immutable_history_update BEFORE UPDATE ON customer_service_status_history BEGIN SELECT RAISE(ABORT,'Status history is immutable'); END;
CREATE TRIGGER immutable_history_delete BEFORE DELETE ON customer_service_status_history BEGIN SELECT RAISE(ABORT,'Status history is immutable'); END;
CREATE TRIGGER immutable_activity_update BEFORE UPDATE ON activities BEGIN SELECT RAISE(ABORT,'Activities are immutable'); END;
CREATE TRIGGER immutable_activity_delete BEFORE DELETE ON activities BEGIN SELECT RAISE(ABORT,'Activities are immutable'); END;
CREATE TRIGGER activity_customer_insert BEFORE INSERT ON activities WHEN NEW.employee_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM employees e JOIN customer_services cs ON cs.customer_id=e.customer_id WHERE e.id=NEW.employee_id AND cs.id=NEW.customer_service_id
) BEGIN SELECT RAISE(ABORT,'Contact belongs to another customer'); END;
