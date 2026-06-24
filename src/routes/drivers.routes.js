const express = require('express');
const {
  createDriverProfile,
  listDrivers,
  getDriver,
  getDriverLocation,
  updateDriverProfile,
  deactivateDriver,
} = require('../controllers/drivers.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.use(authenticate);

/**
 * @openapi
 * /drivers:
 *   post:
 *     summary: Attach a driver profile to an existing user (dispatcher only)
 *     description: >
 *       For backfilling a driver profile on a user that already has role "driver" but has no
 *       profile yet (e.g. data migrated from elsewhere) - not the normal signup path, which is
 *       POST /auth/register (that creates the user and the driver profile together).
 *     tags: [Drivers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, phone, vehicleType]
 *             properties:
 *               userId: { type: integer, description: Must reference an existing user whose role is "driver"., example: 7 }
 *               phone: { type: string, example: '555-0000' }
 *               vehicleType: { type: string, example: car }
 *               status: { type: string, enum: [online, offline, busy], default: offline, example: offline }
 *     responses:
 *       201:
 *         description: Driver profile created.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { driver: { $ref: '#/components/schemas/Driver' } } }
 *       400:
 *         description: userId missing/invalid, doesn't exist, or that user's role isn't "driver".
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Caller is not a dispatcher.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: That user already has a driver profile.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     summary: List drivers (dispatcher only)
 *     description: Lists active (is_active=true) drivers; deactivated drivers are omitted here but still resolvable via GET /drivers/{id}.
 *     tags: [Drivers]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [online, offline, busy] }
 *         description: Optional filter.
 *     responses:
 *       200:
 *         description: List of active drivers.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { drivers: { type: array, items: { $ref: '#/components/schemas/Driver' } } } }
 *       400:
 *         description: Invalid status filter value.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Caller is not a dispatcher.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', requireRole('dispatcher'), asyncHandler(createDriverProfile));
router.get('/', requireRole('dispatcher'), asyncHandler(listDrivers));

/**
 * @openapi
 * /drivers/{id}:
 *   get:
 *     summary: Get a driver's profile
 *     description: Accessible by a dispatcher, or by the driver viewing their own record. Not filtered by is_active - a deactivated driver is still resolvable by id.
 *     tags: [Drivers]
 *     parameters:
 *       - $ref: '#/components/parameters/DriverId'
 *     responses:
 *       200:
 *         description: Driver record.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { driver: { $ref: '#/components/schemas/Driver' } } }
 *       403:
 *         description: Exists, but isn't the caller's own record and the caller isn't a dispatcher.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id', asyncHandler(getDriver));

/**
 * @openapi
 * /drivers/{id}/location:
 *   get:
 *     summary: Get a driver's last known location
 *     description: >
 *       REST fallback for a page load before any socket update has arrived - see SOCKETS.md for
 *       the real-time path (location:update -> order:tracking / active:drivers). Accessible by a
 *       dispatcher, the driver themselves, or a customer with an active order (status
 *       assigned/picked_up/in_transit) currently assigned to that driver.
 *     tags: [Drivers]
 *     parameters:
 *       - $ref: '#/components/parameters/DriverId'
 *     responses:
 *       200:
 *         description: Last known location.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { location: { $ref: '#/components/schemas/DriverLocation' } } }
 *       403:
 *         description: Caller has no relationship with this driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such driver, or the driver exists but has never sent a location update.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id/location', asyncHandler(getDriverLocation));

/**
 * @openapi
 * /drivers/{id}:
 *   put:
 *     summary: Update a driver's profile
 *     description: >
 *       A dispatcher may update name, phone, vehicleType, and status. A driver updating their own
 *       record may update phone, vehicleType, and status only - not name.
 *     tags: [Drivers]
 *     parameters:
 *       - $ref: '#/components/parameters/DriverId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Daniel Driver }
 *               phone: { type: string, example: '555-1111' }
 *               vehicleType: { type: string, example: bike }
 *               status: { type: string, enum: [online, offline, busy], example: online }
 *           example: { status: online }
 *     responses:
 *       200:
 *         description: Updated driver record.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { driver: { $ref: '#/components/schemas/Driver' } } }
 *       400:
 *         description: Invalid field value, no fields provided, or a field this caller isn't allowed to edit (e.g. a driver trying to change their own name).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Not a dispatcher and not this driver's own record.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Driver is inactive (soft-deleted).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put('/:id', asyncHandler(updateDriverProfile));

/**
 * @openapi
 * /drivers/{id}:
 *   delete:
 *     summary: Soft-delete a driver (dispatcher only)
 *     description: >
 *       Sets is_active=false and status=offline rather than removing the row, since orders
 *       reference drivers historically. Idempotent - deleting an already-inactive driver just
 *       confirms the state.
 *     tags: [Drivers]
 *     parameters:
 *       - $ref: '#/components/parameters/DriverId'
 *     responses:
 *       200:
 *         description: Driver deactivated (or already was).
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { driver: { $ref: '#/components/schemas/Driver' } } }
 *       403:
 *         description: Caller is not a dispatcher.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete('/:id', requireRole('dispatcher'), asyncHandler(deactivateDriver));

module.exports = router;
