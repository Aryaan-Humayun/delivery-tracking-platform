-- Account approval workflow: customers are active immediately, drivers start
-- pending until a dispatcher approves them. The DEFAULT backfills existing
-- rows to 'active' so nobody already registered gets locked out by this.
ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
