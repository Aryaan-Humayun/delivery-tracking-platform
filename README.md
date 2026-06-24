# Delivery Tracking Platform — Backend

Real-time delivery tracking backend assessment project. Implemented so far: project structure, database schema/migrations, a health check, JWT-based authentication, driver/order management, Socket.IO connection/auth/room lifecycle (with a Redis adapter for horizontal scaling), live GPS tracking (`location:update` -> throttled persistence -> `order:tracking`/`active:drivers` broadcasts), real-time order notifications, rate limiting, and interactive API docs. See [SCHEMA.md](SCHEMA.md) for schema rationale, [SOCKETS.md](SOCKETS.md) for the Socket.IO event reference, and `GET /api-docs` for the REST API reference.

## Stack

- Node.js + Express
- PostgreSQL — raw SQL migrations, queried via the `pg` driver (no ORM; see [SCHEMA.md](SCHEMA.md) for why)
- Redis — used to back a JWT logout blocklist (see [Authentication](#authentication) below); also available for future caching / Socket.IO scaling
- bcrypt — password hashing
- jsonwebtoken — JWT issuing/verification
- Socket.IO — authenticated connections, role-based rooms, and live GPS broadcasting are in place (see [Socket.IO](#socketio) below)
- express-rate-limit — IP-based rate limiting (see [Rate limiting](#rate-limiting) below)
- swagger-jsdoc + swagger-ui-express — interactive REST API docs at `GET /api-docs` (see [API documentation](#api-documentation-openapiswagger) below)
- @socket.io/redis-adapter — makes the Socket.IO layer horizontally scalable across multiple instances (see [Scaling](#scaling-the-redis-adapter) below)

Everything below runs entirely on your machine with free, local tools. No cloud accounts, no API keys.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose) — used only to run local Postgres and Redis containers, no account/billing required

## Project structure

```
src/
  app.js              Express app (rate limiter, body parsing, /api-docs, route mounting, error handler)
  server.js           Entry point — connects Redis, starts the HTTP server, attaches io to the app
  config/
    env.js            Loads and validates .env into a config object
    db.js             PostgreSQL connection pool (pg)
    redis.js          Redis client
    swagger.js        Builds the OpenAPI spec (swagger-jsdoc) from JSDoc comments in routes/*.js
  routes/
    index.js          Mounts all route groups
    health.js          GET /health
    auth.routes.js     POST /auth/register, /auth/login, /auth/logout
    drivers.routes.js  /drivers CRUD
    orders.routes.js   /orders CRUD
  controllers/
    health.controller.js
    auth.controller.js
    drivers.controller.js
    orders.controller.js
  middleware/
    auth.middleware.js  authenticate (JWT verification) + requireRole(...roles) + shared verifyAuthToken/AuthError
    asyncHandler.js     forwards async handler rejections to the error handler
    rateLimit.js        generalLimiter (all routes) + authLimiter (register/login only)
  models/
    user.model.js      User queries (createUser, findByEmail, findById)
    driver.model.js    Driver queries (createDriver, findById, findByUserId, findAll, updateDriver, deactivateDriver)
    order.model.js     Order queries (createOrder, findById, findActiveByDriverId, findOrders, updateStatus, deleteIfCreated)
    location.model.js  Location queries (upsertLocation, findByDriverId)
  sockets/
    index.js            initSocket(server) - creates the Socket.IO server, attaches the Redis adapter, wires auth + connection + location handling
    middleware/auth.js   io.use() handshake auth, reuses verifyAuthToken from the REST middleware
    handlers/
      connection.js      role-based room joins, order:subscribe, disconnect handling
      location.js        location:update - validation, throttling, persistence, order:tracking/active:drivers broadcasts
  db/
    migrate.js        Minimal migration runner
    migrations/       Raw .sql migration files, applied in filename order
docker-compose.yml    Local Postgres + Redis
.env.example          Environment variable template
SCHEMA.md             Schema design and rationale
SOCKETS.md            Socket.IO event reference (payloads, rooms, roles) - the part Swagger can't show
socket-test.html      Standalone manual test page for the Socket.IO layer (see below)
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then set a real `JWT_SECRET` in `.env` (it has no default — the app refuses to start without one):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the output as `JWT_SECRET=...` in `.env`. The rest of the defaults already match `docker-compose.yml`.

### 3. Start Postgres and Redis

```bash
docker compose up -d
docker compose ps
```

Wait until `postgres` shows `healthy`.

### 4. Run migrations

```bash
npm run migrate
```

This applies each file in `src/db/migrations/` in order inside a transaction, and records applied migrations in a `schema_migrations` table so re-running is safe (already-applied files are skipped).

### 5. Start the dev server

```bash
npm run dev
```

(or `npm start` to run without file-watching)

### 6. Verify

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "2026-06-21T...", "db": "connected", "redis": "connected" }
```

If Postgres or Redis isn't reachable, this returns HTTP 503 with the corresponding field set to `"disconnected"` plus an error message.

## Rate limiting

Two [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) limiters, both IP-based, both configurable via `.env` (see `RATE_LIMIT_*`/`AUTH_RATE_LIMIT_*` in `.env.example`) so you can loosen them while testing rather than editing code:

- **General** (`generalLimiter` in [middleware/rateLimit.js](src/middleware/rateLimit.js)) - applied to every route, first thing in [app.js](src/app.js), before body parsing even runs. Default: 100 requests / 15 minutes / IP.
- **Auth** (`authLimiter`) - stacks on top of the general limiter, specifically on `POST /auth/register` and `POST /auth/login` (not `/auth/logout` - there's nothing to brute-force there), to slow down credential-guessing and spam signups. Default: 5 requests / 15 minutes / IP.

Both return a clean JSON `429` rather than a generic error or an empty body:

```json
{ "error": "Too many login/registration attempts from this IP, please try again later." }
```

`RateLimit-*` response headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy`) are included on every response so a client can see how close it is to the limit before hitting it.

Verified directly: 6 rapid `POST /auth/login` calls return five `401`s (wrong password, normal) followed by a `429` on the sixth; with `RATE_LIMIT_MAX` temporarily dropped to 10, 12 rapid `GET /health` calls returned ten `200`s followed by two `429`s, and normal use was confirmed unaffected again once the default (100) was restored. Each limiter's counters are in-memory per server process - restarting the server (or waiting out the window) clears them, which is why testing the general limiter used a temporarily-lowered value rather than actually sending 100+ requests.

## API documentation (OpenAPI/Swagger)

Interactive, always-current REST API docs at **[`GET /api-docs`](http://localhost:3000/api-docs)** once the server is running - generated by [swagger-jsdoc](https://www.npmjs.com/package/swagger-jsdoc) from `@openapi` JSDoc comments written directly above each route handler in `src/routes/*.js`, and served by [swagger-ui-express](https://www.npmjs.com/package/swagger-ui-express). Every REST route (health, auth, drivers, the location lookup, orders) is documented with its required fields, example payloads, and every response code the handler can actually return (400/401/403/404/409/429 included, not just the happy path).

- Reusable pieces (the `User`/`Driver`/`DriverLocation`/`Order`/`Error` schemas, the `bearerAuth` security scheme, the `DriverId`/`OrderId` path parameters) are defined once in code in [config/swagger.js](src/config/swagger.js) and referenced (`$ref`) from every route's JSDoc, rather than repeated above each handler.
- `bearerAuth` is the default security requirement for every operation; `/health`, `/auth/register`, and `/auth/login` explicitly opt out (`security: []`) in their own JSDoc since they don't require a token. Click **Authorize** in the UI and paste a JWT from `POST /auth/login` to try the protected routes interactively.
- **Socket.IO isn't here** - OpenAPI describes request/response HTTP endpoints, not a persistent bidirectional event stream, so it can't represent `location:update`, `order:tracking`, etc. at all. See **[SOCKETS.md](SOCKETS.md)** for those instead.

Verified directly: the page loads (`200`, `text/html`), all of its bundled JS/CSS assets load (`200`), and the embedded spec contains all 9 documented paths, the `bearerAuth` scheme, and the component schemas.

## Authentication

Three endpoints under `/auth`, backed by the existing `users`/`drivers` tables (no new migrations). Passwords are hashed with bcrypt and never appear in any response. JWTs carry only `{ userId, role, jti }` — never email — and expire after `JWT_EXPIRES_IN` (default 24h): long enough to avoid forcing re-login mid-shift, short enough to bound the damage if a token leaks, given there's no refresh-token flow yet.

### `POST /auth/register`

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Customer","email":"alice@example.com","password":"abc12345","role":"customer"}'
```

`role` is one of `customer`, `driver`, `dispatcher`. If `role` is `driver`, also pass `phone` and `vehicleType`; a row is created in `drivers` (status defaults to `offline`) in the same transaction as the user — both succeed or neither does:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Dan Driver","email":"dan@example.com","password":"abc12345","role":"driver","phone":"555-1234","vehicleType":"bike"}'
```

Responses: `201` with the created user (and `driver`, if applicable) on success; `400` for missing/malformed fields, weak passwords (<8 chars or missing a letter/number), or an invalid `role`; `409` if the email is already registered.

### `POST /auth/login`

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"abc12345"}'
```

Returns `200` with `{ token, user }` on success. Returns `401` with the same generic `"invalid email or password"` message whether the email doesn't exist or the password is wrong, so the response can't be used to enumerate registered emails.

### `POST /auth/logout`

Protected route — requires `Authorization: Bearer <token>`:

```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer <token from login>"
```

Returns `200` on success. This isn't a server-side no-op: the token's `jti` is added to a Redis blocklist (key TTL = the token's own remaining lifetime, so Redis expires it automatically — no cleanup job, no unbounded growth). Reusing the same token after logout now returns `401 "token has been revoked"`. See the comment above `logout` in [auth.controller.js](src/controllers/auth.controller.js) for the full reasoning.

#### What happens if Redis is down

The blocklist read (checking a token during `authenticate`) and the blocklist write (revoking a token during `logout`) are deliberately handled differently:

- **Reading the blocklist fails open.** If Redis can't be reached, `verifyAuthToken` ([auth.middleware.js](src/middleware/auth.middleware.js)) logs a warning and treats the token as not-revoked rather than rejecting it - the JWT's own signature/expiry check is unaffected either way. This applies identically to REST and Socket.IO, since both go through the same function.
- **Writing to the blocklist still fails loudly.** If Redis is down, `POST /auth/logout` returns a `500`, not a false `200 "logged out"` - silently claiming success when nothing was actually revoked would be actively misleading, not just permissive.

**Why fail open instead of failing closed (rejecting every authenticated request with a `503` until Redis is back):** the blocklist exists to close one specific, narrow gap - a token revoked via logout being replayed before its own natural expiry (capped at `JWT_EXPIRES_IN`, 24h by default) - on top of authentication that's already fully secured by the JWT's signature and expiry, independent of Redis entirely. Failing closed would mean a single Redis hiccup (a restart, a brief network blip) takes down *every* authenticated REST and Socket.IO request in the app, to guard against a narrow, time-bounded edge case. That trade is the wrong way around for this app: a transient infrastructure blip shouldn't be able to take down the entire API just because one defense-in-depth check couldn't run. This also matches how the Socket.IO Redis adapter degrades (see [Scaling](#scaling-the-redis-adapter)) - Redis being unavailable narrows what the app can do, it doesn't take the app down.

This required the same `reconnectStrategy: false` fix as the adapter's clients ([config/redis.js](src/config/redis.js)): node-redis retries forever with backoff by default, so a failed `connect()` just hangs rather than rejecting - which previously meant a Redis outage at startup would hang the *entire server* indefinitely (`server.js` awaits this connection before listening), regardless of any fail-open logic downstream, since nothing downstream would ever run. With the fix, a Redis outage at startup now logs a clear warning and the server finishes starting within seconds, fully functional in degraded mode. Verified directly: stopped the Redis container, confirmed the server started in ~5s (not hanging) with a clear warning, confirmed an authenticated REST request and a Socket.IO connection both succeeded (fail open), confirmed `logout` still returned a `500` rather than lying about success, then restored Redis and restarted to confirm blocklist enforcement resumes normally. As with the adapter, this client doesn't auto-reconnect once it's given up - recovering after an outage needs a server restart.

### Using the token on other routes

`middleware/auth.middleware.js` exports:
- `authenticate` — verifies the JWT (signature, expiry, and blocklist), attaches `req.user = { userId, role }`. Returns `401` if missing/malformed/invalid/expired/revoked.
- `requireRole(...roles)` — call after `authenticate`; returns `403` if `req.user.role` isn't one of the allowed roles. Used like `router.get('/orders', authenticate, requireRole('dispatcher'), handler)`.

Both are reused as-is for the Socket.IO auth handshake when that's built.

## Drivers

All `/drivers` routes require `Authorization: Bearer <token>`.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/drivers` | dispatcher | Attaches a driver profile to an existing user whose `role` is already `driver` but has no profile yet (data gaps, not the normal signup path - registration already creates this row atomically). `409` if that user already has one. |
| GET | `/drivers` | dispatcher | Lists active (`is_active = true`) drivers; optional `?status=online\|offline\|busy`. |
| GET | `/drivers/:id` | dispatcher, or the driver themselves | `404` if no such driver, `403` if it exists but isn't theirs. Not filtered by `is_active` - deactivated drivers are still resolvable by id. |
| GET | `/drivers/:id/location` | dispatcher, the driver themselves, or a customer with an *active* order assigned to that driver | REST fallback for a page load before any socket update has arrived - see [Socket.IO](#live-location-tracking-socketshandlerslocationjs) for the real-time path. `404` if the driver doesn't exist, `403` if it exists but the caller has no access, `404` (`"no location recorded for this driver yet"`) if access is fine but no `location:update` has ever landed for them. |
| PUT | `/drivers/:id` | dispatcher, or the driver themselves | Dispatchers may update `name`, `phone`, `vehicleType`, `status`. A driver updating their own record may update `phone`, `vehicleType`, `status` only - not `name`. `409` if the driver is inactive. |
| DELETE | `/drivers/:id` | dispatcher | Soft delete: sets `is_active = false` and `status = 'offline'`, doesn't remove the row (orders reference drivers historically). Idempotent. See [SCHEMA.md](SCHEMA.md) for why. |

Customer access to `/drivers/:id/location` is checked via `orderModel.findActiveByDriverId` (the same query the socket layer uses to decide whether to broadcast `order:tracking`) - it only counts an order whose `status` is `assigned`/`picked_up`/`in_transit`. A customer whose order with that driver has already reached `delivered` loses access to that driver's live location again, since there's no ongoing delivery left to track. This wasn't fully spelled out in the original ask, so it's worth being explicit: "any order ever, regardless of status" was the other reasonable reading, but it would mean a driver's *current* position stays visible to every past customer indefinitely, which felt like the wrong default given the location is genuinely live (it gets overwritten by `location:update`, not append-only history).

```bash
curl http://localhost:3000/drivers/1/location -H "Authorization: Bearer <dispatcher/self/active-customer token>"
# {"location":{"driverId":1,"latitude":39.85,"longitude":-89.55,"updatedAt":"2026-06-21T11:31:11.954Z"}}

curl -X PUT http://localhost:3000/drivers/1 \
  -H "Authorization: Bearer <driver's token>" -H "Content-Type: application/json" \
  -d '{"status":"online"}'
```

## Orders

All `/orders` routes require `Authorization: Bearer <token>`. Reads are scoped by role: customers see only their own orders, drivers see only orders assigned to them, dispatchers see everything; `GET /orders` also takes an optional `?status=` filter.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/orders` | customer | `customerId` comes from the token, not the body. Starts at `status: 'created'`, no driver. |
| GET | `/orders` | any authenticated user | Scoped per role as above. |
| GET | `/orders/:id` | owning customer, assigned driver, or dispatcher | `404` if no such order, `403` if it exists but isn't theirs. |
| PUT | `/orders/:id` | dispatcher (for `created → assigned`) or the assigned driver (for everything after) | Status only moves forward one step at a time: `created → assigned → picked_up → in_transit → delivered`. Invalid/out-of-order/skipped transitions get a `400` naming the valid next status. |
| DELETE | `/orders/:id` | dispatcher | Only while `status` is still `created` - `409` otherwise. See the comment above `deleteOrder` in [orders.controller.js](src/controllers/orders.controller.js). |

The two trickiest flows:

**Dispatcher assigns a driver:**

```bash
curl -X PUT http://localhost:3000/orders/1 \
  -H "Authorization: Bearer <dispatcher's token>" -H "Content-Type: application/json" \
  -d '{"status":"assigned","driverId":1}'
```

`driverId` is required for this transition only, must reference an existing, active driver, and only a dispatcher may make it - even the order's own customer gets `403`.

**Driver progresses an order they're assigned to:**

```bash
curl -X PUT http://localhost:3000/orders/1 \
  -H "Authorization: Bearer <assigned driver's token>" -H "Content-Type: application/json" \
  -d '{"status":"picked_up"}'

curl -X PUT http://localhost:3000/orders/1 \
  -H "Authorization: Bearer <assigned driver's token>" -H "Content-Type: application/json" \
  -d '{"status":"in_transit"}'

curl -X PUT http://localhost:3000/orders/1 \
  -H "Authorization: Bearer <assigned driver's token>" -H "Content-Type: application/json" \
  -d '{"status":"delivered"}'
```

These three transitions are restricted to whichever driver is actually assigned (`drivers.id` resolved from the caller's token must equal the order's `driver_id`) - not even a dispatcher can make them; a different driver or the customer gets `403`. Skipping a step (e.g. `assigned → in_transit`) gets a `400` naming the valid next status.

Every successful transition except `in_transit` also pushes a real-time `notification` over the socket layer (see [Order notifications](#order-notifications-pushed-from-put-ordersid) below) - the REST response and the DB write are unaffected either way.

## Socket.IO

The Socket.IO server runs on the same HTTP server/port as Express (`src/server.js` wraps `app` in `http.createServer` so both share port 3000). No new routes - this is a separate real-time transport authenticated the same way as the REST API.

### Scaling: the Redis adapter

This app runs as a single instance, but `sockets/index.js` attaches [`@socket.io/redis-adapter`](https://www.npmjs.com/package/@socket.io/redis-adapter) so it's already multi-instance-ready - room broadcasts (`status:update`, `order:tracking`, `active:drivers`, `notification`) get published through the same Redis already running via `docker-compose`, instead of staying trapped in one process's memory, which is what would silently break those broadcasts the moment a second instance existed. **See [SOCKETS.md](SOCKETS.md#scaling-across-multiple-instances-the-redis-adapter) for the full explanation** - including why two Redis connections are needed, and exactly how this answers "how would you scale Socket.IO across multiple servers."

If Redis can't be reached when the adapter tries to connect at startup, it logs a warning and the server starts anyway with Socket.IO's default in-memory adapter (single-instance behavior, identical to before this was added) - it doesn't block or crash startup. Verified directly: pointing the adapter at a deliberately wrong port produces the warning and the server still starts and answers requests normally; the existing `socket-test.html` flows (driver online/offline, `order:subscribe`, `location:update` -> `order:tracking`/`active:drivers`) were re-run against the real adapter afterward and behave identically to before it was added, which is the expected outcome for a single instance - the adapter is invisible in behavior until there's more than one of these running.

### Connecting

Clients authenticate during the handshake, not via a header - pass the JWT as `auth.token`:

```js
const socket = io('http://localhost:3000', { auth: { token: '<JWT from /auth/login>' } });
```

`sockets/middleware/auth.js` runs as `io.use()` middleware (before `connection` fires) and calls the *same* `verifyAuthToken` function the REST `authenticate` middleware uses - same secret, same expiry check, same Redis blocklist lookup by `jti`. A logged-out token is rejected here exactly like it is on a REST request. On failure it calls `next(new Error(message))`, which Socket.IO turns into a `connect_error` event on the client with that message (`"missing auth token"`, `"invalid or expired token"`, or `"token has been revoked"`) - the connection never reaches `connection`. On success, `socket.user = { userId, role }` is attached, mirroring `req.user` on the REST side.

### Connection lifecycle (`sockets/handlers/connection.js`)

- **driver**: looks up their `drivers` row via `user_id`, joins room `driver:<driverId>`, and - if `status` isn't already `'online'` - updates it in the DB and broadcasts `status:update` (`{ driverId, status: 'online' }`) to the `dispatchers` room. (If the account has no driver profile yet, it emits an `error` event instead of joining anything.)
- **dispatcher**: joins room `dispatchers` - no DB lookup needed.
- **customer**: no auto-join. Use `order:subscribe`:

  ```js
  socket.emit('order:subscribe', { orderId: 1 });
  socket.on('order:subscribed', (payload) => { /* { orderId: 1 } */ });
  socket.on('error', (payload) => { /* { message: '...' } */ });
  ```

  The server looks the order up and checks `order.customer_id` against the caller before joining `order:<orderId>` - `error` with `"order not found"` if it doesn't exist, `"you do not have access to this order"` if it exists but isn't theirs. Non-customers get `"only customers can subscribe to an order this way"`.

- **disconnect**: if the socket was a driver, broadcasts `status:update` (`{ driverId, status: 'offline' }`) to `dispatchers` and updates the DB to `'offline'` if it wasn't already. The reason Socket.IO gives (`"client namespace disconnect"`, `"transport close"`, etc.) is logged server-side.

Every handler (`connection` setup, `order:subscribe`, `disconnect`) has its own try/catch that logs the error and - where there's still a connected client to tell - emits a generic `error` event, so a bad payload or an unexpected DB error can't crash the socket server or another client's connection.

One known simplification: presence (online/offline) is tracked per-socket, not per-driver-account. If the same driver account opens two connections (two tabs/devices) and one disconnects, the DB and broadcast will say `offline` even though the other connection is still live. Fixing that needs a connection-count (e.g. in Redis) and is out of scope for this step.

### Live location tracking (`sockets/handlers/location.js`)

A driver emits `location:update` with `{ driverId, latitude, longitude }`. `driverId` must equal that socket's own `driverId` (set during the connection handshake, see below) - a driver cannot report a position on behalf of another driver. Malformed payloads (missing/non-numeric fields, out-of-range lat/lng, a mismatched `driverId`) get a clear `error` event back; the socket is never dropped for this.

Because GPS can fire every 1-2s, accepted updates are throttled before they ever reach Postgres or a broadcast: an update is only persisted if **either** at least `MIN_UPDATE_INTERVAL_MS` (4000ms) has passed since the last accepted update for that driver, **or** the new point is at least `MIN_DISTANCE_METERS` (25m, via the haversine formula) from it. Both constants are defined at the top of `location.js`, with the reasoning in the comment above them. A throttled update is dropped silently - no `error` - since it's normal GPS chatter, not a mistake. Throttle state is an in-memory `Map` keyed by `driverId` (not Redis - see the comment in the file for why), cleared when that socket disconnects.

An accepted update:
1. Upserts `locations` (`INSERT ... ON CONFLICT (driver_id) DO UPDATE`, per [SCHEMA.md](SCHEMA.md)).
2. Looks up that driver's active order (`status` in `assigned`/`picked_up`/`in_transit`). If one exists, broadcasts `order:tracking` (`{ driverId, latitude, longitude, timestamp }`) to room `order:<orderId>` - exactly the customers/dispatchers already subscribed via `order:subscribe` get it, no polling.
3. Always broadcasts `active:drivers` with the same payload to the `dispatchers` room, regardless of whether the driver currently has an active order.

The client learns its own `driverId` via a `driver:connected` event emitted right after a driver socket joins its room (added to `connection.js` for this - without it, a driver client would have no way to know what `driverId` to put in its own `location:update` payloads).

### Order notifications, pushed from `PUT /orders/:id`

The assessment's five notification events break down as two different mechanisms, on purpose - they're not all the same kind of event:

- **driver online / driver offline** are already covered by the existing `status:update` broadcasts in `connection.js` (see [Connection lifecycle](#connection-lifecycle-socketshandlersconnectionjs) above) - fired the moment a driver's socket connects/disconnects. Nothing new was added for these; duplicating them under a second event name would just be two ways of saying the same thing.
- **order assigned / picked up / delivered** are pushed from inside the REST `updateOrderStatus` controller ([orders.controller.js](src/controllers/orders.controller.js)) as a side effect of a successful status transition - not from a client-emitted socket event. `in_transit` has no notification; it's not in the assessment's list.

All three emit a `notification` event shaped `{ orderId, status, message, timestamp }`:

| Transition | Recipients | `message` |
|---|---|---|
| `created` -> `assigned` | `order:<orderId>` (the customer) | `"Your order has been assigned to a driver."` |
| `created` -> `assigned` | `driver:<driverId>` (the newly assigned driver, if connected) | `"You have been assigned a new order."` |
| `assigned` -> `picked_up` | `order:<orderId>` | `"Your order has been picked up."` |
| `picked_up` -> `delivered`* | `order:<orderId>` | `"Your order has been delivered."` |
| `picked_up` -> `delivered`* | `dispatchers` | `"Order #<id> has been delivered."` |

\* via `in_transit` in between, per the normal transition chain - no notification fires on that intermediate step.

**Making `io` available to a REST controller, without coupling `sockets/` to `controllers/`:** `server.js` is the only file that touches both. It captures the return value of `initSocket(server)` and attaches it with `app.set('io', io)`, right where `app`, `server`, and `io` are already all in scope together. `orders.controller.js` reads it back via `req.app.get('io')` - the same `req`/`app` plumbing every Express handler already has, no new import in either direction. `sockets/index.js` and `app.js` stay exactly as ignorant of each other as before; only `server.js`'s wiring changed.

**Best-effort, by construction:** the DB write (`orderModel.updateStatus`) always happens and is awaited *before* `sendOrderNotifications` is ever called, and that call is wrapped in its own try/catch that only `console.error`s on failure - it cannot throw into the route handler, so a broken `io`, an empty room, or any other notification hiccup can never turn a successful status update into an error response to the client. Emitting to a room with nobody in it (e.g. the assigned driver isn't currently connected) is a Socket.IO no-op, not an error, so there's nothing extra to check for there either.

### Manual testing

[socket-test.html](socket-test.html) is a standalone page (no build step, no framework) for exercising this by hand:

1. Make sure the server is running (`npm run dev`).
2. Open `socket-test.html` directly in a browser (double-click works - it loads the Socket.IO client from `http://localhost:3000/socket.io/socket.io.js`, the server's own bundle, so no CDN/internet is needed).
3. Open it in two more tabs - three total.
4. In each tab, log in as a different test role and watch the event log:
   - **Driver tab**: log in as a `driver`-role user assigned to an active order (e.g. `dan@example.com` / `abc12345`) - it shows "Driver presence: online" on connect and your own driver id. Click **Point A/B/C** to send `location:update`s - each click logs locally; the *other* tabs are what show the broadcast arriving. Click the same point twice quickly to see the second one get silently throttled (no new line appears on the other tabs); click a different point right after and it goes through immediately (far enough to bypass the throttle).
   - **Dispatcher tab**: log in as a `dispatcher`-role user (e.g. `dave@example.com` / `abc12345`) - watch for `status:update` when the driver tab connects/disconnects, and `active:drivers` (with a `timestamp` in the payload) every time the driver tab sends a location update that isn't throttled.
   - **Customer tab**: log in as a `customer`-role user who owns that order (e.g. `alice@example.com` / `abc12345`), enter the order id, click **Subscribe**, then watch for `order:tracking` events as the driver tab sends updates - each one carries the new coordinates and a timestamp, so you can see it actually changing in real time, with no polling involved.

To see the "no active order" case, log in as a driver with nothing assigned - the dispatcher tab still gets `active:drivers`, but no `order:tracking` goes anywhere since no order room exists for them. The **Advanced** box on the driver tab can send a payload with a `driverId` that doesn't match the logged-in driver, to see the mismatch get rejected with a clear `error` instead of silently doing the wrong thing.

To see order notifications, drive the status transitions from a separate terminal with `curl` (they come from the REST API, not from anything in this page) while the driver/dispatcher/customer tabs are connected and the customer tab has subscribed to that order - each tab's log will show a `notification` line land in real time as you `PUT /orders/:id` through `assigned` -> `picked_up` -> `in_transit` (no notification, by design) -> `delivered`.

## Stopping / resetting

```bash
docker compose down        # stop containers, keep data
docker compose down -v     # stop containers and wipe Postgres/Redis volumes
```

## Next steps (not built yet)

- Per-driver-account presence tracking (see the multi-connection note under [Socket.IO](#socketio))
