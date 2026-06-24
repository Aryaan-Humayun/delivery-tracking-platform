const pool = require('../config/db');

async function createOrder(
  {
    customerId,
    pickupAddress,
    pickupLatitude,
    pickupLongitude,
    dropoffAddress,
    dropoffLatitude,
    dropoffLongitude,
    packageDescription,
    packageWeightKg,
  },
  db = pool
) {
  const result = await db.query(
    `INSERT INTO orders (
       customer_id, pickup_address, pickup_latitude, pickup_longitude,
       dropoff_address, dropoff_latitude, dropoff_longitude,
       package_description, package_weight_kg
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      customerId,
      pickupAddress,
      pickupLatitude,
      pickupLongitude,
      dropoffAddress,
      dropoffLatitude,
      dropoffLongitude,
      packageDescription,
      packageWeightKg,
    ]
  );
  return result.rows[0];
}

async function findById(id, db = pool) {
  const result = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findActiveByDriverId(driverId, db = pool) {
  const result = await db.query(
    `SELECT * FROM orders
     WHERE driver_id = $1 AND status IN ('assigned', 'picked_up', 'in_transit')
     ORDER BY created_at DESC LIMIT 1`,
    [driverId]
  );
  return result.rows[0] || null;
}

async function findOrders({ customerId, driverId, status } = {}, db = pool) {
  const conditions = [];
  const values = [];

  if (customerId !== undefined) {
    values.push(customerId);
    conditions.push(`customer_id = $${values.length}`);
  }
  if (driverId !== undefined) {
    values.push(driverId);
    conditions.push(`driver_id = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, values);
  return result.rows;
}

async function updateStatus(id, { status, driverId }, db = pool) {
  if (driverId !== undefined) {
    const result = await db.query(
      'UPDATE orders SET status = $1, driver_id = $2 WHERE id = $3 RETURNING *',
      [status, driverId, id]
    );
    return result.rows[0] || null;
  }
  const result = await db.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [
    status,
    id,
  ]);
  return result.rows[0] || null;
}

async function deleteIfCreated(id, db = pool) {
  const result = await db.query(
    "DELETE FROM orders WHERE id = $1 AND status = 'created' RETURNING id",
    [id]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

module.exports = { createOrder, findById, findActiveByDriverId, findOrders, updateStatus, deleteIfCreated };
