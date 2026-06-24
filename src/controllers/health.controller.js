const pool = require('../config/db');
const redisClient = require('../config/redis');

function flattenError(err) {
  // pg's connection errors can arrive as an AggregateError (Node's dual-stack
  // IPv6/IPv4 connect attempts) whose top-level message is blank; the real
  // reason is in err.errors.
  return (err.errors && err.errors.map((e) => e.message).join('; ')) || err.message;
}

async function getHealth(req, res) {
  const result = { status: 'ok', timestamp: new Date().toISOString() };
  let healthy = true;

  try {
    await pool.query('SELECT 1');
    result.db = 'connected';
  } catch (err) {
    healthy = false;
    result.db = 'disconnected';
    result.dbError = flattenError(err);
  }

  try {
    await redisClient.ping();
    result.redis = 'connected';
  } catch (err) {
    healthy = false;
    result.redis = 'disconnected';
    result.redisError = flattenError(err);
  }

  if (!healthy) {
    result.status = 'error';
  }

  res.status(healthy ? 200 : 503).json(result);
}

module.exports = { getHealth };
