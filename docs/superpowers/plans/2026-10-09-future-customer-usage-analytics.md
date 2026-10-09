# Future Customer Usage Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private one-minute usage history and human-readable configuration filenames for future storefront customers, plus matching customer/admin charts and an admin visual refresh, while leaving all existing VPN peers and profiles unchanged.

**Architecture:** Add an opt-in profile flag and immutable delivery filename in SQLite. Feed a small collector from the admin server's existing read-only peer snapshot, retain minute data for 30 days, and roll completed hours into lifetime aggregates. Serve the same bounded analytics contract through separately authorized customer and administrator endpoints, then render it with accessible inline SVG in both interfaces.

**Tech Stack:** Node.js, Express, better-sqlite3, vanilla JavaScript, HTML/CSS, inline SVG, Node's built-in test runner, PM2, Nginx, AmneziaWG.

**Spec:** `docs/superpowers/specs/2026-10-09-future-customer-usage-analytics-design.md`

## Global Constraints

- Never call `awg set`, `awg-quick`, `systemctl restart/reload`, PM2 commands that target the VPN, or any peer mutation from analytics code.
- Migration defaults every existing profile to `analytics_enabled = 0`; do not backfill or infer eligibility.
- Only profile creation after deployment writes `analytics_enabled = 1` and `delivery_filename`.
- Preserve all existing admin operations, URLs, confirmation prompts, and API response fields.
- Treat the snapshot's server transmit counters as customer download and server receive counters as customer upload, matching the existing live-speed labels.
- Use UTC for storage and bucketing. Display the server-provided timezone label in the browser.
- Commit after each task and run its focused tests before continuing.

---

## Task 1: Add the compatibility-safe schema and delivery filename helper

**Files:**

- Modify: `storefront/db/schema.js`
- Create: `storefront/services/delivery-filename.js`
- Modify: `test/storefront-database.test.js`
- Create: `test/storefront-delivery-filename.test.js`

- [ ] **Step 1: Write failing migration tests**

Add tests that create a version-2 database with a pre-existing profile, run `migrate(db)`, and assert:

```js
assert.equal(db.pragma('user_version', { simple: true }), 3);
const legacy = db.prepare('SELECT analytics_enabled, delivery_filename FROM vpn_profiles WHERE id = ?').get('legacy-profile');
assert.deepEqual(legacy, { analytics_enabled: 0, delivery_filename: null });
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_samples_minute'").get());
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_samples_hour'").get());
```

Define the tables with these stable contracts:

```sql
ALTER TABLE vpn_profiles ADD COLUMN analytics_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (analytics_enabled IN (0, 1));
ALTER TABLE vpn_profiles ADD COLUMN delivery_filename TEXT;

CREATE TABLE usage_samples_minute (
  profile_id TEXT NOT NULL REFERENCES vpn_profiles(id) ON DELETE CASCADE,
  sampled_minute TEXT NOT NULL,
  upload_kbps REAL NOT NULL CHECK (upload_kbps >= 0),
  download_kbps REAL NOT NULL CHECK (download_kbps >= 0),
  uploaded_bytes INTEGER NOT NULL CHECK (uploaded_bytes >= 0),
  downloaded_bytes INTEGER NOT NULL CHECK (downloaded_bytes >= 0),
  connected INTEGER NOT NULL CHECK (connected IN (0, 1)),
  PRIMARY KEY (profile_id, sampled_minute)
);

CREATE TABLE usage_samples_hour (
  profile_id TEXT NOT NULL REFERENCES vpn_profiles(id) ON DELETE CASCADE,
  sampled_hour TEXT NOT NULL,
  avg_upload_kbps REAL NOT NULL,
  peak_upload_kbps REAL NOT NULL,
  avg_download_kbps REAL NOT NULL,
  peak_download_kbps REAL NOT NULL,
  uploaded_bytes INTEGER NOT NULL,
  downloaded_bytes INTEGER NOT NULL,
  connected_minutes INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (profile_id, sampled_hour)
);
CREATE INDEX usage_minute_time ON usage_samples_minute(sampled_minute);
CREATE INDEX usage_hour_time ON usage_samples_hour(sampled_hour);
```

- [ ] **Step 2: Run the migration test and confirm it fails**

Run: `node --test test/storefront-database.test.js`

Expected: failure because migration version 3 and its columns/tables do not exist.

- [ ] **Step 3: Implement migration version 3**

Append one migration object to `MIGRATIONS`. Keep it additive and transactional; do not update any existing profile rows after adding the columns.

- [ ] **Step 4: Write failing filename tests**

Specify this interface:

```js
const { buildDeliveryFilename } = require('../storefront/services/delivery-filename');

assert.equal(buildDeliveryFilename({ name: 'Nayem Ahmed', email: 'x@example.com', codeName: 'iPhone', profileId: 'abc' }), 'Nayem-Ahmed-iPhone.conf');
assert.equal(buildDeliveryFilename({ name: '', email: '15329802848@163.com', codeName: 'Phone', profileId: 'abc' }), '15329802848-Phone.conf');
assert.equal(buildDeliveryFilename({ name: '../Nayem', email: 'x@example.com', codeName: '/Phone', profileId: 'abc' }), 'Nayem-Phone.conf');
assert.match(buildDeliveryFilename({ name: '....', email: '...@example.com', codeName: '...', profileId: 'abcdef1234' }), /^vpn-abcdef12\.conf$/);
```

The helper must normalize whitespace/punctuation to single hyphens, remove control/path characters and leading dots, preserve Unicode letters/numbers, cap the basename to 96 characters, and append `.conf` exactly once.

- [ ] **Step 5: Run the helper test and confirm it fails**

Run: `node --test test/storefront-delivery-filename.test.js`

Expected: module-not-found failure.

- [ ] **Step 6: Implement the helper and pass focused tests**

Run: `node --test test/storefront-database.test.js test/storefront-delivery-filename.test.js`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add storefront/db/schema.js storefront/services/delivery-filename.js test/storefront-database.test.js test/storefront-delivery-filename.test.js
git commit -m "feat: add future profile analytics schema"
```

## Task 2: Opt only newly created profiles into analytics

**Files:**

- Modify: `storefront/repositories/profiles.js`
- Modify: `storefront/repositories/customers.js`
- Modify: `storefront/services/profiles.js`
- Modify: `storefront/services/trials.js`
- Modify: `test/storefront-trials.test.js`
- Modify: `test/storefront-orders.test.js`
- Modify: `test/storefront-database.test.js`

- [ ] **Step 1: Write failing creation tests**

For registered paid, guest paid, and trial profile creation, assert the persisted row contains:

```js
assert.equal(row.analytics_enabled, 1);
assert.equal(row.delivery_filename, 'Nayem-Ahmed-iPhone.conf');
```

Also insert a profile without the new fields directly through a legacy-compatible SQL fixture and assert it remains disabled/null.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/storefront-trials.test.js test/storefront-orders.test.js test/storefront-database.test.js`

Expected: new assertions fail because the repository does not persist the fields.

- [ ] **Step 3: Extend profile creation inputs**

Add a bound `customers.findById(id)` query, then change the profile repository insert columns and named parameters to include:

```js
analyticsEnabled: 1,
deliveryFilename: buildDeliveryFilename({
  name: customer.name,
  email: customer.normalized_email,
  codeName,
  profileId,
}),
```

Generate `profileId` before building the filename. In `createPaidProfile`, load the customer through `customers.findById(customerId)` before insertion. In guest and trial flows, use the customer already resolved inside the transaction. Do not add any migration-time update or fallback that enables old rows.

- [ ] **Step 4: Pass focused tests**

Run: `node --test test/storefront-trials.test.js test/storefront-orders.test.js test/storefront-database.test.js`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add storefront/repositories/profiles.js storefront/repositories/customers.js storefront/services/profiles.js storefront/services/trials.js test/storefront-trials.test.js test/storefront-orders.test.js test/storefront-database.test.js
git commit -m "feat: opt future profiles into analytics"
```

## Task 3: Use one stable human-readable filename for email and download

**Files:**

- Modify: `storefront/services/email.js`
- Modify: `test/storefront-email.test.js`
- Modify: `test/storefront-downloads.test.js`

- [ ] **Step 1: Write failing compatibility tests**

Cover both branches:

```js
// Future profile
assert.equal(message.payload.filename, 'Nayem-Ahmed-iPhone.conf');
assert.equal(downloads.calls[0].filename, 'Nayem-Ahmed-iPhone.conf');

// Existing profile
assert.equal(message.payload.filename, 'user21-d1.conf');
assert.equal(downloads.calls[0].filename, 'user21-d1.conf');
```

- [ ] **Step 2: Run tests and confirm the future-profile assertion fails**

Run: `node --test test/storefront-email.test.js test/storefront-downloads.test.js`

- [ ] **Step 3: Apply the stored filename at the delivery boundary**

In `configurationPayload(profile)`, use:

```js
const filename = profile.delivery_filename || config.filename;
const download = downloads.createDownloadToken({
  profileId: profile.id,
  configContent: config.content,
  filename,
});
return { config: config.content, filename, downloadUrl: `${publicBaseUrl}/download/${download.token}` };
```

Do not rename server-side WireGuard files and do not modify `lib/client-config.js`.

- [ ] **Step 4: Pass focused tests and commit**

Run: `node --test test/storefront-email.test.js test/storefront-downloads.test.js`

```bash
git add storefront/services/email.js test/storefront-email.test.js test/storefront-downloads.test.js
git commit -m "feat: name future VPN configuration deliveries"
```

## Task 4: Persist idempotent minute samples from read-only snapshots

**Files:**

- Create: `storefront/repositories/usage-history.js`
- Create: `storefront/services/usage-collector.js`
- Create: `test/storefront-usage-collector.test.js`

- [ ] **Step 1: Write failing repository and collector tests**

Define the repository interface:

```js
const usage = createUsageHistoryRepository(db);
usage.listEligibleProfiles();
usage.insertMinuteSample(sample); // returns true only when inserted
usage.findPreviousCounters(profileId);
```

Define the collector interface:

```js
const collector = createUsageCollector({ usageHistory: usage, now });
collector.record(snapshot);
```

Test that it:

- ignores profiles where `analytics_enabled = 0`;
- ignores eligible profiles without a matching `deviceId` snapshot row;
- writes at most one row per profile per UTC minute;
- maps customer download to snapshot `txBytesTotal`/`liveDownKbps` and upload to `rxBytesTotal`/`liveUpKbps`;
- clamps reset/negative counter deltas to zero;
- marks `connected = 1` only when the snapshot reports a current handshake/online state.

- [ ] **Step 2: Run the new test and confirm module failures**

Run: `node --test test/storefront-usage-collector.test.js`

- [ ] **Step 3: Implement bound SQL and a pure collector**

Use `INSERT OR IGNORE`, the `(profile_id, sampled_minute)` primary key, and ISO UTC minute keys such as `2026-10-09T14:32:00.000Z`. Keep the service synchronous and side-effect-free apart from repository writes. The collector must accept the already calculated snapshot; it must never execute a shell command.

- [ ] **Step 4: Pass tests and commit**

Run: `node --test test/storefront-usage-collector.test.js test/storefront-database.test.js`

```bash
git add storefront/repositories/usage-history.js storefront/services/usage-collector.js test/storefront-usage-collector.test.js
git commit -m "feat: collect future profile usage samples"
```

## Task 5: Add deterministic rollups and bounded range queries

**Files:**

- Modify: `storefront/repositories/usage-history.js`
- Create: `storefront/services/usage-analytics.js`
- Create: `test/storefront-usage-analytics.test.js`

- [ ] **Step 1: Write failing rollup tests**

Specify repository operations for completed-hour aggregation, deterministic upsert, aggregate existence checks, and deletion of raw rows only after the aggregate exists. Run rollup twice and assert identical hourly results. Simulate a failed aggregate and assert its raw rows remain.

- [ ] **Step 2: Write failing range-contract tests**

Define:

```js
const analytics = createUsageAnalyticsService({ usageHistory, now, timezone: 'Asia/Shanghai' });
const result = analytics.getProfileHistory(profileId, '7d');
```

Every result must have:

```js
{
  range: '7d',
  timezone: 'Asia/Shanghai',
  points: [{ timestamp, uploadKbps, downloadKbps }],
  summary: { uploadedBytes, downloadedBytes, peakUploadKbps, peakDownloadKbps, connectedMinutes }
}
```

Test `1h`, `1d`, `7d`, `10d`, `30d`, and `lifetime`; chronological order; empty zero summaries; invalid-range rejection; and lifetime capped at 240 points. Use minute points for `1h`, 10-minute buckets for `1d`, hourly for `7d`/`10d`, six-hour buckets for `30d`, and adaptive hourly grouping for lifetime.

- [ ] **Step 3: Run and confirm failures**

Run: `node --test test/storefront-usage-analytics.test.js`

- [ ] **Step 4: Implement rollup and query service**

Roll only completed UTC hours. In one transaction, upsert aggregates, confirm each row, then delete raw samples older than 30 days. Return safe numbers with no negative or non-finite values.

- [ ] **Step 5: Pass tests and commit**

Run: `node --test test/storefront-usage-analytics.test.js test/storefront-usage-collector.test.js`

```bash
git add storefront/repositories/usage-history.js storefront/services/usage-analytics.js test/storefront-usage-analytics.test.js
git commit -m "feat: aggregate and query usage history"
```

## Task 6: Wire collection into the admin process without affecting VPN operation

**Files:**

- Modify: `server.js`
- Modify: `storefront/server.js`
- Modify: `test/safety.test.js`
- Modify: `test/api.test.js`

- [ ] **Step 1: Add a failing safety/wiring test**

Inject a collector spy into the snapshot loop and assert it receives the completed snapshot. Make the spy throw and assert `computeSnapshot()` and the next timer cycle still succeed. Extend the source safety assertion so analytics modules contain none of:

```js
['awg set', 'awg-quick', 'systemctl', 'restart', 'reload', 'removePeer', 'toggleDevice']
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test test/safety.test.js test/api.test.js`

- [ ] **Step 3: Construct analytics dependencies once**

Have `storefront/server.js` expose the usage repository/service/collector alongside existing storefront administration dependencies. In `server.js`, call `collector.record(snapshot)` only after snapshot calculation succeeds. Catch collector errors, log a generic message without customer data, and continue. Trigger hourly rollup from the same non-blocking maintenance path.

- [ ] **Step 4: Pass safety tests and commit**

Run: `node --test test/safety.test.js test/api.test.js test/storefront-usage-collector.test.js`

```bash
git add server.js storefront/server.js test/safety.test.js test/api.test.js
git commit -m "feat: wire safe usage collection"
```

## Task 7: Add separately authorized customer and admin analytics APIs

**Files:**

- Modify: `storefront/services/tracking.js`
- Modify: `storefront/services/admin.js`
- Modify: `storefront/app.js`
- Modify: `app.js`
- Modify: `test/storefront-tracking.test.js`
- Modify: `test/storefront-auth.test.js`
- Modify: `test/storefront-api.test.js`
- Modify: `test/api.test.js`

- [ ] **Step 1: Write failing customer authorization tests**

For `GET /api/analytics/:profileId?range=1d`, assert: unauthenticated is rejected; owner succeeds; another customer gets 404; disabled/legacy profile gets 404; invalid range gets 400; service failure gets 503; response omits `pubkey`, IP, endpoint, and other customer data.

- [ ] **Step 2: Write failing administrator tests**

For `GET /api/storefront/analytics/:profileId?range=1d`, assert the existing admin session is required and the response adds only `customerName`, `customerEmail`, and `codeName` to the shared chart contract. Add `analyticsProfiles` to the existing storefront admin bootstrap/list response with only eligible profiles.

- [ ] **Step 3: Run tests and confirm 404/failure**

Run: `node --test test/storefront-auth.test.js test/storefront-api.test.js test/storefront-tracking.test.js test/api.test.js`

- [ ] **Step 4: Implement ownership at the service layer**

Use bound repository lookups. Customer service signature:

```js
getCustomerHistory({ customerId, profileId, range })
```

Admin service signature:

```js
getProfileHistory({ profileId, range })
listAnalyticsProfiles()
```

Return 404 for missing, ineligible, or non-owned profiles to prevent enumeration. Reuse the analytics service for both route families.

Extend the signed-in dashboard profile DTO with `analyticsEnabled: profile.analytics_enabled === 1`; do not expose the delivery filename or analytics flag in guest tracking responses.

- [ ] **Step 5: Pass tests and commit**

Run: `node --test test/storefront-auth.test.js test/storefront-api.test.js test/storefront-tracking.test.js test/api.test.js`

```bash
git add storefront/services/tracking.js storefront/services/admin.js storefront/app.js app.js test/storefront-tracking.test.js test/storefront-auth.test.js test/storefront-api.test.js test/api.test.js
git commit -m "feat: expose private usage analytics APIs"
```

## Task 8: Add customer usage charts without changing guest tracking

**Files:**

- Modify: `storefront/public/dashboard.html`
- Modify: `storefront/public/dashboard.js`
- Modify: `storefront/public/model.js`
- Modify: `storefront/public/styles.css`
- Modify: `test/storefront-browser-model.test.js`

- [ ] **Step 1: Write failing browser-model tests**

Extract pure helpers for range validation, chart point normalization, SVG path creation, and summary formatting. Test empty history, one point, multiple points, zero maxima, hostile/non-finite input, and all six range controls.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/storefront-browser-model.test.js`

- [ ] **Step 3: Build the signed-in history component**

For each `analyticsEnabled` profile, render `Usage history`, range buttons (`1h`, `1d`, `7d`, `10d`, `30d`, `lifetime`), summary cards, and an accessible inline SVG with upload/download paths. Fetch only when that profile/range is selected. Provide a textual summary, `role="img"`, an empty-state message, a retry button, keyboard-visible focus, and reduced-motion styles.

Do not add history to `track.html` or guest email tracking. Preserve existing profile/allowance cards and download actions.

- [ ] **Step 4: Pass browser tests and commit**

Run: `node --test test/storefront-browser-model.test.js test/storefront-tracking.test.js`

```bash
git add storefront/public/dashboard.html storefront/public/dashboard.js storefront/public/model.js storefront/public/styles.css test/storefront-browser-model.test.js
git commit -m "feat: show customer usage history"
```

## Task 9: Restyle the admin panel and add its usage-history workspace

**Files:**

- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `public/user-view.js`
- Modify: `test/browser-model.test.js`
- Modify: `test/user-model.test.js`

- [ ] **Step 1: Lock existing admin behavior with tests**

Add assertions that the redesigned model still exposes VPN users, add user/device, orders, QR replacement, recently deleted, password change, sign out, configuration download, archive/delete confirmations, quota, expiry, and live speed. Add analytics-selector and SVG-helper tests matching the customer chart contract.

- [ ] **Step 2: Run and confirm new UI-model tests fail**

Run: `node --test test/browser-model.test.js test/user-model.test.js`

- [ ] **Step 3: Apply the Bright Pocket visual system**

Retain the existing DOM actions and API calls while reorganizing navigation into VPN users, storefront customers, orders, usage history, payment QR, recently deleted, and account controls. Reuse the storefront's cream/yellow/purple/deep-purple tokens, typography, rounded surfaces, spacing, and focus treatment. Use dense tables on wide screens and cards below tablet width.

Add a usage-history workspace with customer/profile selectors, six range controls, the shared summaries, inline SVG graph, empty/error states, and no legacy profiles in its selector. Do not rename or remove existing buttons or confirmations unless tests and event handlers are updated together.

- [ ] **Step 4: Pass UI tests and perform responsive checks**

Run: `node --test test/browser-model.test.js test/user-model.test.js test/api.test.js`

Check at 390×844, 768×1024, 1366×768, and 1920×1080. Confirm there is no horizontal page overflow, all controls remain reachable, charts resize, and the user table/card switch preserves actions.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css public/user-view.js test/browser-model.test.js test/user-model.test.js
git commit -m "feat: redesign admin usage workspace"
```

## Task 10: Verify, document, deploy, and prove no VPN interruption

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-09-future-customer-usage-analytics-design.md` only if implementation details required a documented, approved correction

- [ ] **Step 1: Document operations**

Document analytics eligibility, one-minute collection, 30-day raw retention, hourly lifetime rollup, customer/admin privacy, filenames, and the rule that existing profiles are excluded. Add a troubleshooting section for missing samples and chart/API failures that never recommends restarting AmneziaWG.

- [ ] **Step 2: Run the complete local suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run static safety and repository checks**

Run:

```bash
git diff --check
rg -n "awg-quick|systemctl .*awg|restart.*awg|reload.*awg" storefront public server.js app.js
git status --short
```

Expected: no analytics-path VPN mutation, no whitespace errors, only intended changes.

- [ ] **Step 4: Back up production before deploying**

Create timestamped backups of the application release, storefront SQLite database (using SQLite online backup), private uploads/storage, Nginx configuration, application peer store/keys, and `/etc/amnezia/amneziawg/awg0.conf`. Record before-state evidence:

```bash
sha256sum /etc/amnezia/amneziawg/awg0.conf
awg show awg0
pm2 status
```

Never stop or reload `awg0`.

- [ ] **Step 5: Deploy and validate privately before switching web processes**

Upload the release to a versioned directory, install production dependencies without lifecycle surprises, run migrations on a copied test database first, then run the full suite and private health/API checks against alternate local ports. Confirm the migrated production database leaves all existing rows at `analytics_enabled = 0` before starting the new web release.

- [ ] **Step 6: Restart only Node web processes one at a time**

Restart the storefront Node process, confirm `/`, auth, tracking, and email queue health, then restart the admin Node process and confirm `/admin/`, existing user/device data, orders, QR settings, and analytics authorization. Do not restart Nginx unless its configuration changed; if it did, use a syntax check and graceful reload only. Do not restart or reload AmneziaWG.

- [ ] **Step 7: Prove live VPN state is unchanged**

Repeat:

```bash
sha256sum /etc/amnezia/amneziawg/awg0.conf
awg show awg0
pm2 status
```

Compare the `awg0.conf` checksum with Step 4, confirm the interface remains up, and confirm existing handshakes/transfer counters continue advancing. Verify existing profiles are absent from the analytics selector.

- [ ] **Step 8: Verify future-only behavior safely**

Use an isolated server-side test database to prove sampling and ranges. For the first real future customer profile only, confirm `analytics_enabled = 1`, the stored delivery filename is correct, one sample appears after the next UTC minute, customer ownership is enforced, and the admin graph renders. Do not create, remove, toggle, or reprovision a live peer solely for testing.

- [ ] **Step 9: Commit documentation and push**

```bash
git add README.md docs/superpowers/specs/2026-10-09-future-customer-usage-analytics-design.md
git commit -m "docs: operate future customer analytics"
git push origin main
```

## Final Acceptance Checklist

- [ ] Every profile that existed before deployment still has the same VPN identity, keys, IP, quota, expiry, enabled state, and configuration filename behavior.
- [ ] Existing profiles have `analytics_enabled = 0` and produce no history rows.
- [ ] Every newly created storefront profile has `analytics_enabled = 1` and a safe stored filename.
- [ ] Email attachment and secure download use the same filename.
- [ ] Minute collection is idempotent and cannot interrupt snapshot calculation.
- [ ] Raw retention, hourly rollup, and all six ranges pass deterministic tests.
- [ ] Customer history is owner-only and admin history uses existing admin authentication.
- [ ] Guest tracking remains allowance-only.
- [ ] Admin functionality is preserved and the refreshed UI is responsive on phone, tablet, and desktop.
- [ ] Full test suite passes; production web health is green; `awg0.conf` checksum and active VPN interface are unchanged.
