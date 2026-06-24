const rateLimit = require('express-rate-limit');
const config = require('../config/env');

// Applies to every route. express-rate-limit's `message` option is sent
// as-is via res.send(), and Express's res.send() JSON-encodes plain objects
// automatically, so this is already a clean JSON 429 with no extra handler.
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'Too many requests from this IP, please try again later.' },
});

// Stacks on top of generalLimiter, specifically on /auth/register and
// /auth/login, to slow down brute-force login guesses and spam signups
// without needing a valid token (this runs before authenticate ever could).
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'Too many login/registration attempts from this IP, please try again later.' },
});

module.exports = { generalLimiter, authLimiter };
