const express = require('express');
const {
  createOrder,
  listOrders,
  getOrder,
  updateOrderStatus,
  deleteOrder,
} = require('../controllers/orders.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.use(authenticate);

/**
 * @openapi
 * /orders:
 *   post:
 *     summary: Create an order (customer only)
 *     description: customerId comes from the caller's token, not the body. Starts at status "created" with no driver assigned.
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickupAddress, dropoffAddress, packageDescription]
 *             properties:
 *               pickupAddress: { type: string, maxLength: 500, example: '1 Main St, Springfield' }
 *               pickupLatitude: { type: number, description: Optional, but if given pickupLongitude is required too., example: 39.78 }
 *               pickupLongitude: { type: number, example: -89.65 }
 *               dropoffAddress: { type: string, maxLength: 500, example: '42 Side St, Springfield' }
 *               dropoffLatitude: { type: number, example: 39.8 }
 *               dropoffLongitude: { type: number, example: -89.6 }
 *               packageDescription: { type: string, maxLength: 500, example: Small box of electronics }
 *               packageWeightKg: { type: number, description: Optional, must be positive., example: 2.5 }
 *     responses:
 *       201:
 *         description: Order created.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } }
 *       400:
 *         description: Missing/invalid required field, or an unpaired lat/lng.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Caller is not a customer.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   get:
 *     summary: List orders, scoped by role
 *     description: Customers see only their own orders; drivers see only orders assigned to them; dispatchers see everything.
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [created, assigned, picked_up, in_transit, delivered] }
 *         description: Optional filter, applied on top of the role-based scoping.
 *     responses:
 *       200:
 *         description: Orders visible to the caller.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { orders: { type: array, items: { $ref: '#/components/schemas/Order' } } } }
 *       400:
 *         description: Invalid status filter value.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', requireRole('customer'), asyncHandler(createOrder));
router.get('/', asyncHandler(listOrders));

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     summary: Get an order
 *     description: Accessible by the owning customer, the assigned driver, or any dispatcher.
 *     tags: [Orders]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     responses:
 *       200:
 *         description: Order detail.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } }
 *       403:
 *         description: Exists, but doesn't belong to the caller (returned instead of 404, so existence isn't hidden from someone who can prove they should know - unlike a wrong id entirely, which is 404).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such order.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id', asyncHandler(getOrder));

/**
 * @openapi
 * /orders/{id}:
 *   put:
 *     summary: Transition an order's status
 *     description: >
 *       Forward-only, one step at a time: created -> assigned -> picked_up -> in_transit ->
 *       delivered. The created -> assigned transition is dispatcher-only and requires driverId in
 *       the body. Every later transition (picked_up onward) is restricted to the assigned driver
 *       only - not even a dispatcher can make them. Pushes a real-time `notification` socket
 *       event on the assigned/picked_up/delivered transitions - see SOCKETS.md.
 *     tags: [Orders]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [assigned, picked_up, in_transit, delivered], example: assigned }
 *               driverId: { type: integer, description: Required (and only used) when status is "assigned"., example: 1 }
 *           examples:
 *             assign:
 *               summary: Dispatcher assigns a driver
 *               value: { status: assigned, driverId: 1 }
 *             progress:
 *               summary: Assigned driver progresses the order
 *               value: { status: picked_up }
 *     responses:
 *       200:
 *         description: Updated order.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } }
 *       400:
 *         description: Invalid/out-of-order/repeated transition, or a missing/invalid/inactive driverId.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Caller isn't allowed to make this specific transition (e.g. a non-dispatcher trying to assign, or a driver who isn't the one assigned).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such order.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put('/:id', asyncHandler(updateOrderStatus));

/**
 * @openapi
 * /orders/{id}:
 *   delete:
 *     summary: Delete an order (dispatcher only)
 *     description: Only allowed while status is still "created" - once a driver is assigned or further along, the order must be progressed through its lifecycle, not deleted.
 *     tags: [Orders]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     responses:
 *       204:
 *         description: Deleted.
 *       403:
 *         description: Caller is not a dispatcher.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: No such order.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Order has already progressed past "created".
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete('/:id', requireRole('dispatcher'), asyncHandler(deleteOrder));

module.exports = router;
