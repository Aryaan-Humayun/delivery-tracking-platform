const express = require('express');
const healthRoutes = require('./health');
const authRoutes = require('./auth.routes');
const driversRoutes = require('./drivers.routes');
const ordersRoutes = require('./orders.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/drivers', driversRoutes);
router.use('/orders', ordersRoutes);

module.exports = router;
