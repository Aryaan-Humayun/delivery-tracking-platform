const pool = require('../config/db');

async function findByEmail(email, db = pool) {
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function findById(id, db = pool) {
  const result = await db.query(
    'SELECT id, name, email, role, status, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function createUser({ name, email, passwordHash, role, status = 'active' }, db = pool) {
  const result = await db.query(
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, status, created_at`,
    [name, email, passwordHash, role, status]
  );
  return result.rows[0];
}

async function updateStatus(id, status, db = pool) {
  const result = await db.query(
    'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, name, email, role, status, created_at',
    [status, id]
  );
  return result.rows[0] || null;
}

module.exports = { findByEmail, findById, createUser, updateStatus };
