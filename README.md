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

## Customer storefront

The same project now includes a public storefront at `vpn.arnayem.top` and keeps
the existing private panel at `vpn.arnayem.top/admin/`. Customers can start one
verified 1 GB trial per email, create one or more named VPN profiles when signed
in, purchase Basic, Premium, or Pro service, upload WeChat Pay or Alipay proof,
and check remaining data by a six-digit email code. Approval upgrades an existing
device in place whenever possible, so the customer keeps the same `.conf` file.

The administrator can review payment proofs, approve/reject orders, retry a
failed provisioning attempt, and replace the two payment QR images. Approved
and trial emails include both a secure download link and the `.conf` attachment.

## Stack

Node.js · Express · SQLite · express-session · bcryptjs. VPN peer state remains
in the existing files and `awg0.conf`; customer, order, verification, and email
queue records are stored in a separate WAL-mode SQLite database.

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

### Storefront environment

Generate every secret independently. Keep these values only in the server's
protected environment file (mode `0600`), never in Git or chat:

```bash
NODE_ENV=production
STOREFRONT_SESSION_SECRET=<random secret>
OTP_PEPPER=<random secret>
OUTBOX_KEY=<base64 32-byte key>
DOWNLOAD_KEY=<base64 32-byte key>
INTERNAL_SHARED_SECRET=<random secret shared by both processes>
GMAIL_APP_PASSWORD=<Google app password for nayem3622@gmail.com>
STOREFRONT_DATABASE_PATH=/opt/vpn-admin/private/storefront.db
STOREFRONT_STORAGE_PATH=/opt/vpn-admin/private/storefront
```

Google requires 2-Step Verification before creating an app password. The
storefront binds to loopback only; Nginx is the only public entry point. Upload
the real WeChat Pay and Alipay QR images from the private admin panel after the
first deployment.

### Safe deployment

1. Run `npm ci` and `npm test` on the release checkout.
2. Run `scripts/backup-storefront.sh` before replacing application files.
3. Copy `ecosystem.config.example.js` to `ecosystem.config.js`, load the protected
   environment, and start/reload only `vpn-admin` and `vpn-storefront` in PM2.
4. Install `deploy/nginx-vpn.conf`, add the existing TLS configuration, run
   `nginx -t`, then reload Nginx.
5. Verify `/`, `/admin/`, email delivery, both QR images, and a test order.

This deployment must not restart, stop, reload, or run `awg-quick` against the
live VPN interface. Application process reloads are independent of the tunnel.
The Nginx example explicitly blocks the private `/internal` API from the public
internet.

To roll back, restore the previous release directory and the timestamped SQLite,
`data`, private storage, and `awg0.conf` backup. Reload only the two Node processes
and Nginx; do not reload the VPN interface.

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

Completing or testing this repository does not by itself deploy it to a live VPN
server. A live release also requires server access, the protected environment,
the Gmail app password, and the two owner-provided payment QR images.
