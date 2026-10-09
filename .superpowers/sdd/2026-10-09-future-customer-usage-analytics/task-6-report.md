# Task 6 Report: Safe Usage Collection Wiring

## Implementation

- Added `createUsageSnapshotCycle` to `storefront/services/usage-collector.js`. It computes the snapshot first, records only a completed snapshot, catches collector failures, and logs only a generic message.
- Added `createUsageServices` in `storefront/server.js` to construct and expose the usage history repository, analytics service, and collector. Both storefront startup and the admin process construct these dependencies once per database.
- Wired the admin snapshot timer to the safe cycle. Hourly rollup is queued with `setImmediate`, checked once per minute for a new UTC hour, and guarded with a generic error log.
- Added tests for safe collection, dependency exposure, and forbidden VPN/account mutation controls in analytics modules.

## RED/GREEN

- RED: `node --test test/safety.test.js test/api.test.js` — 9 passed, 1 failed. The new safety regression failed because `createUsageSnapshotCycle` was not yet exported (`actual: undefined`, expected `function`).
- GREEN: `node --test test/safety.test.js test/api.test.js test/storefront-usage-collector.test.js` — 18 passed, 0 failed.

## Full suite

- `node --test` — 114 passed, 0 failed.
- `git diff --check` — passed.

## Files

- `server.js`
- `storefront/server.js`
- `storefront/services/usage-collector.js`
- `test/api.test.js`
- `test/safety.test.js`

## Self-review and concerns

- Collection runs after successful snapshot calculation. A thrown collector error cannot prevent the current call from returning the snapshot or a subsequent timer cycle from running.
- Collection and rollup errors log generic messages without the caught error contents or customer data.
- The analytics modules contain none of the specified VPN or account mutation controls. The integration does not call VPN shell commands or reload/restart the service.
- Rollup is scheduled outside the snapshot callback and retries on a later minute if it fails.
- No known concerns.
