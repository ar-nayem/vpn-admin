# VPN Admin

A small web panel for managing AmneziaWG (obfuscated WireGuard) client
peers on a single VPS, built to run on the same box as the VPN server
itself rather than talk to it remotely.

## What it does

- Add / remove / enable / disable client peers
- Numbered users with one separately keyed VPN profile per device
- Add devices to an existing user and archive a device or complete user
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

Optional deployment settings:

```bash
export VPN_SERVER_HOST=45.76.15.203
export VPN_CLIENT_PREFIX=10.66.67
export AWG_CONF_PATH=/etc/amnezia/amneziawg/awg0.conf
```

## Users and devices

AmneziaWG identifies a device by its peer key. To distinguish a user's phone,
laptop, tablet, or other devices, give every device its own configuration in
the Add user dialog. Sharing one configuration across several physical devices
cannot provide reliable device-level identity.

Existing peer records are projected as numbered users without rewriting them.
For the current installation, the 21 existing peers appear as Users 1–21 and
the next account is User 22. Account numbers are not reused after archival.

Archiving a device revokes only that device key. Archiving a user revokes all
active device keys belonging to that user. Metadata remains in the Archived
state for administrative history; archived private keys are removed and their
configurations can no longer be downloaded.

Provisioning uses targeted `awg set awg0 peer ...` changes. It does not restart
the interface and contains no `awg-quick down`, `awg-quick up`, service restart,
or interface reload operation. Failed multi-device creation rolls back only the
new peers created by that request.

## Testing and deployment safety

```bash
npm test
```

Tests use fake VPN adapters and temporary data files. They do not read or write
the system AmneziaWG configuration and do not execute `awg` or `tc`.

Completing or testing this repository does not deploy it to a live VPN server.
Before a separate live deployment, back up `data/` and `awg0.conf`, inspect the
configured host, client prefix, and interface path, and prepare a rollback copy.
