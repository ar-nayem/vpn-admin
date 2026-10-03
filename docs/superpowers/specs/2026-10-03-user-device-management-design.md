# User and Device Management Design

## Objective

Add administrator-controlled user and device provisioning without restarting,
reloading, or interrupting the running AmneziaWG interface or any unrelated
client connection.

The installation currently contains 21 peer accounts. Those peers remain
unchanged. The first newly created account is User 22, followed by User 23 and
so on.

## Safety constraints

- Development and automated tests must never execute commands against the real
  `awg0` interface.
- Deployment is outside this change. No code from this repository is copied to
  or executed on the VPN server during implementation.
- Existing peer public keys, IP addresses, names, limits, configurations, and
  enabled state are preserved exactly.
- Adding or removing a peer uses targeted live `awg set awg0 peer ...`
  operations. The application must never call `awg-quick down`, `awg-quick up`,
  restart a service, or replace the live interface.
- A failed create operation must remove only the partially created new peer and
  leave existing peers unchanged.
- Destructive administrator actions require explicit confirmation in the UI.

## Device identity model

AmneziaWG identifies a client by its cryptographic peer key, not by physical
hardware. A shared configuration cannot reliably reveal whether one or several
physical devices are using it. Therefore every tracked device receives its own
key pair, peer record, IP address, and downloadable configuration.

The administrator supplies a human-readable device name such as `iPhone`,
`Laptop`, or `Android tablet`. The dashboard reports the server-observable
facts for that device: enabled state, current endpoint IP and port, recent
handshake status, last-seen time, live traffic, accumulated usage, quota,
expiry, and speed limits. It does not claim to detect operating system,
hardware model, or a stable physical-device identifier automatically.

## Data model and compatibility

The existing `data/peers.json` file remains the source of VPN peer state so the
current server behavior remains compatible. New optional fields extend each
peer record:

- `userNumber`: positive integer account number.
- `userName`: administrator-entered user name.
- `deviceId`: generated stable identifier.
- `deviceName`: administrator-entered device label.
- `createdAt`: ISO timestamp.
- `archivedAt`: ISO timestamp when revoked, otherwise absent.

On read, an existing peer without these fields receives a non-destructive
legacy view: its position in the existing peer array becomes its user number,
its current peer name becomes its user name, and its device label is
`Existing device`. This compatibility projection does not rewrite the file or
change the live interface merely because the application starts.

The next account number is `max(userNumber, legacy position) + 1`. With the
current 21 peers, the first newly created account is User 22. Numbers are never
reused after archival.

Private keys remain in the gitignored `data/private-keys.json` file with mode
`0600`. Public peer metadata never contains private keys.

## Administrator workflows

### Add a user

The administrator opens an Add User dialog, enters a user name, and supplies
one or more device names. The server validates the request, reserves the next
user number, allocates a free client IP from the configured VPN subnet, and
generates one AmneziaWG key pair per device.

For each device, the server performs a targeted live peer addition. After all
additions succeed, it atomically saves peer metadata and private keys, then
updates the persistent configuration. The response provides a download action
for every device configuration.

If any step fails, the server rolls back only peers added by that request,
restores the pre-operation data files, and reports the failure. No existing
peer is toggled, rewritten, or removed as part of rollback.

### Add a device to an existing user

The administrator can add another named device to a user. It receives a new
key, peer, IP address, and configuration. Existing devices are unaffected.

### Revoke or archive

The administrator may revoke one device or archive an entire user after a
confirmation dialog. Revocation removes only the selected public keys from the
live interface and persistent active configuration. The corresponding metadata
is retained with `archivedAt`, so names, device labels, dates, and historical
usage remain visible in an Archived section. Private keys for archived devices
are not offered for download.

An archived record can be restored only by issuing a newly generated key and
configuration; an old compromised or intentionally revoked key is never
silently re-enabled.

## Server boundaries

Command execution is moved behind an injectable AmneziaWG adapter. Production
uses the current command-line tools; tests use a fake adapter that records
commands without touching the operating system.

Provisioning logic is separated from HTTP routing and owns validation, account
number allocation, IP allocation, key generation, targeted live changes,
atomic persistence, and rollback. HTTP routes authenticate the administrator,
parse requests, call this service, and return structured errors.

The initial implementation adds these authenticated operations:

- `POST /api/users` creates a numbered user and initial devices.
- `POST /api/users/:userNumber/devices` adds a device.
- `DELETE /api/users/:userNumber` archives a user and revokes active devices.
- `DELETE /api/devices/:deviceId` archives and revokes one device.
- `GET /api/users` returns active and archived users grouped with their devices.

Existing peer endpoints remain available during the compatibility period.

## Interface

The main view groups device rows under numbered user headings. Existing peers
appear as Users 1 through 21. Each heading shows the user name, active-device
count, and Add Device action. Each device row retains current status, traffic,
quota, expiry, speed-limit, toggle, and configuration controls.

An Add User dialog accepts a name and a repeatable list of device names. A
successful result immediately displays User 22 or the next available number
and offers configuration downloads. Archive actions state exactly which user
and how many devices will be revoked before confirmation.

## Error handling and observability

- Validation failures return `400` without executing a system command.
- Exhausted IP space returns `409` without changing state.
- Duplicate device names within one user return `409`.
- System-command and persistence failures return `500` with a safe message and
  a server-side error log identifying the failed stage.
- Rollback failures are logged prominently and returned as an operation that
  requires administrator attention; they are never reported as success.
- Successful responses include the assigned user number and device IDs.

## Testing

Tests use Node's built-in test runner and temporary directories. They cover:

- Legacy peers map to Users 1 through 21 without rewriting source data.
- The next account becomes User 22 and later numbers increase monotonically.
- Each device receives a distinct key and unused IP address.
- Multiple devices group under the correct user.
- Create and archive operations target only their own peer keys.
- A partial create failure rolls back only newly added peers.
- Existing peer records remain byte-for-byte equivalent in protected fields.
- No tested path contains interface restart or `awg-quick` commands.
- HTTP authentication and validation protect every new route.
- The browser renders grouped users and submits create/archive operations.

## Deployment boundary

Completion of this feature means the local repository is implemented and
verified with fake adapters. Activating it on the live VPS is a separate,
explicitly authorized deployment task with backup, dry-run inspection, and a
rollback procedure. No live deployment is implied by approving this design.
