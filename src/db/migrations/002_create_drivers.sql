CREATE TYPE driver_status AS ENUM ('online', 'offline', 'busy');

CREATE TABLE drivers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  vehicle_type VARCHAR(50),
  status driver_status NOT NULL DEFAULT 'offline',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drivers_user_id_unique UNIQUE (user_id)
);
