-- Individual events remain immutable. Removing their entire offer also removes
-- its events, atomically within the parent DELETE statement.
DROP TRIGGER immutable_history_delete;
CREATE TRIGGER immutable_history_delete BEFORE DELETE ON customer_service_status_history
WHEN EXISTS (SELECT 1 FROM customer_services WHERE id=OLD.customer_service_id)
BEGIN SELECT RAISE(ABORT,'Status history is immutable'); END;
DROP TRIGGER immutable_activity_delete;
CREATE TRIGGER immutable_activity_delete BEFORE DELETE ON activities
WHEN EXISTS (SELECT 1 FROM customer_services WHERE id=OLD.customer_service_id)
BEGIN SELECT RAISE(ABORT,'Activities are immutable'); END;
CREATE TRIGGER delete_relationship_events AFTER DELETE ON customer_services BEGIN
 DELETE FROM activities WHERE customer_service_id=OLD.id;
 DELETE FROM customer_service_status_history WHERE customer_service_id=OLD.id;
END;
