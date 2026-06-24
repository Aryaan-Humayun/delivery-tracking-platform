const swaggerJSDoc = require('swagger-jsdoc');
const config = require('./env');

// Reusable schemas/parameters live here in code rather than as JSDoc YAML,
// since they're shared across many routes - keeping them in one place avoids
// repeating the same object shape above every handler that returns it.
const definition = {
  openapi: '3.0.0',
  info: {
    title: 'Delivery Tracking Platform API',
    version: '1.0.0',
    description:
      'REST API for the real-time delivery tracking platform. Authenticate via POST /auth/login, ' +
      'then pass the returned JWT as `Authorization: Bearer <token>` on every other request. ' +
      'Socket.IO events are a separate real-time transport and are not expressible in OpenAPI - see SOCKETS.md for those.',
  },
  servers: [{ url: `http://localhost:${config.port}`, description: 'Local dev server' }],
  tags: [
    { name: 'Health', description: 'Service health check' },
    { name: 'Auth', description: 'Registration, login, logout' },
    { name: 'Drivers', description: 'Driver profile management and location lookup' },
    { name: 'Orders', description: 'Order lifecycle management' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    parameters: {
      DriverId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', example: 1 },
        description: 'Driver id',
      },
      OrderId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', example: 1 },
        description: 'Order id',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
        example: { error: 'a clear, specific error message' },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Alice Customer' },
          email: { type: 'string', format: 'email', example: 'alice@example.com' },
          role: { type: 'string', enum: ['customer', 'driver', 'dispatcher'], example: 'customer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Driver: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          userId: { type: 'integer', example: 2 },
          name: { type: 'string', example: 'Dan Driver' },
          phone: { type: 'string', example: '555-1234' },
          vehicleType: { type: 'string', example: 'bike' },
          status: { type: 'string', enum: ['online', 'offline', 'busy'], example: 'offline' },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      DriverLocation: {
        type: 'object',
        properties: {
          driverId: { type: 'integer', example: 1 },
          latitude: { type: 'number', format: 'float', example: 39.78 },
          longitude: { type: 'number', format: 'float', example: -89.65 },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          customerId: { type: 'integer', example: 1 },
          driverId: { type: 'integer', nullable: true, example: 1 },
          status: {
            type: 'string',
            enum: ['created', 'assigned', 'picked_up', 'in_transit', 'delivered'],
            example: 'created',
          },
          pickupAddress: { type: 'string', example: '1 Main St, Springfield' },
          pickupLatitude: { type: 'number', nullable: true, example: 39.78 },
          pickupLongitude: { type: 'number', nullable: true, example: -89.65 },
          dropoffAddress: { type: 'string', example: '42 Side St, Springfield' },
          dropoffLatitude: { type: 'number', nullable: true, example: 39.8 },
          dropoffLongitude: { type: 'number', nullable: true, example: -89.6 },
          packageDescription: { type: 'string', example: 'Small box of electronics' },
          packageWeightKg: { type: 'number', nullable: true, example: 2.5 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const options = {
  definition,
  // Scans these files for `@openapi` JSDoc comment blocks above each route handler.
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJSDoc(options);
