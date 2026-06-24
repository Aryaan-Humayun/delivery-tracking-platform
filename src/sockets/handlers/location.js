const locationModel = require('../../models/location.model');
const orderModel = require('../../models/order.model');

// A driver's GPS can fire every 1-2s; persisting/broadcasting every single
// ping would spam Postgres and every subscribed client far more often than a
// map actually needs to look live. An update is accepted if EITHER enough
// time has passed since the last accepted one (so a stationary driver still
// produces an occasional "still here" heartbeat) OR the driver has moved far
// enough to be worth showing sooner than that. 4s / 25m: at city driving
// speed (~8 m/s) that's roughly the same cadence either way, while 25m sits
// comfortably above typical consumer GPS jitter (~3-10m) so a parked driver
// doesn't generate noise.
const MIN_UPDATE_INTERVAL_MS = 4000;
const MIN_DISTANCE_METERS = 25;

// Per-process, in-memory throttle state keyed by driverId - intentionally
// not Redis. The point of throttling is to decide "skip this" with zero I/O
// for the common (throttled) case; routing every ping through Redis just to
// maybe discard it would defeat that. This only holds within one server
// process, which is fine for this single-instance app - if this ever runs
// as multiple instances behind a load balancer, this specific bit of state
// (not the DB writes, which already go through one shared Postgres) would
// need to move to Redis - already used elsewhere in this app - to stay
// consistent across instances.
const lastAccepted = new Map();

const EARTH_RADIUS_METERS = 6371000;

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shouldAccept(driverId, latitude, longitude) {
  const previous = lastAccepted.get(driverId);
  if (!previous) return true;

  if (Date.now() - previous.timestamp >= MIN_UPDATE_INTERVAL_MS) return true;

  const distance = haversineDistanceMeters(previous.latitude, previous.longitude, latitude, longitude);
  return distance >= MIN_DISTANCE_METERS;
}

async function handleLocationUpdate(socket, payload) {
  try {
    if (socket.user.role !== 'driver') {
      socket.emit('error', { message: 'only a driver can send location updates' });
      return;
    }
    if (!socket.driverId) {
      socket.emit('error', { message: 'no driver profile found for this account' });
      return;
    }

    const driverId = Number(payload && payload.driverId);
    if (!Number.isInteger(driverId) || driverId <= 0) {
      socket.emit('error', { message: 'driverId must be a positive integer' });
      return;
    }
    if (driverId !== socket.driverId) {
      socket.emit('error', { message: 'driverId does not match your own driver profile' });
      return;
    }

    const latitude = Number(payload && payload.latitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      socket.emit('error', { message: 'latitude must be a number between -90 and 90' });
      return;
    }
    const longitude = Number(payload && payload.longitude);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      socket.emit('error', { message: 'longitude must be a number between -180 and 180' });
      return;
    }

    // Too soon and too small a move - this is normal GPS chatter, not a
    // client mistake, so drop it silently rather than emitting an error.
    if (!shouldAccept(driverId, latitude, longitude)) {
      return;
    }

    const location = await locationModel.upsertLocation({ driverId, latitude, longitude });
    // Only advance the throttle baseline once the write actually succeeds,
    // so a DB hiccup on this ping doesn't suppress the next one too.
    lastAccepted.set(driverId, { latitude, longitude, timestamp: Date.now() });

    const trackingPayload = { driverId, latitude, longitude, timestamp: location.updated_at };

    const activeOrder = await orderModel.findActiveByDriverId(driverId);
    if (activeOrder) {
      socket.to(`order:${activeOrder.id}`).emit('order:tracking', trackingPayload);
    }
    socket.to('dispatchers').emit('active:drivers', trackingPayload);
  } catch (err) {
    console.error('location:update handler failed:', err);
    socket.emit('error', { message: 'failed to process location update' });
  }
}

function registerLocationHandlers(socket) {
  socket.on('location:update', (payload) => {
    handleLocationUpdate(socket, payload);
  });

  socket.on('disconnect', () => {
    if (socket.driverId) {
      lastAccepted.delete(socket.driverId);
    }
  });
}

module.exports = registerLocationHandlers;
