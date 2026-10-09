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

Follow the [analytics release runbook](docs/analytics-release-runbook.md) for
backups, isolated migration checks, web process switching, rollback, and the
before/after VPN evidence. Production work is deferred until the final
whole-branch review and branch integration are complete. Local verification is
not evidence of deployment or production health.

This deployment must not restart, stop, reload, or run `awg-quick` against the
live VPN interface. Application process reloads are independent of the tunnel.
The Nginx example explicitly blocks the private `/internal` API from the public
internet.

Ordinary rollback switches only the Node processes to the previous release,
retaining current data, keys, uploads, and the additive analytics schema. Do not
restore `awg0.conf` or an older database as part of routine rollback. Database
restoration is reserved for a separately assessed corruption recovery.

## Future-customer usage history

Migration version 3 defaults every existing storefront profile to
`analytics_enabled = 0` and `delivery_filename = NULL`. Existing profiles and
legacy VPN peers stay excluded; there is no backfill or opt-in migration.
Only newly created storefront trial/paid profiles receive analytics eligibility,
including guest-created profiles. Reusing or upgrading an existing profile does
not opt it in. A profile needs a matching device snapshot before collection and
must be activated before appearing in the history selectors.

The admin process passes its completed two-second snapshot to a read-only
collector. A unique profile/UTC-minute key permits at most one stored sample per
minute. Speeds are sampled Kbps; byte deltas come from cumulative counters, with
the previous stored raw RX/TX counters as the baseline. Counter resets contribute
zero for that interval and subsequent increments use the reset baseline. Missing
device mappings produce no fabricated samples. The collector does not create,
remove, toggle, or reconfigure VPN peers.

Raw samples are retained for 30 days with the cutoff rounded down to a UTC hour.
This retains the boundary hour (up to 59 extra minutes, plus scheduling delay)
so repeated rollups cannot overwrite an hour with a partial total. An hourly
worker thread uses its own SQLite connection to aggregate completed UTC hours
and prune only rows whose hourly aggregate exists, in one transaction. Hourly
history remains for the profile's lifetime. At continuous collection this is
about 43,200 raw rows per profile, plus the boundary/scheduling allowance, and
8,760 hourly rows per non-leap year; lifetime storage grows with elapsed hours.

| Range | Display granularity |
| --- | --- |
| 1 hour | One minute |
| 1 day | Ten minutes |
| 7 days | One hour |
| 10 days | One hour |
| 30 days | Six hours |
| Lifetime | Hourly history, adaptively grouped for the chart |

The API returns UTC timestamps, upload/download Kbps, transferred bytes, peak
speeds, and sampled connected minutes. Connected duration is an estimate from
the samples, not a session log. Empty history has no points and zero totals.
Graphs show recorded observations only; outages are not backfilled.

Signed-in customers can access only their own activated, eligible profiles at
`GET /api/analytics/:profileId?range=1d`. Administrators use their existing login
at `GET /api/storefront/analytics/:profileId?range=1d` and also see customer/device
labels. Responses omit peer keys, IPs, and endpoints. Guest tracking remains
allowance-only even when the guest's newly created profile is eligible; history
requires customer sign-in. Missing/unauthorized profiles return 404, missing
sessions 401, invalid ranges 400, and storage failures a safe 503.

New profiles store a safe configuration filename once, using the customer name
(or email local part) and device code name, such as `Nayem-Ahmed-iPhone.conf`.
Later name edits do not rename it. The emailed attachment and secure download
use the same stored filename. Existing profiles with no stored filename retain
the previous configuration filename fallback.

### Troubleshooting history

- No samples: verify the admin process is running and both web processes use the
  same absolute `STOREFRONT_DATABASE_PATH`. Check eligibility, device mapping,
  activation, UTC time, and database directory permissions/free space. Allow the
  next minute after normal provisioning. Never enable a legacy profile to test.
- `Usage analytics collection failed`: inspect storage availability and SQLite
  contention. The completed snapshot still returns; later two-second cycles
  retry collection and duplicate minutes are ignored. Errors are logged without
  customer details. A prolonged failure leaves a history gap.
- `Usage analytics rollup failed`: raw data remains when the transaction fails.
  The scheduler keeps at most one worker active and retries on a later minute
  tick after worker exit. Successful hours are not dispatched again until the
  next UTC hour. Check the database path, worker file, disk, and locks; do not
  manually delete raw rows to clear an error.
- Chart/API failure: check session and ownership first, then the supported range,
  browser request status, and the relevant web process logs. Retry the graph;
  current allowance/status remains independent. Do not expose protected database
  rows or customer details in public diagnostics.

History troubleshooting never requires restarting or reloading AmneziaWG. If an
application rollback is needed, follow the runbook and switch only Node processes.

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
