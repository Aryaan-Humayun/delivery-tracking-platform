const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const routes = require('./routes');
const swaggerSpec = require('./config/swagger');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();

// Local dev only (no cloud deployment for this project) - permissive CORS so
// the frontend dev server (a different origin/port) can call the REST API.
// Mirrors the same origin: '*' choice already made for Socket.IO in
// sockets/index.js.
app.use(cors());

// Before body parsing, so an over-limit request is rejected cheaply without
// the overhead of parsing its body first.
app.use(generalLimiter);
app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/', routes);

// Catches errors forwarded via next(err) from route handlers (see asyncHandler
// in auth.routes.js) so unexpected failures return JSON 500s instead of
// crashing the process or hanging the request.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
