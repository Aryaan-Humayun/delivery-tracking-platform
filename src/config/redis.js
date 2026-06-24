const { createClient } = require('redis');
const config = require('./env');

const redisClient = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    // node-redis retries forever with backoff by default, which means a
    // failed connect() never rejects - it just hangs waiting to eventually
    // succeed. That hangs the whole server at startup (see server.js) and,
    // since this client has no other retry path, would also leave a later
    // mid-session disconnect stuck the same way. Disabling it makes every
    // connect()/command fail fast and visibly instead, which is what lets
    // server.js and auth.middleware.js degrade gracefully rather than hang.
    // Tradeoff: this client will not auto-reconnect on its own if Redis
    // comes back after an outage - the process needs a restart to resume
    // blocklist enforcement. Same limitation, same fix, as the Socket.IO
    // Redis adapter's clients in sockets/index.js.
    reconnectStrategy: false,
  },
});

redisClient.on('error', (err) => console.error('Redis client error:', err));

module.exports = redisClient;
