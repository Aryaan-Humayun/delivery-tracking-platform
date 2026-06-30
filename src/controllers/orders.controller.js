const orderModel = require('../models/order.model');
const driverModel = require('../models/driver.model');

const ORDER_STATUSES = ['created', 'assigned', 'picked_up', 'in_transit', 'delivered'];

// Forward-only, one step at a time - no skipping ahead, no going back.
const TRANSITIONS = {
  created: ['assigned'],
  assigned: ['picked_up'],
  picked_up: ['in_transit'],
  in_transit: ['delivered'],
  delivered: [],
};

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validateOptionalCoordinatePair(lat, lng, label) {
  const latProvided = lat !== undefined && lat !== null;
  const lngProvided = lng !== undefined && lng !== null;
  if (!latProvided && !lngProvided) return null;
  if (latProvided !== lngProvided) {
    return `${label}Latitude and ${label}Longitude must be provided together`;
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
    return `${label}Latitude must be a number between -90 and 90`;
  }
  if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
    return `${label}Longitude must be a number between -180 and 180`;
  }
  return null;
}

// Best-effort: a notification failure must never break the order status
// update itself, which has already been committed to the DB by the time this
// runs. Guarded separately from the rest of the handler so it can never turn
// a successful write into an error response.
function notify(io, room, orderId, status, message) {
  io.to(room).emit('notification', { orderId, status, message, timestamp: new Date().toISOString() });
}

function sendOrderNotifications(req, orderId, nextStatus, driverId) {
  try {
    const io = req.app.get('io');
    if (!io) return;

    if (nextStatus === 'assigned') {
      notify(io, `order:${orderId}`, orderId, nextStatus, 'Your order has been assigned to a driver.');
      // Only reaches the driver if they currently have a socket connected
      // (room membership) - Socket.IO emitting to an empty room is a no-op,
      // so there's nothing extra to check for here.
      notify(io, `driver:${driverId}`, orderId, nextStatus, 'You have been assigned a new order.');
    } else if (nextStatus === 'picked_up') {
      notify(io, `order:${orderId}`, orderId, nextStatus, 'Your order has been picked up.');
    } else if (nextStatus === 'delivered') {
      notify(io, `order:${orderId}`, orderId, nextStatus, 'Your order has been delivered.');
      notify(io, 'dispatchers', orderId, nextStatus, `Order #${orderId} has been delivered.`);
    }
    // in_transit has no notification - not part of the assessment's event list.
  } catch (err) {
    console.error('Failed to send order notification:', err);
  }
}

function toPublicOrder(order) {
  return {
    id: order.id,
    customerId: order.customer_id,
    driverId: order.driver_id,
    status: order.status,
    pickupAddress: order.pickup_address,
    pickupLatitude: order.pickup_latitude !== null ? Number(order.pickup_latitude) : null,
    pickupLongitude: order.pickup_longitude !== null ? Number(order.pickup_longitude) : null,
    dropoffAddress: order.dropoff_address,
    dropoffLatitude: order.dropoff_latitude !== null ? Number(order.dropoff_latitude) : null,
    dropoffLongitude: order.dropoff_longitude !== null ? Number(order.dropoff_longitude) : null,
    packageDescription: order.package_description,
    packageWeightKg: order.package_weight_kg !== null ? Number(order.package_weight_kg) : null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

async function createOrder(req, res, next) {
  const {
    pickupAddress,
    pickupLatitude,
    pickupLongitude,
    dropoffAddress,
    dropoffLatitude,
    dropoffLongitude,
    packageDescription,
    packageWeightKg,
  } = req.body || {};

  if (!isNonEmptyString(pickupAddress, 500)) {
    return res.status(400).json({ error: 'pickupAddress is required (max 500 characters)' });
  }
  if (!isNonEmptyString(dropoffAddress, 500)) {
    return res.status(400).json({ error: 'dropoffAddress is required (max 500 characters)' });
  }
  if (!isNonEmptyString(packageDescription, 500)) {
    return res.status(400).json({ error: 'packageDescription is required (max 500 characters)' });
  }

  const pickupCoordError = validateOptionalCoordinatePair(pickupLatitude, pickupLongitude, 'pickup');
  if (pickupCoordError) {
    return res.status(400).json({ error: pickupCoordError });
  }
  const dropoffCoordError = validateOptionalCoordinatePair(dropoffLatitude, dropoffLongitude, 'dropoff');
  if (dropoffCoordError) {
    return res.status(400).json({ error: dropoffCoordError });
  }

  let weight = null;
  if (packageWeightKg !== undefined && packageWeightKg !== null) {
    weight = Number(packageWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      return res.status(400).json({ error: 'packageWeightKg must be a positive number' });
    }
  }

  const order = await orderModel.createOrder({
    customerId: req.user.userId,
    pickupAddress: pickupAddress.trim(),
    pickupLatitude: pickupLatitude ?? null,
    pickupLongitude: pickupLongitude ?? null,
    dropoffAddress: dropoffAddress.trim(),
    dropoffLatitude: dropoffLatitude ?? null,
    dropoffLongitude: dropoffLongitude ?? null,
    packageDescription: packageDescription.trim(),
    packageWeightKg: weight,
  });
  return res.status(201).json({ order: toPublicOrder(order) });
}

async function listOrders(req, res, next) {
  const { status } = req.query;
  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}` });
  }

  const filters = { status };
  if (req.user.role === 'customer') {
    filters.customerId = req.user.userId;
  } else if (req.user.role === 'driver') {
    const driverRecord = await driverModel.findByUserId(req.user.userId);
    if (!driverRecord) {
      return res.status(200).json({ orders: [] });
    }
    filters.driverId = driverRecord.id;
  }
  // dispatcher: no extra filter - sees everything (optionally narrowed by status)

  const orders = await orderModel.findOrders(filters);
  return res.status(200).json({ orders: orders.map(toPublicOrder) });
}

async function getOrder(req, res, next) {
  const orderId = parsePositiveInt(req.params.id);
  if (!orderId) {
    return res.status(400).json({ error: 'invalid order id' });
  }

  const order = await orderModel.findById(orderId);
  if (!order) {
    return res.status(404).json({ error: 'order not found' });
  }

  if (req.user.role === 'dispatcher') {
    return res.status(200).json({ order: toPublicOrder(order) });
  }
  if (req.user.role === 'customer') {
    if (order.customer_id !== req.user.userId) {
      return res.status(403).json({ error: 'you do not have access to this order' });
    }
    return res.status(200).json({ order: toPublicOrder(order) });
  }
  if (req.user.role === 'driver') {
    const driverRecord = await driverModel.findByUserId(req.user.userId);
    if (!driverRecord || driverRecord.id !== order.driver_id) {
      return res.status(403).json({ error: 'you do not have access to this order' });
    }
    return res.status(200).json({ order: toPublicOrder(order) });
  }
  return res.status(403).json({ error: 'you do not have access to this order' });
}

async function updateOrderStatus(req, res, next) {
  const orderId = parsePositiveInt(req.params.id);
  if (!orderId) {
    return res.status(400).json({ error: 'invalid order id' });
  }

  const { status: nextStatus, driverId } = req.body || {};
  if (!ORDER_STATUSES.includes(nextStatus)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}` });
  }

  const order = await orderModel.findById(orderId);
  if (!order) {
    return res.status(404).json({ error: 'order not found' });
  }

  const allowedNext = TRANSITIONS[order.status];
  if (!allowedNext.includes(nextStatus)) {
    const message = allowedNext.length
      ? `cannot transition from '${order.status}' to '${nextStatus}'; valid next status is '${allowedNext[0]}'`
      : `order is already '${order.status}'; no further transitions are allowed`;
    return res.status(400).json({ error: message });
  }

  if (nextStatus === 'assigned') {
    if (req.user.role !== 'dispatcher') {
      return res.status(403).json({ error: 'only a dispatcher can assign a driver to an order' });
    }
    const parsedDriverId = parsePositiveInt(driverId);
    if (!parsedDriverId) {
      return res.status(400).json({ error: 'driverId is required to assign a driver' });
    }
    const driver = await driverModel.findById(parsedDriverId);
    if (!driver) {
      return res.status(400).json({ error: 'driverId does not reference an existing driver' });
    }
    if (!driver.is_active) {
      return res.status(400).json({ error: 'cannot assign an inactive driver' });
    }
    if (driver.account_status !== 'active') {
      return res.status(400).json({ error: 'cannot assign a driver whose account is not active' });
    }

    const updated = await orderModel.updateStatus(orderId, { status: nextStatus, driverId: parsedDriverId });
    sendOrderNotifications(req, orderId, nextStatus, parsedDriverId);
    return res.status(200).json({ order: toPublicOrder(updated) });
  }

  // picked_up, in_transit, delivered - the assigned driver only, not even a dispatcher.
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'only the assigned driver can update this order to this status' });
  }
  const driverRecord = await driverModel.findByUserId(req.user.userId);
  if (!driverRecord || driverRecord.id !== order.driver_id) {
    return res.status(403).json({ error: 'only the assigned driver can update this order to this status' });
  }

  const updated = await orderModel.updateStatus(orderId, { status: nextStatus });
  sendOrderNotifications(req, orderId, nextStatus, order.driver_id);
  return res.status(200).json({ order: toPublicOrder(updated) });
}

// Once an order leaves 'created' it has real-world consequences in flight (a
// driver assigned, possibly already en route) - deleting the row would erase
// that history out from under whoever is relying on it. Only an order that
// never left 'created' (no driver assigned, nothing has happened yet) can be
// removed outright; anything further along must be handled by progressing
// its status, not by deleting it.
async function deleteOrder(req, res, next) {
  const orderId = parsePositiveInt(req.params.id);
  if (!orderId) {
    return res.status(400).json({ error: 'invalid order id' });
  }

  const order = await orderModel.findById(orderId);
  if (!order) {
    return res.status(404).json({ error: 'order not found' });
  }
  if (order.status !== 'created') {
    return res.status(409).json({
      error: `cannot delete an order once it has progressed past 'created' (current status: '${order.status}')`,
    });
  }

  const deletedId = await orderModel.deleteIfCreated(orderId);
  if (!deletedId) {
    return res.status(409).json({ error: 'order status changed; refresh and try again' });
  }
  return res.status(204).send();
}

module.exports = { createOrder, listOrders, getOrder, updateOrderStatus, deleteOrder };
