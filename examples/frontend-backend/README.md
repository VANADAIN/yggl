# frontend-backend

Dev A has a backend API. Dev B has a frontend. Dev A shares the backend over Yggdrasil — Dev B connects and points their Vite dev server at it, no tunnels, no port forwarding config, no shared VPN.

```
Dev A machine                          Dev B machine
─────────────────────────────          ──────────────────────────────
Express backend  :3001                 Vite dev server  :5173
       │                                      │
  yggl share 3001                       yggl connect
       │                                [devA-addr]:3001 --local-port 3001
       └──── Yggdrasil mesh ────────────────┘
                                      localhost:3001 (forwarded)
```

## Prerequisites

- Node.js 22+
- yggl installed: `npm install -g yggl`

---

## Dev A — sharing the backend

```sh
# 1. Initialize yggl (generates your Yggdrasil keys)
yggl init

# 2. Install and start the backend
cd backend
npm install
npm start
# → Backend running on http://localhost:3001

# 3. In a second terminal, share port 3001
yggl start   # start the Yggdrasil daemon
yggl share 3001
# → Sharing port 3001 over Yggdrasil
#   URL: http://[200:xxxx:xxxx::1]:3001
#
# Send that URL (or just the address) to Dev B
```

To add token auth so only your teammate can reach it:

```sh
yggl share 3001 --auth
# → Token: <random-token>   ← send this to Dev B too
```

---

## Dev B — connecting to the backend

```sh
# 1. Initialize yggl
yggl init

# 2. Start daemon and connect to Dev A's backend
yggl start
yggl connect [200:xxxx:xxxx::1]:3001 --local-port 3001
# → Port forwarding active
#   Local: localhost:3001 → [200:xxxx:xxxx::1]:3001

# 3. In another terminal, start the frontend
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Open http://localhost:5173 and click the buttons. Requests to `/api/*` are proxied by Vite to `localhost:3001`, which yggl forwards to Dev A's backend.

If Dev A used `--auth`:

```sh
# Set the token as an environment variable before starting Vite
VITE_API_TOKEN=<token> npm run dev
```

Then in `main.js`, add `Authorization: Bearer ${import.meta.env.VITE_API_TOKEN}` to fetch headers.

---

## How it works

`vite.config.js` proxies `/api` to `localhost:3001`:

```js
proxy: {
  '/api': 'http://localhost:3001',
}
```

`yggl connect` forwards `localhost:3001` to Dev A's Yggdrasil address. Dev B's frontend has no idea it's talking to a remote machine — it's just `localhost:3001` from its perspective.

Yggdrasil encrypts all traffic end-to-end. No port forwarding rules, no firewall exceptions, no VPN setup.
