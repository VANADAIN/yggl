# microservices

Dev A owns a **user service**. Dev B owns an **order service**. The order service calls the user service to enrich responses — but they're on different machines. Each dev shares their service with yggl and connects to the other's.

```
Dev A machine                          Dev B machine
─────────────────────────────          ──────────────────────────────
user-service  :3000                    order-service  :3001
      │                                       │
 yggl share 3000                         yggl share 3001
      │                                       │
      └────── Yggdrasil mesh ────────────────┘
      │                                       │
 yggl connect [devB]:3001              yggl connect [devA]:3000
 localhost:3001 (order svc)            localhost:3000 (user svc)
```

`GET /orders` on the order service calls `localhost:3000/users/:id` — which yggl forwards to Dev A's user service.

## Prerequisites

- Node.js 22+
- yggl installed: `npm install -g yggl`

---

## Dev A — user service

```sh
# 1. Initialize yggl
yggl init

# 2. Start the user service
cd user-service
node server.js
# → User service running on http://localhost:3000

# 3. Start Yggdrasil and share port 3000
yggl start
yggl share 3000
# → URL: http://[200:xxxx::1]:3000
#
# Send your address to Dev B: 200:xxxx::1
```

Once Dev B shares their order service, connect to it:

```sh
yggl connect [devB-address]:3001 --local-port 3001
# → Port forwarding active
#   Local: localhost:3001 → [devB-address]:3001
```

---

## Dev B — order service

```sh
# 1. Initialize yggl
yggl init

# 2. Connect to Dev A's user service first
yggl start
yggl connect [devA-address]:3000 --local-port 3000
# → Port forwarding active
#   Local: localhost:3000 → [devA-address]:3000

# 3. Start the order service (it calls localhost:3000 for user data)
cd order-service
node server.js
# → Order service running on http://localhost:3001
#   User service: http://localhost:3000

# 4. Share the order service
yggl share 3001
# → URL: http://[200:yyyy::1]:3001
#
# Send your address to Dev A: 200:yyyy::1
```

---

## Verify it works

From either machine, once both are connected:

```sh
# Check users (Dev A's service, via forwarded localhost:3000)
curl http://localhost:3000/users

# Check orders with enriched user data (Dev B's service, via forwarded localhost:3001)
curl http://localhost:3001/orders

# Single order — calls user service internally
curl http://localhost:3001/orders/1
```

Expected response for `GET /orders/1`:

```json
{
  "id": 1,
  "userId": 1,
  "item": "Widget",
  "quantity": 2,
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.com"
  }
}
```

The `user` field is fetched live from Dev A's user service through the Yggdrasil tunnel — no configuration beyond `yggl connect`.

---

## Using auth

To restrict access to your service to only your teammate's Yggdrasil public key:

```sh
# Get your teammate's public key
yggl status   # shows your own key; ask your teammate to run this

# Share with allowlist
yggl share 3000 --allow <teammate-public-key>
```

Or use a bearer token for HTTP-level auth:

```sh
yggl share 3000 --auth
# → Token: <random-token>   ← give this to your teammate

# Teammate connects normally, but must pass the token:
curl -H "Authorization: Bearer <token>" http://localhost:3000/users
```
