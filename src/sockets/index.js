const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const config = require('../config/env');
const socketAuthenticate = require('./middleware/auth');
const registerConnectionHandlers = require('./handlers/connection');
const registerLocationHandlers = require('./handlers/location');

// Socket.IO's default adapter only knows about sockets connected to this one
// process. Fine for a single instance, but if this app ever runs as multiple
// instances behind a load balancer, a `socket.to('dispatchers').emit(...)`
// fired on instance A would never reach a dispatcher whose socket happens to
// be connected to instance B. The Redis adapter fixes that by publishing
// every broadcast through Redis pub/sub so every instance hears it and
// delivers to whichever of its own locally-connected sockets are in that
// room. See SOCKETS.md for the fuller explanation.
//
// Two separate connections (pub + sub) because a Redis connection that has
// issued SUBSCRIBE is dedicated to that subscription and can't also run
// regular commands - this is a Redis pub/sub requirement, not a Socket.IO
// one. `pubClient.duplicate()` clones the same connection options without
// repeating them, which is the pattern the adapter's own docs use.
async function attachRedisAdapter(io) {
  const pubClient = createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      connectTimeout: 5000,
      // node-redis retries forever with backoff by default, which means a
      // failed connect() never rejects - it just hangs waiting to eventually
      // succeed. That would hang the whole server at startup, exactly what
      // this is supposed to avoid. Disabling it makes connect() reject
      // promptly on the first failure so the catch below actually runs.
      reconnectStrategy: false,
    },
  });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => console.error('Redis adapter pub client error:', err));
  subClient.on('error', (err) => console.error('Redis adapter sub client error:', err));

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter attached (multi-instance-ready).');
  } catch (err) {
    // Socket.IO already defaults to its in-memory adapter when io.adapter()
    // is never called, so there's nothing else to "fall back" to here -
    // single-instance broadcasting keeps working exactly as before, it just
    // won't fan out across other instances if there ever are any.
    //
    // Connection errors can arrive as an AggregateError (Node's dual-stack
    // IPv6/IPv4 connect attempts) whose top-level message is blank; the real
    // reason is in err.errors. Same issue as health.controller.js.
    const reason = (err.errors && err.errors.map((e) => e.message).join('; ')) || err.message;
    console.warn(`Redis adapter unavailable, continuing with the in-memory adapter (single-instance only): ${reason}`);
    for (const client of [pubClient, subClient]) {
      try {
        client.destroy();
      } catch {
        // already closed/never connected - nothing to clean up
      }
    }
  }
}

async function initSocket(server) {
  const io = new Server(server, {
    // Local dev only (no cloud deployment for this project) - permissive CORS
    // so the plain-HTML test page can connect whether it's opened via file://
    // or a different local port.
    cors: { origin: '*' },
  });

  io.use(socketAuthenticate);
  registerConnectionHandlers(io);
  io.on('connection', (socket) => registerLocationHandlers(socket));

  await attachRedisAdapter(io);

  return io;
}

module.exports = initSocket;
