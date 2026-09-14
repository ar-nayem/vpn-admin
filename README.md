# VPN Admin

A small web panel for managing AmneziaWG (obfuscated WireGuard) client
peers on a single VPS, built to run on the same box as the VPN server
itself rather than talk to it remotely.

## What it does

- Add / remove / enable / disable client peers
- Live traffic (up/down) per peer via `tc`
- Generates each client's `.conf` file, including the AmneziaWG
  obfuscation parameters (Jc/Jmin/Jmax/S1/S2/H1–4)
- Single-admin login (bcrypt password hash), session-cookie auth

## Stack

Node.js · Express · express-session · bcryptjs — no framework, no database
(peer state is read from/written to `awg0.conf` directly, plus a small
JSON file for traffic stats)

## Getting started

Runs on the VPN server itself (needs `awg`/`awg-quick` and `tc` on PATH,
and read/write access to `/etc/amnezia/amneziawg/awg0.conf`):

```bash
npm install
export SESSION_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD_HASH=...   # bcrypt hash; bootstraps data/admin.json on first run
npm start
```

`SESSION_SECRET` is required — the app refuses to start without it.
`data/` (peer list, admin credentials) is gitignored and never committed.
