-- Backs soft-delete for drivers: DELETE /drivers/:id sets this to false
-- instead of removing the row, since orders.driver_id references drivers
-- historically. Kept separate from the online/offline/busy `status` enum
-- so "deactivated by a dispatcher" doesn't get conflated with "temporarily
-- offline" - a driver can be offline and still active.
ALTER TABLE drivers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
