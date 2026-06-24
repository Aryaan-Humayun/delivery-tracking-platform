-- One row per driver: the unique constraint on driver_id is what makes this
-- a "latest location" table. Writers must INSERT ... ON CONFLICT (driver_id)
-- DO UPDATE rather than plain INSERT. See SCHEMA.md for why this was chosen
-- over a history table.
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  latitude NUMERIC(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT locations_driver_id_unique UNIQUE (driver_id)
);
