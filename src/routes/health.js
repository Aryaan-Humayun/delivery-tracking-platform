const express = require('express');
const { getHealth } = require('../controllers/health.controller');

const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Confirms the server, Postgres, and Redis connections are all up.
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Everything is healthy.
 *         content:
 *           application/json:
 *             example: { status: ok, timestamp: '2026-06-21T11:00:00.000Z', db: connected, redis: connected }
 *       503:
 *         description: Postgres or Redis is unreachable.
 *         content:
 *           application/json:
 *             example: { status: error, timestamp: '2026-06-21T11:00:00.000Z', db: disconnected, dbError: 'connect ECONNREFUSED ::1:5432' }
 */
router.get('/', getHealth);

module.exports = router;
