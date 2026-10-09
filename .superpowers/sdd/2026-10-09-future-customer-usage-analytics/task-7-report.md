# Task 7 Report: Separately Authorized Analytics APIs

## Implementation

- Added customer `GET /api/analytics/:profileId?range=...`, protected by customer session authentication and profile ownership checks. Missing, non-owned, legacy, pending, and disabled profiles return 404; invalid ranges return 400; analytics failures return a safe 503 response.
- Added admin `GET /api/storefront/analytics/:profileId?range=...` behind the existing admin session. Its chart response adds only `customerName`, `customerEmail`, and `codeName` to the shared chart DTO.
- Added `analyticsProfiles` to the authenticated storefront order list response. It includes only active, provisioned profiles with analytics enabled and exposes only profile ID, code name, customer name, and customer email.
- Reused the existing usage analytics service in both runtimes. Signed-in dashboard profiles now include `analyticsEnabled`; guest responses omit that flag and the delivery filename.

## RED/GREEN

- RED: `node --test test/storefront-auth.test.js test/storefront-api.test.js test/storefront-tracking.test.js test/api.test.js` — 7 failed, 15 passed. Failures showed absent customer/admin routes, missing history methods, missing dashboard flag, and absent admin discovery.
- GREEN: `node --test test/storefront-auth.test.js test/storefront-api.test.js test/storefront-tracking.test.js test/api.test.js` — 22 passed, 0 failed.

## Full suite

- `npm test` — 122 passed, 0 failed.
- `git diff --check` — passed.

## Files

- `app.js`
- `server.js`
- `storefront/app.js`
- `storefront/server.js`
- `storefront/services/admin.js`
- `storefront/services/tracking.js`
- `test/api.test.js`
- `test/storefront-api.test.js`
- `test/storefront-tracking.test.js`

## Self-review and concerns

- Customer ownership and eligibility are checked before analytics lookup using a bound profile repository query. Admin profile queries are bound and select only explicitly permitted fields.
- The chart response comes from the existing analytics service, whose public DTO omits raw counters and profile/customer fields. Customer failures are replaced with a generic message; admin failures are also sanitized.
- Customer and admin discovery consistently require analytics enabled, a device mapping, and active state. Tests cover foreign ownership, legacy, pending, disabled, and missing profiles.
- Guest tracking continues to omit both analytics enablement and delivery filename. Tests assert that `pubkey` and IP fields are also absent.
- No known concerns.
