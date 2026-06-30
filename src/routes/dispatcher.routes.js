const express = require('express');
const { listPendingDrivers, approveDriver, rejectDriver } = require('../controllers/dispatcher.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.use(authenticate, requireRole('dispatcher'));

/**
 * @openapi
 * /dispatcher/pending-drivers:
 *   get:
 *     summary: List drivers awaiting approval (dispatcher only)
 *     description: Drivers whose account status is "pending" - registered, but not yet able to log in.
 *     tags: [Dispatcher]
 *     responses:
 *       200:
 *         description: Pending drivers.
 *       403:
 *         description: Caller is not a dispatcher.
 */
router.get('/pending-drivers', asyncHandler(listPendingDrivers));

/**
 * @openapi
 * /dispatcher/drivers/{id}/approve:
 *   put:
 *     summary: Approve a pending driver (dispatcher only)
 *     description: Sets the driver's account status to "active", letting them log in.
 *     tags: [Dispatcher]
 *     parameters:
 *       - $ref: '#/components/parameters/DriverId'
 *     responses:
 *       200:
 *         description: Driver approved.
 *       403:
 *         description: Caller is not a dispatcher.
 *       404:
 *         description: No such driver.
 */
router.put('/drivers/:id/approve', asyncHandler(approveDriver));

/**
 * @openapi
 * /dispatcher/drivers/{id}/reject:
 *   put:
 *     summary: Reject a pending driver (dispatcher only)
 *     description: Sets the driver's account status to "suspended".
 *     tags: [Dispatcher]
 *     parameters:
 *       - $ref: '#/components/parameters/DriverId'
 *     responses:
 *       200:
 *         description: Driver rejected.
 *       403:
 *         description: Caller is not a dispatcher.
 *       404:
 *         description: No such driver.
 */
router.put('/drivers/:id/reject', asyncHandler(rejectDriver));

module.exports = router;
