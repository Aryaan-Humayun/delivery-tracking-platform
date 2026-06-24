const jwt = require('jsonwebtoken');
const config = require('../config/env');
const redisClient = require('../config/redis');

class AuthError extends Error {}

// Shared by the REST `authenticate` middleware below and by the Socket.IO
// auth middleware (sockets/middleware/auth.js), so both transports verify a
// token the same way - including the logout blocklist check - instead of
// drifting apart over time.
async function verifyAuthToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw new AuthError('invalid or expired token');
  }

  // Fails open: if the blocklist itself can't be reached, we treat the token
  // as not-revoked rather than rejecting every authenticated request in the
  // app over a Redis outage. The JWT's own signature/expiry check above is
  // unaffected either way - this only widens or narrows the one additional
  // case the blocklist exists for (a token revoked via /auth/logout before
  // its natural expiry). Failing closed here would mean a single Redis
  // hiccup takes down 100% of authenticated traffic (REST and sockets) to
  // guard against a narrow, time-bounded gap (a revoked token being replayed
  // only during the outage window, capped by the token's own expiry anyway).
  // That tradeoff is the wrong way around for this app, so: fail open, log
  // loudly. Logout's own redisClient.set() (auth.controller.js) is NOT
  // covered by this - a failure to revoke still fails loudly there, since
  // silently claiming "logged out" when nothing was actually revoked would
  // be actively misleading, not just permissive.
  try {
    const isRevoked = await redisClient.get(`blocklist:${decoded.jti}`);
    if (isRevoked) {
      throw new AuthError('token has been revoked');
    }
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    console.warn(`Blocklist check failed, failing open (treating token as not revoked): ${err.message}`);
  }

  return decoded;
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing or malformed Authorization header' });
  }

  try {
    const decoded = await verifyAuthToken(token);
    // Only userId/role are exposed as req.user - this is the shape routes and
    // Socket.IO auth should rely on. The full payload (incl. jti/exp, needed by
    // logout to manage the blocklist entry) is kept separate on req.tokenPayload.
    req.user = { userId: decoded.userId, role: decoded.role };
    req.tokenPayload = decoded;
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ error: err.message });
    }
    return next(err);
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, verifyAuthToken, AuthError };
