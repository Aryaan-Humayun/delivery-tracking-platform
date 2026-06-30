const bcrypt = require('bcrypt');
const pool = require('../src/config/db');
const config = require('../src/config/env');

const ADMIN = {
  name: 'Admin Dispatcher',
  email: 'admin@delivery.com',
  password: 'Admin@12345',
  role: 'dispatcher',
  status: 'active',
};

async function seedDispatcher() {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [ADMIN.email]);
  if (existing.rows.length > 0) {
    console.log(`${ADMIN.email} already exists - nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN.password, config.bcryptSaltRounds);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [ADMIN.name, ADMIN.email, passwordHash, ADMIN.role, ADMIN.status]
  );
  console.log(`Created master dispatcher account: ${ADMIN.email}`);
}

seedDispatcher()
  .catch((err) => {
    console.error('Seeding the dispatcher account failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
