# Task 4 Report: Idempotent Usage Collection

## Implementation

- Added `storefront/repositories/usage-history.js` with bound SQL for opt-in profiles, idempotent minute inserts, and previous-counter lookup. Counter lookup combines hourly totals with minute rows not already represented by an hourly rollup.
- Added `storefront/services/usage-collector.js`. It accepts the existing read-only device snapshot, maps server transmit/download and receive/upload counters and rates, computes nonnegative byte deltas, and stores one UTC minute sample per eligible mapped profile. It does not execute commands or mutate VPN state.
- Added `test/storefront-usage-collector.test.js` for legacy exclusion, missing mappings, idempotency, direction mapping, reset and invalid-value clamping, connection state, and counter continuity across hourly rollups.

## RED/GREEN

- Initial focused run failed because the repository module did not exist.
- The added regression test for minute rows overlapping hourly aggregates failed with a doubled baseline, then passed after the query excluded already rolled-up minute rows.
- Focused collector and database tests: 14 passed.

## Full suite

- `node --test`: 103 passed, 0 failed.
- `git diff --check`: passed.

## Self-review and concerns

- Repository writes use `INSERT OR IGNORE`; the existing `(profile_id, sampled_minute)` primary key makes duplicate calls return `false` without changing stored data.
- Profile selection requires both `analytics_enabled = 1` and a non-null device ID. Missing snapshot rows are skipped.
- Counter resets produce a zero delta as required. Because the existing tables store interval totals rather than the latest raw counter, a reset counter can remain below its reconstructed pre-reset baseline until it grows past that value. No separate raw-counter field exists in the supplied schema.
- No VPN commands or mutations are present in the collector or repository.
