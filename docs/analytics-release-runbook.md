# Future analytics release runbook

Status: preparation only. These production commands have not been executed.
Complete final whole-branch review and branch integration before any production
connection, backup, push, or deployment. Record the integrated commit and review
decision with the eventual release evidence. Never test by creating, removing,
toggling, or reprovisioning a live peer. Never stop/restart/reload AmneziaWG.

## 1. Resolve the installation and prepare the release

After the release gate, inspect `pm2 describe vpn-admin` and
`pm2 describe vpn-storefront` on the target. Resolve their actual release paths,
runtime version, protected environment file, database, storage, and `data`
directory. The examples below assume `/opt/vpn-admin`; replace every path with
the inspected installation. Keep evidence and secrets outside the public tree,
mode 0700 directories / 0600 files. Do not paste keys, cookies, environment
values, customer records, or raw VPN output into a report.

Use a Bash session with the existing protected environment loaded. Establish
these variables with concrete, validated absolute paths (placeholders are
deliberately not executable installation defaults):

```bash
set -euo pipefail
umask 077
release_commit='<reviewed integrated commit>'
previous_release='<absolute current release directory>'
release_dir="/opt/vpn-admin/releases/$release_commit"
live_db='<absolute STOREFRONT_DATABASE_PATH>'
live_storage='<absolute STOREFRONT_STORAGE_PATH>'
live_data='<resolved current release data directory>'
protected_env='<absolute protected shell environment file>'
backup_dir="/var/backups/vpn-admin/$(date -u +%Y%m%dT%H%M%SZ)"
```

From the integrated local checkout, prepare a tracked-files archive and checksum;
transfer it only after the production gate, using the already approved SSH target:

```bash
git archive --format=tar.gz --output=/tmp/vpn-admin-release.tar.gz "$release_commit"
shasum -a 256 /tmp/vpn-admin-release.tar.gz
scp /tmp/vpn-admin-release.tar.gz '<approved-SSH-target>:/tmp/vpn-admin-release.tar.gz'
```

On the server, compare `sha256sum /tmp/vpn-admin-release.tar.gz` with the local
value, ensure the destination is a new directory, and unpack there:

```bash
test ! -e "$release_dir"
install -d -m 700 "$release_dir"
tar -xzf /tmp/vpn-admin-release.tar.gz -C "$release_dir"
cd "$release_dir"
npm ci --omit=dev --ignore-scripts
```

`better-sqlite3` is native: first run this smoke check:

```bash
node -e "new (require('better-sqlite3'))(':memory:').close()"
```

If its binary is absent, inspect the pinned package's install script, then explicitly run
`npm rebuild better-sqlite3 --foreground-scripts` and repeat the smoke check.
Do not enable all dependency lifecycle scripts as a workaround. Confirm Node
and native ABI match the production web runtime.

## 2. Back up and capture before-state

The existing `scripts/backup-storefront.sh` alone is insufficient: it assumes
default paths and omits the release and Nginx configuration. Use the resolved
paths below. Arrange a short pause in customer/admin writes for a coherent
backup; Node web downtime is allowed, VPN downtime is not. Preserve any live
changes made after the backup; never restore old state as routine rollback.

```bash
install -d -m 700 "$backup_dir"
tar -czf "$backup_dir/application.tar.gz" -C "$previous_release" .
sqlite3 "$live_db" ".backup '$backup_dir/storefront.db'"
test "$(sqlite3 "$backup_dir/storefront.db" 'PRAGMA integrity_check;')" = ok
cp -a "$live_storage" "$backup_dir/private-storage"
cp -a "$live_data" "$backup_dir/data"
tar -czf "$backup_dir/nginx.tar.gz" -C /etc nginx
install -m 600 "$protected_env" "$backup_dir/environment"
install -m 600 /etc/amnezia/amneziawg/awg0.conf "$backup_dir/awg0.conf"
sha256sum /etc/amnezia/amneziawg/awg0.conf > "$backup_dir/awg0.before.sha256"
awg show awg0 > "$backup_dir/awg.before.txt"
awg show awg0 latest-handshakes > "$backup_dir/handshakes.before.txt"
awg show awg0 transfer > "$backup_dir/transfer.before.txt"
ip link show dev awg0 > "$backup_dir/interface.before.txt"
pm2 status > "$backup_dir/pm2.before.txt"
```

Verify the backup includes `peers.json`, `private-keys.json`, and `admin.json`
from the actual peer store. Preserve the PM2 definitions and known-good previous
ecosystem file privately. SQLite online backup includes committed WAL data;
copying a live `.db` alone does not. Application/state copies do not establish a
cross-store transaction: record any concurrent changes and refresh the backup
under paused web writes if needed.

## 3. Migrate a copy and run private checks

```bash
cp "$backup_dir/storefront.db" "$backup_dir/migration-test.db"
ANALYTICS_MIGRATION_DB="$backup_dir/migration-test.db" node <<'NODE'
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrate } = require('./storefront/db/schema');
const db = new Database(process.env.ANALYTICS_MIGRATION_DB);
try {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  assert.equal(db.pragma('user_version', { simple: true }), 2);
  const before = db.prepare('SELECT * FROM vpn_profiles ORDER BY id').all();
  migrate(db);
  assert.deepEqual(db.prepare('SELECT * FROM vpn_profiles ORDER BY id').all(),
    before.map(row => ({ ...row, analytics_enabled: 0, delivery_filename: null })));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_samples_minute').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_samples_hour').get().n, 0);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  console.log('Migration verified; existing profiles unchanged and excluded:', before.length);
} finally { db.close(); }
NODE
npm test
node --test test/storefront-database.test.js test/storefront-usage-collector.test.js test/storefront-usage-analytics.test.js test/storefront-usage-rollup-worker.test.js test/api.test.js test/storefront-api.test.js test/safety.test.js
```

The migration deliberately stops if the initial version is not 2; investigate
instead of forcing a version number. The API tests start app factories on
alternate ephemeral loopback ports with temporary/in-memory databases and fake
VPN/email dependencies. They check private routes and authentication without
starting live entrypoints. Never run a preview `server.js`: startup initializes
traffic control and quota/expiry enforcement. Never run a preview
`storefront/server.js` against copied production data: startup processes queued
email and its provisioning client defaults to the live admin port 7500.

## 4. Switch only the web processes

Freeze admin provisioning/order mutations during the switch. Stop the storefront
web process briefly to prevent profile creation across the migration boundary:

```bash
pm2 stop vpn-storefront
```

Refresh the online database backup, rerun the exact migration block from step 3
with `ANALYTICS_MIGRATION_DB="$live_db"`, and record its successful exclusion
assertion **before starting the new storefront**. This is an authorized release
migration only after the gate; it is not part of local preparation. If migration
or assertions fail, leave the release unswitched and assess the database state.

The new release must use the current shared data, not a stale backup. Validate
the paths and create a symlink (only when the release has no `data` entry):

```bash
test -d "$live_data"
test ! -e "$release_dir/data"
test ! -L "$release_dir/data"
ln -s "$live_data" "$release_dir/data"
cp "$release_dir/ecosystem.config.example.js" "$release_dir/ecosystem.config.js"
set -a
. "$protected_env"
set +a
test "$STOREFRONT_DATABASE_PATH" = "$live_db"
test "$STOREFRONT_STORAGE_PATH" = "$live_storage"
pm2 startOrRestart "$release_dir/ecosystem.config.js" --only vpn-storefront --update-env
curl --fail --silent --show-error http://127.0.0.1:7600/ -o /dev/null
```

Confirm public `/`, existing customer sign-in, guest tracking, QR images, and
email queue processing in the existing workflow. Check for failed/duplicated
mail without sending a test message or replaying an outbox job. Then switch the
admin alone:

```bash
pm2 startOrRestart "$release_dir/ecosystem.config.js" --only vpn-admin --update-env
curl --fail --silent --show-error http://127.0.0.1:7500/ -o /dev/null
curl --fail --silent --show-error https://vpn.arnayem.top/admin/ -o /dev/null
pm2 describe vpn-storefront
pm2 describe vpn-admin
```

Verify PM2 script/cwd point at the new release, shared data is still current,
both processes are healthy, and authenticated admin screens show existing
users/devices, orders, QR settings, archive and password controls. Read-only
checks must confirm customer/admin analytics authorization and guest exclusion.
Do not create an order/profile or click a destructive control just to test it.
Keep the prior release while any data symlink depends on its directory.

No Nginx change is needed for these routes. If an independently reviewed Nginx
change is required, run `nginx -t` successfully before `nginx -s reload`; never
restart it merely for a code release. Never use PM2 commands targeting `all`.

## 5. Capture after-state and acceptance evidence

```bash
sha256sum /etc/amnezia/amneziawg/awg0.conf > "$backup_dir/awg0.after.sha256"
diff -u "$backup_dir/awg0.before.sha256" "$backup_dir/awg0.after.sha256"
awg show awg0 > "$backup_dir/awg.after.txt"
awg show awg0 latest-handshakes > "$backup_dir/handshakes.after.txt"
awg show awg0 transfer > "$backup_dir/transfer.after.txt"
ip link show dev awg0 > "$backup_dir/interface.after.txt"
pm2 status > "$backup_dir/pm2.after.txt"
```

Compare peer sets, interface state, existing identity/private keys/IPs/quotas/
expiry/enabled state, and configuration filename behavior with the protected
before-state. Existing usage counters may legitimately advance. Confirm active
clients' handshakes and transfer counters continue to advance during observation;
idle clients need not show new traffic or handshakes. An unchanged checksum alone
does not prove uninterrupted traffic. If legitimate quota/expiry enforcement
changes a peer or checksum during the window, record and investigate it; do not
claim unchanged state or restore a stale configuration to make the check pass.

- [ ] Before/after `awg0.conf` checksums match, interface stays up, active-client
  handshake/transfer evidence supports continuity, and existing peer identity,
  keys, IP, quota, expiry, enabled state and filename behavior remain unchanged.
- [ ] Every pre-migration profile remains disabled for analytics, has no history,
  and is absent from analytics selectors (retain the step 3 ID set privately).
- [ ] Full server test suite and isolated migration/collector/API checks pass.
- [ ] `/`, `/admin/`, existing sign-in, allowance tracking, email queue, QR,
  user/device, order, archive, and password interfaces remain healthy; phone,
  tablet and desktop layouts are usable.
- [ ] Owner-only customer analytics, existing admin authentication, six ranges,
  empty state, 503/retry display, and guest allowance-only behavior are verified.
- [ ] For the first **naturally created future profile**, verify eligibility and
  stored filename, matching email/download filenames, a sample after the next
  UTC minute, and the customer/admin graph. No live peer is created for testing.

The last item remains pending until a real future profile exists; do not invent
production proof from isolated tests. Record only sanitized results in the
release report and retain raw evidence privately.

## 6. Application rollback

Switch the storefront back first, check it, then switch the admin back. Ensure
the previous release still resolves the same current data directory and uses
the protected shared database/storage environment:

```bash
pm2 startOrRestart "$previous_release/ecosystem.config.js" --only vpn-storefront --update-env
curl --fail --silent --show-error http://127.0.0.1:7600/ -o /dev/null
pm2 startOrRestart "$previous_release/ecosystem.config.js" --only vpn-admin --update-env
curl --fail --silent --show-error http://127.0.0.1:7500/ -o /dev/null
```

Repeat the VPN and web evidence checks. Returning to the previous admin stops
analytics collection; additive columns/tables may remain unused. Preserve all
current customer/order/peer data and keys. Do not restore `awg0.conf`, peer/key
files, database, or uploads for ordinary rollback. Corruption recovery requires
a separate plan accounting for post-backup writes and WAL state, with web writers
stopped; the live VPN interface still must not be stopped or reloaded.
