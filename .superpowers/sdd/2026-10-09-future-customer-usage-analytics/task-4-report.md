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
- Counter resets produce a zero delta for the reset interval; the raw counter saved with that sample becomes the baseline for the following minute.
- No VPN commands or mutations are present in the collector or repository.

## Fix round 1: preserve raw counters for reset recovery

The minute table now stores nonnegative `raw_rx_bytes` and `raw_tx_bytes`. `findPreviousCounters` returns the raw counters from the immediately preceding stored minute row, and the collector includes the current raw counters in its `INSERT OR IGNORE`. A duplicate minute does not advance the baseline because the insert is ignored. The reset regression records a high sample, verifies a reset interval contributes zero, then verifies a later increment below the former high baseline is counted.

RED/GREEN and verification commands:

- `node --test test/storefront-usage-collector.test.js test/storefront-database.test.js` before implementation: 14 tests, 10 passed and 4 failed (raw columns missing, stored raw fields missing, latest sample baseline not used, collector insert lacked required raw fields).
- `node --test test/storefront-usage-collector.test.js test/storefront-database.test.js` after implementation: 14 passed, 0 failed.
- `node --test`: 103 passed, 0 failed.
- `git diff --check`: passed with no output.

The prior reconstructed lifetime baseline is removed. Hourly aggregates continue to store interval totals and are not used as raw counter baselines.
