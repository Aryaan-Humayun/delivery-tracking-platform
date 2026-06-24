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

async function findById(id, db = pool) {
  const result = await db.query('SELECT * FROM drivers WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByUserId(userId, db = pool) {
  const result = await db.query('SELECT * FROM drivers WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function findAll({ status } = {}, db = pool) {
  const conditions = ['is_active = true'];
  const values = [];

  if (status !== undefined) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const result = await db.query(
    `SELECT * FROM drivers WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
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

module.exports = { createDriver, findById, findByUserId, findAll, updateDriver, deactivateDriver };
