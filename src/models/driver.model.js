const pool = require('../config/db');

async function createDriver({ userId, name, phone, vehicleType, status = 'offline' }, db = pool) {
  const result = await db.query(
    `INSERT INTO drivers (user_id, name, phone, vehicle_type, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, name, phone, vehicleType, status]
  );
  return result.rows[0];
}

// account_status (the user's approval state) is joined in alongside the
// driver's own online/offline/busy `status` so callers can tell a pending or
// suspended driver apart from a normal one without a second query - see its
// use in orders.controller.js's assign-driver check.
async function findById(id, db = pool) {
  const result = await db.query(
    `SELECT d.*, u.status AS account_status
     FROM drivers d
     JOIN users u ON u.id = d.user_id
     WHERE d.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByUserId(userId, db = pool) {
  const result = await db.query('SELECT * FROM drivers WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

// Excludes drivers whose account isn't 'active' (pending approval, or
// suspended) - otherwise a driver would show up as assignable in the
// dispatcher's roster the instant they register, before anyone approved
// them, which would make the approval workflow pointless.
async function findAll({ status } = {}, db = pool) {
  const conditions = ['d.is_active = true', "u.status = 'active'"];
  const values = [];

  if (status !== undefined) {
    values.push(status);
    conditions.push(`d.status = $${values.length}`);
  }

  const result = await db.query(
    `SELECT d.* FROM drivers d
     JOIN users u ON u.id = d.user_id
     WHERE ${conditions.join(' AND ')} ORDER BY d.created_at DESC`,
    values
  );
  return result.rows;
}

async function updateDriver(id, fields, db = pool) {
  const columns = Object.keys(fields);
  const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
  const values = columns.map((col) => fields[col]);

  // The is_active check is a belt-and-braces guard against a deactivation
  // racing with this update; the controller already checked is_active on a
  // freshly-fetched row before calling this.
  const result = await db.query(
    `UPDATE drivers SET ${setClause} WHERE id = $1 AND is_active = true RETURNING *`,
    [id, ...values]
  );
  return result.rows[0] || null;
}

async function deactivateDriver(id, db = pool) {
  const result = await db.query(
    "UPDATE drivers SET is_active = false, status = 'offline' WHERE id = $1 RETURNING *",
    [id]
  );
  return result.rows[0] || null;
}

// Joins users so the dispatcher's approval queue can show name/email
// alongside the driver-specific profile fields, without a second round trip.
async function findPending(db = pool) {
  const result = await db.query(
    `SELECT d.id, d.user_id, d.phone, d.vehicle_type, d.created_at,
            u.name, u.email
     FROM drivers d
     JOIN users u ON u.id = d.user_id
     WHERE u.role = 'driver' AND u.status = 'pending'
     ORDER BY d.created_at DESC`
  );
  return result.rows;
}

module.exports = { createDriver, findById, findByUserId, findAll, updateDriver, deactivateDriver, findPending };
