const pool = require('../config/db');

async function upsertLocation({ driverId, latitude, longitude }, db = pool) {
  const result = await db.query(
    `INSERT INTO locations (driver_id, latitude, longitude, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (driver_id)
     DO UPDATE SET latitude = $2, longitude = $3, updated_at = now()
     RETURNING *`,
    [driverId, latitude, longitude]
  );
  return result.rows[0];
}

async function findByDriverId(driverId, db = pool) {
  const result = await db.query('SELECT * FROM locations WHERE driver_id = $1', [driverId]);
  return result.rows[0] || null;
}

module.exports = { upsertLocation, findByDriverId };
