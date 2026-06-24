# Database Schema

Raw SQL migrations live in [src/db/migrations](src/db/migrations). They run in filename order, tracked in a `schema_migrations` table (see [src/db/migrate.js](src/db/migrate.js)).

## Entities and relationships

```
users 1───1 drivers 1───* locations
  │1                │1
  │                 │
  *                 *
orders ────────────┘
(customer_id)   (driver_id, nullable)
```

- **users** is the base identity table for everyone in the system — customers, drivers, and dispatchers — distinguished by the `role` enum. Auth/profile data common to all roles lives here.
- **drivers** extends a user with driver-specific operational data (phone, vehicle type, online/offline/busy status, plus `is_active` - see below). It has a `user_id` FK back to `users`, with a **unique constraint** on `user_id` — a user can have at most one driver profile (1:1, not 1:many). Driver-only fields are kept out of `users` so customers/dispatchers don't carry meaningless empty columns.
- **orders** belongs to one customer (`customer_id → users.id`) and is assigned to at most one driver (`driver_id → drivers.id`, nullable until a dispatcher assigns it). `status` enum models the delivery lifecycle (`created → assigned → picked_up → in_transit → delivered`, enforced as forward-only single-step transitions at the API layer - see [README.md](README.md#orders)). `customer_id` uses `ON DELETE RESTRICT` (don't silently orphan order history by deleting a customer); `driver_id` uses `ON DELETE SET NULL` (losing a driver record shouldn't destroy the order, just unassign it - though in practice this never fires now, since drivers are soft-deleted, never actually removed). A trigger keeps `updated_at` current on every row update. Pickup/dropoff are stored as a required human-readable address plus optional lat/lng (added in migration 006); package details are a required free-text description plus an optional weight.
- **locations** holds the **current** position of each driver (`driver_id → drivers.id`). One row per driver, enforced by a unique constraint on `driver_id`.

## Why "upsert latest" instead of a location history table

`locations` is designed to hold exactly one row per driver, kept current via `INSERT ... ON CONFLICT (driver_id) DO UPDATE SET latitude = ..., longitude = ..., updated_at = now()`.

Reasoning:

- **Read pattern dominates.** The core real-time use case — "where is this driver right now" for a live map / Socket.IO broadcast / order-detail lookup — only ever needs the latest point. Upsert-latest keeps that a single indexed lookup (`WHERE driver_id = $1`) against a table bounded by the number of drivers, not the number of GPS pings ever received.
- **Write volume.** GPS updates can arrive every few seconds per active driver. An append-only history table would grow unbounded and need pruning/partitioning strategy from day one to keep the "latest" query fast (you'd need a window function or a covering index just to find the newest row per driver). Upsert-latest avoids that problem entirely for the feature that's actually needed now.
- **Tradeoff accepted:** we give up any built-in trail of where a driver has been. If a future requirement needs route playback, analytics, or dispute resolution ("prove the driver was near the dropoff at time X"), the right move is to **add** a separate `location_history` table (`driver_id`, `latitude`, `longitude`, `recorded_at`, no unique constraint) fed by the same write path — not repurpose this table. That keeps the hot "latest location" query cheap while still allowing history to be captured for whichever consumer needs it (e.g. written asynchronously, or only sampled every N seconds).

This write path is now live: `sockets/handlers/location.js` upserts this table on every accepted `location:update`. The app-level throttling described in [README.md](README.md#live-location-tracking-socketshandlerslocationjs) (≥4s or ≥25m moved) keeps the write rate sane independent of this table's design - the two are complementary, not redundant: upsert-latest bounds the table's *size*, throttling bounds the *write frequency* against that one row.

## Why `drivers.is_active` (soft delete) instead of removing the row

`DELETE /drivers/:id` sets `is_active = false` (and `status = 'offline'`) rather than running a SQL `DELETE` (migration 005).

- `orders.driver_id` references `drivers.id`. Even though that FK is `ON DELETE SET NULL`, a hard delete would still sever a delivered order's link to who actually delivered it - exactly the kind of historical record this platform needs to keep (proof of delivery, dispute resolution, driver performance history).
- `is_active` is a separate column from the `status` enum (`online`/`offline`/`busy`) on purpose: those two are different axes. `status` is "is this driver currently working a shift"; `is_active` is "does this driver profile still exist as far as the dispatcher's roster is concerned." Conflating them (e.g. adding an `'inactive'` status value) would force every place that switches on live status to also handle the deactivated case.
- `GET /drivers` (the roster list) filters to `is_active = true` by default, so deactivated drivers drop out of the working view; `GET /drivers/:id` does not filter on it, since a dispatcher or an old order still needs to resolve a deactivated driver by id. Mutating endpoints (`PUT /drivers/:id`, driver assignment on `PUT /orders/:id`) reject inactive drivers (`409`/`400`).

## Why native Postgres ENUM types instead of VARCHAR + CHECK

`role`, `status` (drivers), and `status` (orders) are implemented as Postgres `ENUM` types rather than `VARCHAR` with a `CHECK` constraint. Enums are stored as 4 bytes, reject invalid values at the database layer (not just in application code), and self-document the valid state set. The tradeoff is that adding a new enum value later requires an `ALTER TYPE ... ADD VALUE` migration rather than just relaxing a `CHECK` — acceptable here since these are small, stable domain vocabularies for this app.

## Why a raw `pg` driver instead of an ORM

The requirements asked for raw SQL migrations, so query code follows the same philosophy: [src/config/db.js](src/config/db.js) exposes a plain `pg` `Pool`, no ORM (Sequelize/Prisma/TypeORM) is used.

- The schema is small (4 tables) and unlikely to need an ORM's model-sync or relation-loading machinery to stay manageable.
- Raw SQL keeps the two trickiest behaviors in this domain — the locations upsert and order status transitions — fully visible in the query itself, rather than hidden behind ORM-generated SQL.
- If the project later grows (many more tables, complex joins, a need for typed query results), **Prisma** would be the natural upgrade: it can introspect an existing hand-written schema, generate types from it, and still lets you drop to raw SQL (`prisma.$queryRaw`) where needed — so adopting it later wouldn't require discarding these migrations.
