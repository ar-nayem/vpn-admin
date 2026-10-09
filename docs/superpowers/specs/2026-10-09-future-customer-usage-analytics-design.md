# Future-Customer Usage Analytics and Admin Redesign

## Purpose

Add one-minute VPN usage history for future storefront customers, expose private graphs to those customers and the administrator, adopt the customer storefront's visual language in the admin panel, and give future emailed configurations human-readable filenames. Existing VPN peers and existing storefront profiles must remain unchanged and excluded from collection.

## Non-negotiable safety boundary

- The migration adds `analytics_enabled` with a database default of `0`. Every profile present when the migration runs therefore remains excluded.
- Only profile creation performed after deployment writes `analytics_enabled = 1` and a non-null `delivery_filename`.
- The collector reads `awg show` output and the existing peer snapshot. It never calls peer creation, removal, toggle, traffic-control, configuration persistence, interface reload, service restart, `awg-quick`, or any other VPN mutation.
- No historical data is invented or backfilled for existing profiles.
- Existing configuration names, keys, IPs, quotas, and customer connectivity are not modified.
- Deployment restarts only the Node web processes after private health checks. It never restarts or reloads AmneziaWG.

## Customer eligibility and configuration filenames

Migration version 3 adds these nullable/profile-safe fields to `vpn_profiles`:

- `analytics_enabled INTEGER NOT NULL DEFAULT 0 CHECK (analytics_enabled IN (0,1))`
- `delivery_filename TEXT`

The storefront profile service sets `analytics_enabled = 1` only when creating a new trial or paid profile after the feature is deployed. It calculates `delivery_filename` once and stores it, making later customer-name edits unable to silently rename an established download.

Filename construction uses:

1. The customer's trimmed real name when present.
2. Otherwise, the normalized email local part before `@`.
3. The profile code name as the device suffix.

Unsafe filesystem characters, control characters, path separators, repeated punctuation, and leading dots are removed. Components are transliterated only when safely possible; Unicode letters and numbers remain valid. The result is capped at 96 characters before `.conf`. Examples are `Nayem-Ahmed-iPhone.conf` and `15329802848-iPhone.conf`. Existing profiles have `delivery_filename = NULL`, so their current filename behavior remains unchanged.

The secure link and direct email attachment use the same stored filename.

## Collection architecture

A focused `usage-history` module runs inside the admin web process because that process already reads live AmneziaWG counters every two seconds. It receives a read-only snapshot after calculation and persists at most one sample per eligible profile per UTC minute.

Eligibility is resolved by joining `vpn_profiles.device_id` to snapshot `deviceId` where `analytics_enabled = 1`. Legacy peers and pre-migration profiles cannot match the eligible query.

Each raw sample stores:

- Profile identifier
- UTC minute timestamp
- Upload speed in Kbps
- Download speed in Kbps
- Uploaded-byte delta
- Downloaded-byte delta
- Connected state

The collector uses a unique key on `(profile_id, sampled_minute)` so duplicate timer execution is idempotent. Negative counter deltas caused by a process or interface counter reset are treated as zero for that interval. A collector/database error is logged without stopping snapshot calculation, quota enforcement, the web server, or VPN service.

## Storage and retention

Migration version 3 creates:

### `usage_samples_minute`

Raw one-minute samples retained for 30 days.

### `usage_samples_hour`

Hourly aggregates retained for the lifetime of the profile. Each row stores average and peak upload/download Kbps, uploaded/downloaded bytes, connected-minute count, and sample count.

Once per hour, a transaction rolls completed raw hours into `usage_samples_hour`, then deletes raw samples older than 30 days only after confirming their aggregate row exists. Re-running rollup replaces the same hourly aggregate deterministically.

This supports high-resolution recent views while keeping lifetime storage bounded. At one active profile, raw storage is at most 43,200 rows plus 8,760 hourly rows per year. SQLite remains in WAL mode and writes use short transactions.

## Range semantics

Supported range identifiers are:

- `1h`: previous 60 minutes, one-minute points
- `1d`: previous 24 hours, grouped into 10-minute points
- `7d`: previous 7 days, hourly points
- `10d`: previous 10 days, hourly points
- `30d`: previous 30 days, grouped into six-hour points
- `lifetime`: all available hourly history, grouped adaptively to at most 240 plotted points

Every response includes UTC timestamps, upload/download series, transferred-byte totals, peak speeds, connected duration, and the server-generated display timezone label. Empty history returns an empty series and zero summaries rather than an error.

## Authorization and APIs

Customer endpoint:

`GET /api/analytics/:profileId?range=1d`

- Requires an authenticated customer session.
- Confirms that the profile belongs to that customer and has analytics enabled.
- Returns no peer public key, IP, endpoint, or other customer's data.

Administrator endpoint:

`GET /api/storefront/analytics/:profileId?range=1d`

- Requires the existing administrator session.
- Confirms the profile is analytics-enabled.
- Returns the same chart contract plus customer name, email, and device code name for context.

Admin profile discovery is added to the existing storefront administration response so the administrator can select a customer and device without exposing legacy peers to analytics collection.

Invalid ranges return a safe 400 response. Unknown or unauthorized profiles return 404 so ownership cannot be enumerated. All statements use bound parameters.

## Customer experience

The signed-in dashboard keeps its current profile and allowance cards. Each analytics-enabled profile gains a `Usage history` section containing:

- Upload and download line graph
- Range selector for 1 hour, 1 day, 7 days, 10 days, 30 days, and lifetime
- Total transferred, peak upload, peak download, and connected-time summary
- A clear `History starts when this VPN profile is created` empty state

The chart is rendered with accessible inline SVG and a textual summary. It uses the existing cream, yellow, purple, and deep-purple design tokens, responsive sizing, keyboard-accessible controls, and reduced-motion behavior. Data is requested only for the selected profile and range.

Guest email tracking continues to show remaining allowance only; detailed historical graphs require sign-in so a reusable verification link cannot expose a long-term activity pattern.

## Administrator experience

The admin panel retains every existing user, device, quota, expiry, configuration, archived-user, order, QR, and password control. Its layout is restyled to match Bright Pocket rather than replaced.

The main navigation separates:

- VPN users
- Storefront customers
- Orders
- Usage history
- Payment QR
- Recently deleted
- Password and sign out

Usage history provides customer and device selectors, the same range controls and graph contract as the customer dashboard, and summary statistics. Legacy and existing profiles appear in their existing user-management views but not in the new analytics selector.

Responsive behavior uses cards below tablet width and tables where desktop density is useful. The redesign does not alter endpoint semantics or destructive-action confirmations.

## Failure handling

- Collection failure: log a generic diagnostic, skip that minute, and continue all VPN/admin operations.
- Rollup failure: retain raw rows and retry next hour; never delete unaggregated data.
- Analytics API failure: return a safe temporary-unavailable message without affecting current allowance/status data.
- Missing mapping: skip the profile and record no fabricated zero sample.
- Browser chart failure: show the numeric summaries and a retry action.
- Filename collision: include the device code name and, only if necessary, a short stable profile suffix.

## Testing

Automated tests cover:

- Migration defaults existing profiles to analytics disabled.
- Newly created profiles enable analytics and store the expected safe filename.
- Existing profiles retain the old configuration filename path.
- Collector records only eligible future profiles and is idempotent per minute.
- Negative/reset deltas never create negative usage.
- Hourly rollup is deterministic and deletes only safely aggregated raw data older than 30 days.
- Every range returns bounded, chronologically ordered points.
- Customer ownership and admin authentication are enforced.
- Customer and admin browser models render empty, active, and multi-range history safely.
- Existing provisioning safety test still proves there is no VPN restart or reload operation.

Production verification checks both web processes, the public/private routes, a synthetic eligible profile in an isolated test database, and confirms the live `awg0.conf` checksum and active interface are unchanged before and after deployment.

## Rollout and rollback

1. Back up the application, storefront database, private storage, Nginx configuration, peer store, keys, and `awg0.conf`.
2. Deploy code and run migrations while existing profiles receive `analytics_enabled = 0` by default.
3. Run the full suite and an isolated collector test on the server.
4. Restart only the admin and storefront Node processes, one at a time, with health checks.
5. Confirm storefront, admin, analytics authorization, email, and existing VPN interface health.
6. Observe the first eligible future profile's minute samples after it is created.

Rollback stops collection by returning to the prior Node release. The additive tables and columns may remain safely unused; no destructive schema rollback is required. Restoring the database backup is reserved for corruption, not an ordinary application rollback. At no point is the VPN interface restarted or reloaded.
