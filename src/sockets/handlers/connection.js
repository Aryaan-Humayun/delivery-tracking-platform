const driverModel = require('../../models/driver.model');
const orderModel = require('../../models/order.model');

async function handleConnection(socket) {
  try {
    if (socket.user.role === 'driver') {
      const driver = await driverModel.findByUserId(socket.user.userId);
      if (!driver) {
        // role is 'driver' but no profile exists yet (e.g. a gap later filled
        // by POST /drivers) - nothing to join, let the client know why.
        socket.emit('error', { message: 'no driver profile found for this account' });
        return;
      }

      socket.driverId = driver.id;
      socket.join(`driver:${driver.id}`);
      // The client has no other way to learn its own driver_id, but needs it
      // to populate the driverId field on location:update payloads.
      socket.emit('driver:connected', { driverId: driver.id });

      if (driver.status !== 'online') {
        await driverModel.updateDriver(driver.id, { status: 'online' });
      }
      socket.to('dispatchers').emit('status:update', { driverId: driver.id, status: 'online' });
    } else if (socket.user.role === 'dispatcher') {
      socket.join('dispatchers');
    }
    // customer: no auto-join - see order:subscribe below.
  } catch (err) {
    console.error('Socket connection setup failed:', err);
    socket.emit('error', { message: 'failed to initialize connection' });
  }
}

async function handleOrderSubscribe(socket, payload) {
  try {
    if (socket.user.role !== 'customer') {
      socket.emit('error', { message: 'only customers can subscribe to an order this way' });
      return;
    }

    const orderId = Number(payload && payload.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      socket.emit('error', { message: 'orderId must be a positive integer' });
      return;
    }

    const order = await orderModel.findById(orderId);
    if (!order) {
      socket.emit('error', { message: 'order not found' });
      return;
    }
    if (order.customer_id !== socket.user.userId) {
      socket.emit('error', { message: 'you do not have access to this order' });
      return;
    }

    socket.join(`order:${orderId}`);
    socket.emit('order:subscribed', { orderId });
  } catch (err) {
    console.error('order:subscribe handler failed:', err);
    socket.emit('error', { message: 'failed to subscribe to order' });
  }
}

async function handleDisconnect(socket, reason) {
  try {
    console.log(
      `Socket ${socket.id} disconnected (userId=${socket.user?.userId}, role=${socket.user?.role}): ${reason}`
    );

    if (socket.user && socket.user.role === 'driver' && socket.driverId) {
      socket.to('dispatchers').emit('status:update', { driverId: socket.driverId, status: 'offline' });

      const driver = await driverModel.findById(socket.driverId);
      if (driver && driver.status !== 'offline') {
        await driverModel.updateDriver(socket.driverId, { status: 'offline' });
      }
    }
  } catch (err) {
    console.error('Socket disconnect handling failed:', err);
  }
}

function registerConnectionHandlers(io) {
  io.on('connection', (socket) => {
    handleConnection(socket);

    socket.on('order:subscribe', (payload) => {
      handleOrderSubscribe(socket, payload);
    });

    socket.on('disconnect', (reason) => {
      handleDisconnect(socket, reason);
    });
  });
}

module.exports = registerConnectionHandlers;
