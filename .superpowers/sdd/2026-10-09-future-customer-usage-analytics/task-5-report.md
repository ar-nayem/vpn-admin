# Task 5 Report: Deterministic Rollups and Bounded History

## Implementation

- Extended `storefront/repositories/usage-history.js` with transactional UTC completed-hour rollups, deterministic upserts, aggregate existence checks, retention pruning guarded by a matching aggregate, and ordered minute/hour reads.
- Added `storefront/services/usage-analytics.js` with the six requested ranges, UTC timestamps, chronological points, configurable timezone metadata, bounded lifetime grouping, and safe nonnegative response numbers.
- Added `test/storefront-usage-analytics.test.js` for rollup stability and failure retention, all range contracts and granularities, empty summaries, invalid ranges, raw/aggregate overlap, retention, and lifetime point limits.

## RED/GREEN

- RED: `node --test test/storefront-usage-analytics.test.js` failed because the requested analytics service did not exist.
- GREEN: `node --test test/storefront-usage-analytics.test.js test/storefront-usage-collector.test.js` passed: 15 tests, 0 failures.

## Full suite

- `node --test`: 110 passed, 0 failed.
- `git diff --check`: passed.

## Self-review and concerns

- Aggregation and pruning share one SQLite transaction. Each grouped hour is upserted and checked before pruning can remove raw rows; an insert failure rolls back and preserves raw samples.
- Re-running rollup produces the same hourly values. Only hours before the current UTC hour are included.
- Recent raw minute samples retain range-specific detail. Where old raw rows have been pruned, hourly aggregates supply history without duplicating overlapping data.
- Lifetime history first groups by UTC hour, then widens the grouping only when needed to remain at or below 240 points.
- No known concerns.
