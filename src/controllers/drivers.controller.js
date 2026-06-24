const driverModel = require('../models/driver.model');
const userModel = require('../models/user.model');
const orderModel = require('../models/order.model');
const locationModel = require('../models/location.model');

const DRIVER_STATUSES = ['online', 'offline', 'busy'];

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function toPublicDriver(driver) {
  return {
    id: driver.id,
    userId: driver.user_id,
    name: driver.name,
    phone: driver.phone,
    vehicleType: driver.vehicle_type,
    status: driver.status,
    isActive: driver.is_active,
    createdAt: driver.created_at,
  };
}

// POST /drivers is dispatcher-only and does NOT create a user account - it
// attaches a driver profile to a user that already exists and already has
// role 'driver' but has no drivers row yet (e.g. a dispatcher correcting
// data, or a future "promote to driver" flow). /auth/register remains the
// path for a driver who is signing themselves up; this is for back-filling
// the profile when that didn't happen through registration.
async function createDriverProfile(req, res, next) {
  const { userId, phone, vehicleType, status } = req.body || {};

  const parsedUserId = parsePositiveInt(userId);
  if (!parsedUserId) {
    return res.status(400).json({ error: 'userId is required and must be a positive integer' });
  }
  if (!isNonEmptyString(phone, 50)) {
    return res.status(400).json({ error: 'phone is required (max 50 characters)' });
  }
  if (!isNonEmptyString(vehicleType, 50)) {
    return res.status(400).json({ error: 'vehicleType is required (max 50 characters)' });
  }
  if (status !== undefined && !DRIVER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${DRIVER_STATUSES.join(', ')}` });
  }

  try {
    const user = await userModel.findById(parsedUserId);
    if (!user) {
      return res.status(400).json({ error: 'userId does not reference an existing user' });
    }
    if (user.role !== 'driver') {
      return res.status(400).json({ error: "the referenced user's role must be 'driver'" });
    }

    const driver = await driverModel.createDriver({
      userId: parsedUserId,
      name: user.name,
      phone: phone.trim(),
      vehicleType: vehicleType.trim(),
      status: status || 'offline',
    });
    return res.status(201).json({ driver: toPublicDriver(driver) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'this user already has a driver profile' });
    }
    return next(err);
  }
}

async function listDrivers(req, res, next) {
  const { status } = req.query;
  if (status !== undefined && !DRIVER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${DRIVER_STATUSES.join(', ')}` });
  }

  const drivers = await driverModel.findAll({ status });
  return res.status(200).json({ drivers: drivers.map(toPublicDriver) });
}

async function getDriver(req, res, next) {
  const driverId = parsePositiveInt(req.params.id);
  if (!driverId) {
    return res.status(400).json({ error: 'invalid driver id' });
  }

  const driver = await driverModel.findById(driverId);
  if (!driver) {
    return res.status(404).json({ error: 'driver not found' });
  }

  const isDispatcher = req.user.role === 'dispatcher';
  const isSelf = req.user.role === 'driver' && driver.user_id === req.user.userId;
  if (!isDispatcher && !isSelf) {
    return res.status(403).json({ error: 'you do not have access to this driver record' });
  }

  return res.status(200).json({ driver: toPublicDriver(driver) });
}

// Fallback for a page load before any socket update has arrived (e.g. a
// customer's tracking page on first render, or a dispatcher's roster) - the
// real-time path is the location:update broadcasts, this is read-only and
// can be stale by however long it's been since the driver's last ping.
async function getDriverLocation(req, res, next) {
  const driverId = parsePositiveInt(req.params.id);
  if (!driverId) {
    return res.status(400).json({ error: 'invalid driver id' });
  }

  const driver = await driverModel.findById(driverId);
  if (!driver) {
    return res.status(404).json({ error: 'driver not found' });
  }

  const isDispatcher = req.user.role === 'dispatcher';
  const isSelf = req.user.role === 'driver' && driver.user_id === req.user.userId;

  let isAssignedCustomer = false;
  if (req.user.role === 'customer') {
    const activeOrder = await orderModel.findActiveByDriverId(driverId);
    isAssignedCustomer = !!activeOrder && activeOrder.customer_id === req.user.userId;
  }

  if (!isDispatcher && !isSelf && !isAssignedCustomer) {
    return res.status(403).json({ error: "you do not have access to this driver's location" });
  }

  const location = await locationModel.findByDriverId(driverId);
  if (!location) {
    return res.status(404).json({ error: 'no location recorded for this driver yet' });
  }

  return res.status(200).json({
    location: {
      driverId: location.driver_id,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      updatedAt: location.updated_at,
    },
  });
}

async function updateDriverProfile(req, res, next) {
  const driverId = parsePositiveInt(req.params.id);
  if (!driverId) {
    return res.status(400).json({ error: 'invalid driver id' });
  }

  const driver = await driverModel.findById(driverId);
  if (!driver) {
    return res.status(404).json({ error: 'driver not found' });
  }

  const isDispatcher = req.user.role === 'dispatcher';
  const isSelf = req.user.role === 'driver' && driver.user_id === req.user.userId;
  if (!isDispatcher && !isSelf) {
    return res.status(403).json({ error: 'you do not have access to this driver record' });
  }
  if (!driver.is_active) {
    return res.status(409).json({ error: 'driver is inactive' });
  }

  // Dispatchers can rename a driver profile; a driver editing their own
  // record can only touch their own operational fields, not their name.
  const allowedFields = isDispatcher ? ['name', 'phone', 'vehicleType', 'status'] : ['phone', 'vehicleType', 'status'];
  const body = req.body || {};
  const disallowed = Object.keys(body).filter((key) => !allowedFields.includes(key));
  if (disallowed.length > 0) {
    return res.status(400).json({ error: `field(s) not editable here: ${disallowed.join(', ')}` });
  }

  const updates = {};
  if (body.name !== undefined) {
    if (!isNonEmptyString(body.name, 255)) {
      return res.status(400).json({ error: 'name must be a non-empty string (max 255 characters)' });
    }
    updates.name = body.name.trim();
  }
  if (body.phone !== undefined) {
    if (!isNonEmptyString(body.phone, 50)) {
      return res.status(400).json({ error: 'phone must be a non-empty string (max 50 characters)' });
    }
    updates.phone = body.phone.trim();
  }
  if (body.vehicleType !== undefined) {
    if (!isNonEmptyString(body.vehicleType, 50)) {
      return res.status(400).json({ error: 'vehicleType must be a non-empty string (max 50 characters)' });
    }
    updates.vehicle_type = body.vehicleType.trim();
  }
  if (body.status !== undefined) {
    if (!DRIVER_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `status must be one of: ${DRIVER_STATUSES.join(', ')}` });
    }
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'at least one valid field must be provided' });
  }

  const updated = await driverModel.updateDriver(driverId, updates);
  return res.status(200).json({ driver: toPublicDriver(updated) });
}

async function deactivateDriver(req, res, next) {
  const driverId = parsePositiveInt(req.params.id);
  if (!driverId) {
    return res.status(400).json({ error: 'invalid driver id' });
  }

  const driver = await driverModel.findById(driverId);
  if (!driver) {
    return res.status(404).json({ error: 'driver not found' });
  }

  // Idempotent: re-deleting an already-inactive driver just confirms the state.
  const updated = driver.is_active ? await driverModel.deactivateDriver(driverId) : driver;
  return res.status(200).json({ driver: toPublicDriver(updated) });
}

module.exports = {
  createDriverProfile,
  listDrivers,
  getDriver,
  getDriverLocation,
  updateDriverProfile,
  deactivateDriver,
};
