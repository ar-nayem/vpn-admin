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

## Fix round 1/5: run hourly rollup in a worker thread

- Finding: `setImmediate` deferred synchronous SQLite rollup but still ran it on the admin process event loop, which could delay peer snapshots and HTTP work.
- Change: added `storefront/services/usage-rollup-scheduler.js` and `storefront/workers/usage-rollup-worker.js`. The main process dispatches one worker at a time. The worker opens its own storefront database connection, creates the usage repository, rolls up completed hours, reports status, closes the connection, and exits. Worker errors and nonzero exits log only `Usage analytics rollup failed`; retries remain possible after worker exit.
- RED: `node --test test/storefront-usage-rollup-worker.test.js` — 3 failed, 0 passed. Each failed because the scheduler factory was not yet present (`actual: undefined`, expected `function`).
- Lifecycle RED: `node --test test/storefront-usage-rollup-worker.test.js` — 3 passed, 1 failed. The active-slot assertion showed a retry was accepted immediately after the worker's error event (`true !== false`) before its exit event.
- GREEN: `node --test test/safety.test.js test/api.test.js test/storefront-usage-rollup-worker.test.js` — 15 passed, 0 failed.
- Full suite: `node --test` — 118 passed, 0 failed.
- Diff check: `git diff --check` — passed.
- Self-review: duplicate cadence is skipped while the worker remains active, including between error and exit events. Success clears the active slot and records the hour; failure clears the slot on exit and permits a retry. Worker source has only database/repository/rollup/status/close operations. The safety source check covers the worker and scheduler for the prohibited VPN/account controls. No known concerns.
