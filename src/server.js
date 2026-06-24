const http = require('http');
const app = require('./app');
const config = require('./config/env');
const redisClient = require('./config/redis');
const initSocket = require('./sockets');

async function start() {
  try {
    await redisClient.connect();
  } catch (err) {
    // Fails open (see verifyAuthToken in auth.middleware.js for the full
    // reasoning): the JWT blocklist is best-effort, not load-bearing for
    // baseline authentication, so a Redis outage at startup shouldn't take
    // down the entire app. Continues without a connected client - every
    // later blocklist check hits this same rejected state and fails open too.
    // Connection errors can arrive as an AggregateError (Node's dual-stack
    // IPv6/IPv4 connect attempts) whose top-level message is blank; the real
    // reason is in err.errors. Same issue as health.controller.js.
    const reason = (err.errors && err.errors.map((e) => e.message).join('; ')) || err.message;
    console.error(`Redis (blocklist) unavailable at startup, continuing in degraded mode: ${reason}`);
  }

  const server = http.createServer(app);
  const io = await initSocket(server);
  // Lets REST controllers reach the same io instance (e.g. to emit
  // notifications from orders.controller.js) via req.app.get('io') - no new
  // dependency between controllers/ and sockets/ in either direction, so no
  // risk of a circular import. app.js itself stays completely unaware of
  // Socket.IO; this is the only place that wires the two together.
  app.set('io', io);

  server.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
