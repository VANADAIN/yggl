<div align="center">
  <img src="logo.svg" width="180" alt="yggl logo">
  <h1>yggl</h1>
</div>

**Pronounced: "eagle"** — yggl = yggdrasil + collaboration

Share local ports with teammates over an encrypted peer-to-peer mesh. No cloud relay, no port forwarding, no VPN to configure. Works behind NAT on any network.

Built on [Yggdrasil](https://yggdrasil-network.github.io/) — every node gets a stable IPv6 address derived from its public key. Connections are end-to-end encrypted by the network itself.

---

## Quick start

```sh
# 1. Install
npm install -g yggl

# 2. Initialize (creates yggl.config.json)
yggl init

# 3. Share a local port
yggl share 3000
# → URL: http://[200:xxxx::1]:3000
# → Send this address to your teammate

# 4. Teammate connects to it
yggl connect [200:xxxx::1]:3000
# → localhost:3000 now forwards to your machine
```

That's it. No accounts, no servers, no firewall rules.

---

## Install

```sh
npm install -g yggl
# or
pnpm add -g yggl
```

yggl bundles a [yggstack](https://github.com/yggdrasil-network/yggstack) binary for your platform — no separate install needed.

**Supported platforms:** Linux x64/arm64, macOS x64/arm64, Windows x64

---

## Usage

### `yggl init`

Generate `yggl.config.json` for the current project.

```sh
yggl init
```

Identity and runtime state are created automatically outside the project tree on first use.

---

### `yggl start`

Start the Yggdrasil daemon and print your node address.

```sh
yggl start
# Your address: 200:xxxx::1
# Public key:   abcd1234...
```

Most commands start the daemon automatically — you only need this if you want to see your address before sharing anything.

---

### `yggl share <port>`

Share a local port over Yggdrasil.

```sh
yggl share 3000
# URL: http://[200:xxxx::1]:3000
```

Teammates can reach `localhost:3000` on your machine at that URL, or via `yggl connect`.

**Flags:**

| Flag | Description |
|------|-------------|
| `--auth` | Enable bearer token auth (HTTP only). Prints a token your teammate must include in requests. |
| `--token <token>` | Use a specific token instead of auto-generating one. |
| `--allow <key>[,<key>...]` | Restrict access to specific Yggdrasil public keys (network-layer, works for any protocol). |

**Auth modes** are composable — `--auth --allow` requires both a valid token and a permitted source key.

If you use `--auth` often, you can set a machine-local default token:

```sh
yggl local set auth-token my-shared-token
```

---

### `yggl connect <address:port>`

Forward a remote Yggdrasil address to a local port.

```sh
yggl connect [200:xxxx::1]:3000
# → localhost:3000 now forwards to [200:xxxx::1]:3000

yggl connect [200:xxxx::1]:3000 --local-port 9000
# → localhost:9000 forwards to [200:xxxx::1]:3000
```

`--local-port` defaults to the remote port. Pass it only when there's a conflict.

Keep this process running — it exits when you Ctrl+C.

---

### `yggl status`

Show your node address, connected peers, and active sessions.

```sh
yggl status
```

---

### `yggl peers`

Manage the peer list in `yggl.config.json`.

```sh
yggl peers list
yggl peers add tls://example.com:443
yggl peers remove tls://example.com:443
```

---

### `yggl stop`

Stop a daemon started by `yggl start`.

```sh
yggl stop
```

### `yggl local`

Manage machine-local values for the current project. These values are stored outside your repo.

```sh
yggl local set auth-token my-shared-token
yggl local get auth-token
yggl local get auth-token --show-secret
yggl local unset auth-token
yggl local list
```

Supported keys:

| Key | Description |
|-----|-------------|
| `auth-token` | Default bearer token for `yggl share --auth` in this project |
| `identity-mode` | `global` or `project` identity selection |

### `yggl doctor`

Show effective config paths, local storage paths, identity mode, and token source.

```sh
yggl doctor
```

---

## Config reference

`yggl.config.json` is created by `yggl init` in the current directory.

```json
{
  "daemon": "auto",
  "peers": [],
  "autoDiscover": true,
  "auth": {
    "enabled": false
  },
  "adminSocket": {
    "host": "localhost",
    "port": 9001
  }
}
```

### Fields

**`daemon`** — controls which binary runs the Yggdrasil node.

| Value | Behaviour |
|-------|-----------|
| `"auto"` (default) | system yggstack → bundled binary |
| `"bundled"` | always use the binary bundled with yggl |
| `"system"` | use `yggstack` from PATH, fail if absent |
| `"/path/to/binary"` | use this exact binary |

**`peers`** — list of Yggdrasil peer URIs to connect through. Defaults to a set of public peers if empty.

```json
"peers": [
  "tls://example.com:443",
  "tcp://example.com:9001"
]
```

Set to `[]` to use the built-in defaults.

**`autoDiscover`** — enable link-local multicast peer discovery (`true` by default). Useful for finding teammates on the same LAN without any peer URIs.

**`auth.enabled`** — enable bearer-token auth by default for `yggl share` in this project. The token itself is not stored in `yggl.config.json`; use `--token`, `YGGL_AUTH_TOKEN`, or `yggl local set auth-token`.

**`adminSocket`** — host and port of the Yggdrasil admin API (`localhost:9001` by default). Change this if port 9001 is taken.

### Environment overrides

All config fields can be overridden with environment variables:

| Variable | Field |
|----------|-------|
| `YGGL_DAEMON` | `daemon` |
| `YGGL_PEERS` | `peers` (comma-separated) |
| `YGGL_AUTH_TOKEN` | Bearer token used by `yggl share --auth` |
| `YGGL_ADMIN_HOST` | `adminSocket.host` |
| `YGGL_ADMIN_PORT` | `adminSocket.port` |

---

## Auth

Yggdrasil encrypts all traffic at the network layer — auth in yggl is purely access control on top of that.

### Bearer token (`--auth`)

```sh
# Dev A — share with token
yggl share 3000 --auth
# Token: xK9mP2...   ← send this to your teammate

# Dev B — connect normally, pass token in requests
curl -H "Authorization: Bearer xK9mP2..." http://localhost:3000/api/hello
```

A thin HTTP proxy sits in front of the shared port and checks the `Authorization` header. Returns `401` on missing or invalid token. WebSocket upgrades are supported.

Best for one-off HTTP shares — just send a URL and a token.

For repeat local use on one machine, set a project-local token once:

```sh
yggl local set auth-token my-shared-token
yggl share 3000 --auth
```

### Public key allowlist (`--allow`)

```sh
# Get your teammate's public key
yggl status   # shows your own; ask them to run this

# Dev A — share, restricted to teammate's key
yggl share 3000 --allow <teammate-public-key>
```

Access is enforced at the network layer via `AllowedPublicKeys` in yggstack config. Works for any protocol (HTTP, WebSocket, raw TCP). A Yggdrasil address is `SHA512(public key)` — it cannot be spoofed.

Best for stable teams — set once, no tokens to rotate.

### Combining both

```sh
yggl share 3000 --auth --allow <teammate-public-key>
# Requires: correct source key AND valid token
```

---

## System Yggdrasil integration

If you already run a full Yggdrasil node as a system service (via `yggdrasil`), yggl will detect and adopt it automatically on startup — no separate daemon is spawned.

yggl probes `adminSocket` (default `localhost:9001`) at startup. If something responds, it adopts that instance instead of launching its own.

**Note:** `yggl share` and `yggl connect` require yggstack (`-remote-tcp`/`-local-tcp` flags). If a system yggdrasil is adopted, port forwarding features won't be available — only `yggl status` and `yggl start` will work against it. Use `daemon: "bundled"` or `daemon: "system"` (with yggstack in PATH) to ensure the right binary is used.

---

## Troubleshooting

**`yggstack config not found — run yggl init`**
Run `yggl init` in the directory where you run yggl commands. Identity and runtime state are stored outside the project tree and will be created automatically on first use.

**`Binary not found` / `Bundled yggstack not found`**
The platform package wasn't installed. Re-install yggl with npm/pnpm — optional dependencies include the binary for your platform.

**`yggstack failed to set up local TCP forward within timeout`**
The remote address may be unreachable. Check that the other side has `yggl share` running and that you have at least one peer in common.

**Port conflict on `yggl connect`**
Something else is already listening on that port locally. Use `--local-port <other-port>` to bind to a different one.

**`This daemon was not started by yggl and will not be stopped`**
`yggl stop` only stops daemons it spawned. If you adopted a running system daemon, stop it through your system service manager.
