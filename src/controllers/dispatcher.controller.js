const driverModel = require('../models/driver.model');
const userModel = require('../models/user.model');
const { toPublicUser } = require('./auth.controller');

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toPublicPendingDriver(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    vehicleType: row.vehicle_type,
    registeredAt: row.created_at,
  };
}

async function listPendingDrivers(req, res, next) {
  const rows = await driverModel.findPending();
  return res.status(200).json({ drivers: rows.map(toPublicPendingDriver) });
}

async function approveDriver(req, res, next) {
  const driverId = parsePositiveInt(req.params.id);
  if (!driverId) {
    return res.status(400).json({ error: 'invalid driver id' });
  }

  const driver = await driverModel.findById(driverId);
  if (!driver) {
    return res.status(404).json({ error: 'driver not found' });
  }

  const updatedUser = await userModel.updateStatus(driver.user_id, 'active');
  return res.status(200).json({ user: toPublicUser(updatedUser) });
}

async function rejectDriver(req, res, next) {
  const driverId = parsePositiveInt(req.params.id);
  if (!driverId) {
    return res.status(400).json({ error: 'invalid driver id' });
  }

  const driver = await driverModel.findById(driverId);
  if (!driver) {
    return res.status(404).json({ error: 'driver not found' });
  }

  const updatedUser = await userModel.updateStatus(driver.user_id, 'suspended');
  return res.status(200).json({ user: toPublicUser(updatedUser) });
}

module.exports = { listPendingDrivers, approveDriver, rejectDriver };
