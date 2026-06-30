require('dotenv').config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a real secret.');
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  db: {
    // Same pattern as Redis below: Railway/Neon only ever provide a single
    // DATABASE_URL connection string, not separate PG* vars - prefer it when
    // present. Neon requires SSL; rejectUnauthorized: false because Neon's
    // cert chain isn't in Node's default trusted CA bundle. Falls back to
    // PGHOST/PGPORT/etc (or the docker-compose defaults) for local dev,
    // which never sets DATABASE_URL.
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT, 10) || 5432,
    database: process.env.PGDATABASE || 'delivery_tracking',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  },
  redis: {
    // Railway (and most managed Redis hosts) only ever provide a single
    // REDIS_URL connection string, not separate host/port vars - prefer it
    // when present. Falls back to REDIS_HOST/REDIS_PORT (or localhost:6379)
    // for local dev via docker-compose, which never sets REDIS_URL.
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${parseInt(process.env.REDIS_PORT, 10) || 6379}`,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 10,
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 5,
  },
};
