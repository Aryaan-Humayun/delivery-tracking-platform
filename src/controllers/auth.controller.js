const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const redisClient = require('../config/redis');
const config = require('../config/env');
const userModel = require('../models/user.model');
const driverModel = require('../models/driver.model');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['customer', 'driver', 'dispatcher'];

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

function isValidPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[a-zA-Z]/.test(password) &&
    /\d/.test(password)
  );
}

function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.created_at };
}

function toPublicDriver(driver) {
  return {
    id: driver.id,
    phone: driver.phone,
    vehicleType: driver.vehicle_type,
    status: driver.status,
  };
}

async function register(req, res, next) {
  const { name, email, password, role, phone, vehicleType } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'a valid email is required' });
  }
  if (!isValidPassword(password)) {
    return res
      .status(400)
      .json({ error: 'password must be at least 8 characters and include a letter and a number' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  if (role === 'driver' && (typeof phone !== 'string' || !phone.trim() || typeof vehicleType !== 'string' || !vehicleType.trim())) {
    return res.status(400).json({ error: 'phone and vehicleType are required when role is driver' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(password, config.bcryptSaltRounds);
    // Rely on the users.email UNIQUE constraint rather than a pre-check SELECT,
    // so a race between two concurrent registrations with the same email can't
    // both pass a check and then both insert.
    const user = await userModel.createUser({ name: name.trim(), email, passwordHash, role }, client);

    let driver = null;
    if (role === 'driver') {
      driver = await driverModel.createDriver(
        { userId: user.id, name: name.trim(), phone: phone.trim(), vehicleType: vehicleType.trim() },
        client
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      user: toPublicUser(user),
      driver: driver ? toPublicDriver(driver) : undefined,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'email is already registered' });
    }
    return next(err);
  } finally {
    client.release();
  }
}

async function login(req, res, next) {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const user = await userModel.findByEmail(email);
    // Same generic message whether the email doesn't exist or the password is
    // wrong, so the response can't be used to enumerate registered emails.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'invalid email or password' });
    }

    const jti = crypto.randomUUID();
    const token = jwt.sign({ userId: user.id, role: user.role, jti }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    return res.status(200).json({ token, user: toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// Logout revokes the specific token via a Redis blocklist rather than being a
// server-side no-op. With a pure no-op, a stolen or accidentally-leaked token
// stays valid for its full lifetime even after the user "logs out" - there'd
// be no way to react to that. Redis is already running locally for this
// project, and a blocklist check is one fast GET per authenticated request, so
// the cost is low. The blocklist key is set with a TTL equal to the token's
// remaining lifetime (decoded from its own `exp` claim), so Redis expires the
// entry by itself at the same moment the token would have expired anyway -
// no manual cleanup job needed, and the blocklist can never grow unbounded.
async function logout(req, res, next) {
  const { jti, exp } = req.tokenPayload;
  const ttlSeconds = exp - Math.floor(Date.now() / 1000);

  try {
    if (ttlSeconds > 0) {
      await redisClient.set(`blocklist:${jti}`, '1', { EX: ttlSeconds });
    }
    return res.status(200).json({ message: 'logged out' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, logout };
