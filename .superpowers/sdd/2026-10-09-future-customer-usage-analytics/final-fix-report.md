# Final fix wave report

Base: `db0f6f670caac02e4472cec3f027186cc2ba8517`

## Findings and changes

1. `computeSnapshot()` now returns the actual completed snapshot. A production-server harness verifies that the returned snapshot is shared with the API and reaches the real collection worker while quota accounting still advances.
2. Minute collection now dispatches at most one worker attempt per UTC minute. The worker opens its own SQLite connection with a 50 ms busy timeout, records through the existing collector in an immediate transaction, closes the connection, and reports only generic failure status. Failed minutes are skipped and the next minute can retry. The server snapshot cycle uses this scheduler, alongside the existing hourly rollup scheduler. A real competing `BEGIN IMMEDIATE` lock test verifies caller responsiveness, prompt failure, retry, and no duplicate samples.
3. Lifetime analytics now group relative to the first hourly point and enlarge the bucket width until the result is at most 240 points. Summary totals and peaks are computed from all grouped samples. Tests cover 480 consecutive hours starting at an odd UTC hour, 241 points two hours apart, and 481 sparse points across multiple years.
4. Delivery filenames reserve space for the sanitized device name within the 96-character basename. Repository lookup detects collisions per customer; creation appends a stable profile-ID hash only when a collision exists, and stores the result with the profile. Registered, guest, and trial creation use the same allocator. Legacy null filename fallback remains intact.
5. Signed-in dashboards now distinguish analytics-enabled profiles awaiting activation from active profiles. The profile shows “Awaiting activation”; the usage panel shows an explicit activation message and does not request history until an eligible active device exists.
6. Customer peak rates display in Kbps below 1 Mbps and one-decimal Mbps at or above 1 Mbps, matching administrator formatting. Tests cover 0, 400 Kbps, 1023 Kbps, 1 Mbps, and higher values.

## RED evidence

The prior worker reported 11 expected failures among 47 tests before implementation. In this handoff, the focused pre-fix run reproduced four failures among 51 tests: the long-label device suffix case and both sanitized-filename collision cases, plus the existing Unicode truncation expectation updated by the partial work. No extra failure was manufactured for this report. The pending-activation test was strengthened to assert the explicit message and remained request-free.

## GREEN evidence

- Focused server, safety, collection worker, collector, rollup, analytics, database, trial/profile, filename, order, email, tracking, and browser suites: **89 passed, 0 failed**.
- Full `npm test`: **154 passed, 0 failed**.
- `node --check` on all changed JavaScript source and test files: passed.
- `git diff --check`: passed.

## Files

- Production: `server.js`; `storefront/server.js`; `storefront/public/dashboard.js`; `storefront/public/model.js`; `storefront/repositories/profiles.js`; `storefront/services/delivery-filename.js`; `storefront/services/profiles.js`; `storefront/services/tracking.js`; `storefront/services/trials.js`; `storefront/services/usage-analytics.js`; `storefront/services/usage-collection-scheduler.js`; `storefront/workers/usage-collection-worker.js`.
- Tests: `test/admin-server.test.js`; `test/api.test.js`; `test/safety.test.js`; `test/storefront-browser-model.test.js`; `test/storefront-delivery-filename.test.js`; `test/storefront-orders.test.js`; `test/storefront-tracking.test.js`; `test/storefront-usage-analytics.test.js`; `test/storefront-usage-collection-worker.test.js`.

## Self-review and concerns

- Collection worker imports only the history repository and collector; it has no VPN or provisioning imports. Analytics remains opt-in for existing profiles and eligible history remains restricted to activated profiles.
- Sampling contention can skip one minute; the next successful counter sample measures from the last persisted counter baseline. Collection failures are isolated from snapshot and quota work.
- Filename collision checks are scoped to a customer, and persisted filenames are not recalculated when customer names change. A profile-ID SHA-256 prefix gives stable disambiguation.
- No deployment, push, merge, VPN mutation, restart, or reload was performed.
