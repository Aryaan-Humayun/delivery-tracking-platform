const express = require('express');
const { register, login, logout } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     description: >
 *       Creates a user account. If role is "driver", also creates a linked driver profile
 *       (status defaults to "offline") in the same DB transaction - both succeed or neither does.
 *       Subject to a stricter rate limit than other routes (5 per 15 minutes by default) to slow
 *       down spam registrations.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string, example: Alice Customer }
 *               email: { type: string, format: email, example: alice@example.com }
 *               password:
 *                 type: string
 *                 format: password
 *                 description: At least 8 characters, with at least one letter and one number.
 *                 example: abc12345
 *               role: { type: string, enum: [customer, driver, dispatcher], example: customer }
 *               phone: { type: string, description: Required when role is "driver". , example: '555-1234' }
 *               vehicleType: { type: string, description: Required when role is "driver"., example: bike }
 *           examples:
 *             customer:
 *               summary: Customer registration
 *               value: { name: Alice Customer, email: alice@example.com, password: abc12345, role: customer }
 *             driver:
 *               summary: Driver registration
 *               value: { name: Dan Driver, email: dan@example.com, password: abc12345, role: driver, phone: '555-1234', vehicleType: bike }
 *     responses:
 *       201:
 *         description: User created (and driver profile, if role was "driver").
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *                 driver: { $ref: '#/components/schemas/Driver' }
 *       400:
 *         description: Missing/invalid field, weak password, or invalid role.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Email is already registered.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Too many registration attempts from this IP.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/register', authLimiter, asyncHandler(register));

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Log in
 *     description: >
 *       Verifies credentials against the stored bcrypt hash and returns a JWT (24h expiry by
 *       default). Subject to a stricter rate limit than other routes (5 per 15 minutes by
 *       default) to slow down brute-force guessing.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: alice@example.com }
 *               password: { type: string, format: password, example: abc12345 }
 *     responses:
 *       200:
 *         description: Logged in.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... }
 *                 user: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Missing email or password.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Invalid email or password (same message either way, to avoid leaking which one was wrong).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Too many login attempts from this IP.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/login', authLimiter, asyncHandler(login));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Log out
 *     description: >
 *       Revokes the current token via a Redis blocklist (not a server-side no-op) - the same
 *       token cannot be used again even though it hasn't naturally expired yet. The blocklist
 *       entry's TTL matches the token's own remaining lifetime, so it expires itself.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out.
 *         content:
 *           application/json:
 *             example: { message: logged out }
 *       401:
 *         description: Missing, malformed, invalid, expired, or already-revoked token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/logout', authenticate, asyncHandler(logout));

module.exports = router;
