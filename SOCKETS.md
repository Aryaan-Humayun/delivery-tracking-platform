# Socket.IO Events

This documents the real-time transport that OpenAPI/Swagger can't describe (see [README.md](README.md#socketio) for the fuller narrative version, and [api-docs](http://localhost:3000/api-docs) for the REST API). All events are on the default namespace, served from the same server/port as the REST API.

## Connecting

```js
const socket = io('http://localhost:3000', { auth: { token: '<JWT from POST /auth/login>' } });
```

The JWT is verified during the handshake (`sockets/middleware/auth.js`), using the exact same logic as the REST `authenticate` middleware - signature, expiry, and the Redis logout blocklist. On failure the connection is rejected before `connection` ever fires; the client gets a `connect_error` with one of these messages:

| `connect_error` message | Cause |
|---|---|
| `missing auth token` | No `auth.token` in the handshake |
| `invalid or expired token` | Bad signature, malformed JWT, or past `exp` |
| `token has been revoked` | The token's `jti` is on the Redis logout blocklist |

On success, `{ userId, role }` is attached to the socket server-side (mirrors `req.user` on the REST side) and `connection` fires - see below for what happens next per role.

## Server -> Client events

| Event | Payload | Sent to | When |
|---|---|---|---|
| `driver:connected` | `{ driverId }` | The connecting socket (driver only) | Right after a driver socket joins its room - the only way a driver client learns its own `driverId`, needed to populate `location:update` payloads. |
| `status:update` | `{ driverId, status: 'online' \| 'offline' }` | Room `dispatchers` | A driver socket connects (`online`) or disconnects (`offline`). This is the "driver online"/"driver offline" notification from the assessment spec - there is no separate event for it. |
| `order:subscribed` | `{ orderId }` | The requesting socket (customer only) | Ack for a successful `order:subscribe`. |
| `order:tracking` | `{ driverId, latitude, longitude, timestamp }` | Room `order:<orderId>` | An accepted (non-throttled) `location:update` from a driver who currently has an active order (`assigned`/`picked_up`/`in_transit`). Reaches whoever has subscribed to that order via `order:subscribe`. |
| `active:drivers` | `{ driverId, latitude, longitude, timestamp }` | Room `dispatchers` | Every accepted `location:update`, regardless of whether that driver has an active order. |
| `notification` | `{ orderId, status, message, timestamp }` | Varies - see table below | Pushed from the REST `PUT /orders/:id` handler as a side effect of a successful status transition, **not** from a client-emitted socket event. |
| `error` | `{ message }` | The socket that caused it | Any rejected/malformed event on any of the client->server events below. Never disconnects the socket. |

### `notification` recipients by transition

| Transition | Recipients | `message` |
|---|---|---|
| `created` -> `assigned` | `order:<orderId>` | `"Your order has been assigned to a driver."` |
| `created` -> `assigned` | `driver:<driverId>` (only reaches them if currently connected) | `"You have been assigned a new order."` |
| `assigned` -> `picked_up` | `order:<orderId>` | `"Your order has been picked up."` |
| `picked_up` -> `in_transit` | *(none - not part of the assessment's notification list)* | - |
| `in_transit` -> `delivered` | `order:<orderId>` | `"Your order has been delivered."` |
| `in_transit` -> `delivered` | `dispatchers` | `"Order #<id> has been delivered."` |

## Client -> Server events

| Event | Payload | Who | Validation / behavior |
|---|---|---|---|
| `order:subscribe` | `{ orderId }` | `customer` only | Looks up the order and checks `order.customer_id` against the caller. `error` with `"order not found"` if it doesn't exist, `"you do not have access to this order"` if it exists but isn't theirs, `"only customers can subscribe to an order this way"` for any other role. On success, joins room `order:<orderId>` and acks with `order:subscribed`. |
| `location:update` | `{ driverId, latitude, longitude }` | `driver` only | `driverId` must equal the caller's own `driverId` (`error: "driverId does not match your own driver profile"` otherwise - a driver cannot report another driver's position). `latitude`/`longitude` must be finite numbers in range (`-90..90` / `-180..180`), else `error`. **Throttled**: an update is only persisted/broadcast if ≥4s have passed since the last *accepted* update for that driver, or it has moved ≥25m (haversine) from it - otherwise it's silently dropped (no `error`; this is normal GPS chatter, not a mistake). See the comment block at the top of `sockets/handlers/location.js` for the exact constants and reasoning. An accepted update upserts `locations`, then emits `order:tracking`/`active:drivers` as described above. |

## Rooms reference

| Room | Who's in it |
|---|---|
| `driver:<driverId>` | That one driver's own socket(s). |
| `dispatchers` | Every connected `dispatcher` socket. |
| `order:<orderId>` | Customers who have called `order:subscribe` for that order (dispatchers/drivers don't auto-join this; nothing currently subscribes them to it). |

## Error handling

Every handler (`connection` setup, `order:subscribe`, `location:update`, `disconnect`) wraps its logic in try/catch. A bad payload, a DB hiccup, or any other failure logs server-side and - where there's still a connected client to tell - emits `error`; it never crashes the process or drops the socket. Disconnect reasons (`"client namespace disconnect"`, `"transport close"`, etc.) are logged server-side, not emitted to anyone.

## Scaling across multiple instances (the Redis adapter)

**The problem.** Socket.IO's default adapter keeps room membership (`dispatchers`, `driver:<id>`, `order:<id>`) and does broadcasting entirely in the memory of one Node process. That's invisible right now because there's exactly one instance. The moment there's more than one - say, two instances behind a load balancer for capacity or zero-downtime deploys - it breaks silently: a dispatcher's browser tab might have its WebSocket connection on instance B, while a driver's `location:update` lands on instance A. Instance A calls `socket.to('dispatchers').emit('active:drivers', ...)`, but instance A has no idea that dispatcher even exists - it's only in instance B's in-memory room table. The dispatcher on B simply never gets that update, with no error anywhere - the broadcast "succeeds" from A's point of view, it just never reaches anyone, since A only knows about its own locally-connected sockets.

**The fix.** [`@socket.io/redis-adapter`](https://www.npmjs.com/package/@socket.io/redis-adapter), wired up in [`sockets/index.js`](src/sockets/index.js), replaces room-broadcast delivery with Redis pub/sub: every `.to(room).emit(...)` is published to a Redis channel that *every* instance subscribes to, so instance A's broadcast reaches instance B (and C, D...) too, and each instance delivers it to whichever of *its own* locally-connected sockets are in that room. Redis becomes the shared coordination point that replaces "one process's memory" - this is the standard, officially-documented way to horizontally scale Socket.IO, not something specific to this app.

**Why two Redis connections.** The adapter needs a publisher and a subscriber. Once a Redis connection issues `SUBSCRIBE`, that connection is dedicated to receiving subscribed messages and can't also be used to `PUBLISH` or run other commands - that's a Redis protocol-level restriction, not a Socket.IO one. `pubClient.duplicate()` opens the second connection with the same options without repeating them.

**Why this didn't need a new instance of Redis.** It's the same Redis already running via `docker-compose` for the JWT logout blocklist ([`config/redis.js`](src/config/redis.js)) - a different logical use of the same server, on its own pair of connections. Nothing about the adapter required provisioning anything new.

**Graceful degradation.** If Redis can't be reached when the adapter tries to connect at startup, `attachRedisAdapter` catches the failure, logs a warning, and simply never calls `io.adapter(...)` - Socket.IO already defaults to its in-memory adapter when that's never called, so there's no separate fallback code path to write. The server finishes starting and works exactly as it does today, just back to single-instance-only broadcasting. One real bug surfaced while building this: node-redis retries forever with exponential backoff by default, so a failed `connect()` doesn't reject at all - it just hangs, waiting to eventually succeed - which would have hung the *entire server* at startup whenever Redis was slow to come up, not just degraded the adapter. Fixed by setting `reconnectStrategy: false` on these two clients specifically, so a failed first attempt rejects immediately instead of retrying silently forever.

**A related, separate finding (not changed here):** the JWT-blocklist Redis client has the same default `reconnectStrategy` behavior and no fallback - it's a deliberate hard dependency (logout-token revocation has to work), but that means if Redis is fully unreachable, the *whole server* currently hangs indefinitely at startup rather than failing fast with a clear error. That's pre-existing behavior from the auth work, out of scope for this change, but worth knowing.

**How to answer "how would you scale Socket.IO across multiple servers" from this:** run N instances of this app behind a load balancer configured for **sticky sessions** (Socket.IO's HTTP long-polling transport needs successive requests from the same client to hit the same instance unless you're WebSocket-only; a client's initial handshake can land anywhere, but follow-up polling requests must reach the same one) - then attach the Redis adapter exactly as done here so room broadcasts cross instance boundaries via Redis pub/sub instead of staying trapped in one process's memory. The REST side already composes the same way: it's stateless per-request (the JWT carries identity, Postgres carries the data), so it scales horizontally for free; the only stateful pieces that needed deliberate handling were this adapter and the existing JWT blocklist, both already Redis-backed.
