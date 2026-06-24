-- Coordinates are optional (a caller may only have a human-readable address),
-- but if given must be valid - same range checks as locations.latitude/longitude.
ALTER TABLE orders
  ADD COLUMN pickup_address VARCHAR(500) NOT NULL,
  ADD COLUMN pickup_latitude NUMERIC(9, 6) CHECK (pickup_latitude BETWEEN -90 AND 90),
  ADD COLUMN pickup_longitude NUMERIC(9, 6) CHECK (pickup_longitude BETWEEN -180 AND 180),
  ADD COLUMN dropoff_address VARCHAR(500) NOT NULL,
  ADD COLUMN dropoff_latitude NUMERIC(9, 6) CHECK (dropoff_latitude BETWEEN -90 AND 90),
  ADD COLUMN dropoff_longitude NUMERIC(9, 6) CHECK (dropoff_longitude BETWEEN -180 AND 180),
  ADD COLUMN package_description VARCHAR(500) NOT NULL,
  ADD COLUMN package_weight_kg NUMERIC(6, 2) CHECK (package_weight_kg > 0);
