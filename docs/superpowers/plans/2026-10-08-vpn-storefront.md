# VPN Storefront and Customer Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public VPN storefront, optional customer accounts, secure guest tracking, one-time automatic trials, manual payment-proof approval, branded Gmail delivery, and in-place paid upgrades without interrupting the live AmneziaWG interface.

**Architecture:** Add an unprivileged storefront process on localhost port 7600 while retaining the privileged VPN admin process on localhost port 7500. Nginx exposes the storefront at `/`, the existing admin panel at `/admin`, and never exposes the HMAC-authenticated localhost provisioning API. SQLite stores storefront state; the existing peer/key stores and transactional provisioning layer remain the only owner of live VPN mutations.

**Tech Stack:** Node.js 20, CommonJS, Express, SQLite via `better-sqlite3`, `express-session` with `connect-sqlite3`, `bcryptjs`, `nodemailer`, `multer`, `helmet`, `express-rate-limit`, native `crypto`, plain HTML/CSS/JavaScript, Node test runner, Nginx, PM2.

**Spec:** `docs/superpowers/specs/2026-10-08-vpn-storefront-design.md`

## Global Constraints

- Public URL: `https://vpn.arnayem.top/`; private admin URL: `https://vpn.arnayem.top/admin`.
- Basic: ¥5/month, 60 GB/month, 5 Mbps download and upload.
- Premium: ¥10/month, 120 GB/month, unlimited speed.
- Pro: ¥15/month, 200 GB/month, unlimited speed.
- Multiple months multiply price, total quota, and calendar-month expiry; quota does not reset monthly.
- One automatic free trial per normalized verified email: 1 GB, 5 Mbps each direction, no time expiry, one device.
- Each code name maps to exactly one VPN peer/configuration.
- A paid order for a trial code name upgrades the same peer and key in place.
- Paid orders require a private proof image and administrator approval.
- Approval email includes both the `.conf` attachment and a single-use 24-hour link.
- Public process runs without VPN privileges; only the admin process may mutate AmneziaWG.
- Every VPN mutation uses targeted `awg set`; never execute `awg-quick`, restart, reload, bring down, or bring up the VPN interface.
- Existing users, keys, metadata, peer numbers, and live sessions must remain intact.
- Bright Pocket is the approved visual direction: warm cream, energetic yellow, vivid purple, colorful and mobile-first.
- Gmail sender is `nayem3622@gmail.com`; its app password is an environment secret and never enters Git.

## File Structure

### Storefront runtime

- `storefront/server.js` — process entry point, configuration validation, workers, and graceful shutdown.
- `storefront/app.js` — Express composition, security middleware, public/customer routes, and static serving.
- `storefront/config.js` — required environment parsing and filesystem paths.
- `storefront/db/database.js` — SQLite connection, WAL mode, migrations, and transaction helper.
- `storefront/db/schema.js` — versioned SQL migrations.
- `storefront/catalog.js` — immutable package definitions and authoritative month calculations.
- `storefront/repositories/*.js` — focused SQL persistence for customers, challenges, profiles, orders, settings, outbox, tokens, and audit events.
- `storefront/services/auth.js` — registration, password/code login, password recovery, and session identity.
- `storefront/services/verification.js` — six-digit code creation, hashing, expiry, attempt control, and delivery enqueue.
- `storefront/services/trials.js` — transactional one-trial rule and automatic provisioning orchestration.
- `storefront/services/orders.js` — paid order submission, proof ownership, and customer-visible status.
- `storefront/services/email.js` — Nodemailer transport, branded templates, attachments, and outbox worker.
- `storefront/services/provisioning-client.js` — signed localhost requests to the privileged admin process.
- `storefront/services/downloads.js` — single-use 24-hour configuration tokens.
- `storefront/middleware/*.js` — customer auth, verified guest grants, CSRF, upload validation, and errors.
- `storefront/public/*` — Bright Pocket storefront, auth, checkout, tracking, and dashboard UI.
- `storefront/email/*` — responsive HTML and plain-text email renderers.

### Privileged admin runtime

- `lib/provisioning.js` — entitlement-aware create and in-place upgrade operations.
- `lib/internal-auth.js` — constant-time HMAC request verification with replay protection.
- `app.js` — `/admin` mounting, admin order proxy/actions, and localhost-only internal provisioning routes.
- `public/*` — existing admin UI moved under `/admin`, plus order review and QR settings views.

### Tests and operations

- `test/storefront-*.test.js` — catalog, database, auth, verification, orders, uploads, email, downloads, and API tests.
- `test/internal-provisioning.test.js` — signed internal API and entitlement mutation tests.
- `test/storefront-integration.test.js` — trial, guest tracking, purchase, approval, and retry flows.
- `ecosystem.config.example.js` — two-process PM2 example without secrets.
- `deploy/nginx-vpn.conf` — explicit public/admin routing and private-path denial.
- `scripts/backup-storefront.sh` — safe database/upload/config backup script.
- `README.md` — setup, secrets, QR upload, Gmail app password, deployment, rollback, and recovery.

---

### Task 1: Package Catalog and Storefront Database

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `storefront/catalog.js`
- Create: `storefront/db/database.js`
- Create: `storefront/db/schema.js`
- Create: `test/storefront-catalog.test.js`
- Create: `test/storefront-database.test.js`

**Interfaces:**
- Produces: `calculateEntitlement(planId, months, activatedAt)` returning `{ planId, planName, months, priceCny, quotaBytes, downKbps, upKbps, expiresAt }`.
- Produces: `openDatabase(file)` returning a migrated `better-sqlite3` database in WAL mode.
- Produces tables consumed by every later storefront task.

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
npm install better-sqlite3 connect-sqlite3 nodemailer multer helmet express-rate-limit
```

Expected: `package.json` and `package-lock.json` contain the new production dependencies and `npm audit` reports no known vulnerabilities.

- [ ] **Step 2: Write failing package calculation tests**

Create literal assertions including:

```js
assert.deepEqual(
  calculateEntitlement('basic', 3, new Date('2026-10-08T00:00:00.000Z')),
  {
    planId: 'basic',
    planName: 'Basic',
    months: 3,
    priceCny: 15,
    quotaBytes: 180 * 1024 ** 3,
    downKbps: 5120,
    upKbps: 5120,
    expiresAt: '2027-01-08T00:00:00.000Z',
  }
);
assert.equal(calculateEntitlement('premium', 2, new Date('2026-10-08T00:00:00.000Z')).priceCny, 20);
assert.equal(calculateEntitlement('pro', 1, new Date('2026-10-08T00:00:00.000Z')).quotaBytes, 200 * 1024 ** 3);
assert.throws(() => calculateEntitlement('basic', 0, new Date()), /months/);
```

- [ ] **Step 3: Run catalog tests and confirm the missing-module failure**

Run: `node --test test/storefront-catalog.test.js`  
Expected: FAIL because `storefront/catalog.js` does not exist.

- [ ] **Step 4: Implement the immutable package catalog and calendar-month calculation**

Use server-owned definitions:

```js
const PACKAGES = Object.freeze({
  basic: Object.freeze({ name: 'Basic', priceCny: 5, quotaGb: 60, downKbps: 5120, upKbps: 5120 }),
  premium: Object.freeze({ name: 'Premium', priceCny: 10, quotaGb: 120, downKbps: 0, upKbps: 0 }),
  pro: Object.freeze({ name: 'Pro', priceCny: 15, quotaGb: 200, downKbps: 0, upKbps: 0 }),
});
```

Accept integer months from 1 through 24, multiply price/quota, and use UTC calendar-month arithmetic for expiry.

- [ ] **Step 5: Write failing migration tests**

Open a temporary database, assert WAL mode, required tables, unique normalized email, unique `(customer_id, normalized_code_name)`, and a unique partial trial marker. Include a transaction test proving a thrown callback rolls back all writes.

- [ ] **Step 6: Run database tests and confirm failure**

Run: `node --test test/storefront-database.test.js`  
Expected: FAIL because the database module and schema are absent.

- [ ] **Step 7: Implement migration version 1 and transaction helper**

Create tables named `customers`, `verification_challenges`, `vpn_profiles`, `packages`, `orders`, `email_outbox`, `download_tokens`, `settings`, and `audit_events`. Store timestamps as ISO UTC text, booleans as constrained integers, money as integer CNY, and quota as integer bytes. Enable `foreign_keys`, `journal_mode=WAL`, `busy_timeout=5000`, and `synchronous=NORMAL`.

- [ ] **Step 8: Run focused and full tests**

Run: `node --test test/storefront-catalog.test.js test/storefront-database.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json storefront/catalog.js storefront/db test/storefront-catalog.test.js test/storefront-database.test.js
git commit -m "feat: add storefront catalog and database"
```

### Task 2: Verification Codes and Customer Authentication

**Files:**
- Create: `storefront/repositories/customers.js`
- Create: `storefront/repositories/challenges.js`
- Create: `storefront/repositories/outbox.js`
- Create: `storefront/crypto.js`
- Create: `storefront/services/verification.js`
- Create: `storefront/services/auth.js`
- Create: `test/storefront-auth.test.js`
- Create: `test/storefront-verification.test.js`

**Interfaces:**
- Consumes: migrated database from `openDatabase(file)`.
- Produces: `normalizeEmail(email)`, `requestCode({ email, purpose })`, `verifyCode({ email, purpose, code })`.
- Produces: `register({ name, email, password, verificationGrant })`, `loginWithPassword({ email, password })`, `loginWithCode({ email, verificationGrant })`, `resetPassword({ email, password, verificationGrant })`.
- Produces: `encryptJson(value, key)` and `decryptJson(envelope, key)` using AES-256-GCM for short-lived outbox secrets.

- [ ] **Step 1: Write failing verification tests**

Cover a six-digit cryptographically generated code, keyed hash storage rather than plaintext, 10-minute expiry, one-time consumption, five-attempt lockout, purpose separation, and replacement of an older unconsumed code. Inject `randomInt`, `now`, and `enqueueEmail` so tests assert behavior without sending mail.

- [ ] **Step 2: Run verification tests and confirm failure**

Run: `node --test test/storefront-verification.test.js`  
Expected: FAIL with missing verification service.

- [ ] **Step 3: Implement verification service**

Hash the normalized email, purpose, code, and `OTP_PEPPER` with HMAC-SHA256. Return an opaque verification grant after successful consumption; store only the grant hash and 15-minute expiry. Enqueue the literal code only in the email outbox payload that is encrypted with `OUTBOX_KEY`.

- [ ] **Step 4: Write failing authentication tests**

Test unique case-insensitive email registration, bcrypt password hashing, password login, code login, password recovery, unverified-grant rejection, grant-purpose rejection, and wrong-password rejection. Assert public customer objects contain only `id`, `name`, `email`, and `verifiedAt`.

- [ ] **Step 5: Run authentication tests and confirm failure**

Run: `node --test test/storefront-auth.test.js`  
Expected: FAIL with missing auth service.

- [ ] **Step 6: Implement repositories and authentication service**

Normalize email with `trim().toLowerCase()`, limit email to 254 characters, name to 80 characters, and password to 10–128 characters. Use `bcryptjs` cost 12. Consume verification grants in the same database transaction as registration, code login, or password reset.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/storefront-verification.test.js test/storefront-auth.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add storefront/repositories storefront/crypto.js storefront/services/verification.js storefront/services/auth.js test/storefront-auth.test.js test/storefront-verification.test.js
git commit -m "feat: add verified customer authentication"
```

### Task 3: Entitlement-Aware VPN Provisioning and Internal Authentication

**Files:**
- Modify: `lib/provisioning.js`
- Create: `lib/internal-auth.js`
- Modify: `app.js`
- Create: `test/internal-provisioning.test.js`
- Modify: `test/provisioning.test.js`
- Modify: `test/safety.test.js`

**Interfaces:**
- Produces: `provisioning.createCustomerProfile({ customerRef, customerName, codeName, entitlement })`.
- Produces: `provisioning.upgradeCustomerProfile({ deviceId, entitlement })` preserving `pubkey`, `privateKey`, `ip`, and `deviceId`.
- Produces: internal routes `POST /internal/v1/profiles/trial`, `POST /internal/v1/profiles/paid`, `POST /internal/v1/profiles/:deviceId/upgrade`, and `GET /internal/v1/profiles/:deviceId/status`.
- Internal requests require headers `x-storefront-timestamp`, `x-storefront-nonce`, and `x-storefront-signature`.

- [ ] **Step 1: Write failing provisioning tests**

Assert a trial peer receives `quotaBytes = 1 * 1024 ** 3`, `downKbps = 5120`, `upKbps = 5120`, and `expiresAt = null`. Assert upgrading that peer changes only entitlement fields and leaves its key, IP, device ID, and stored private key byte-for-byte unchanged.

- [ ] **Step 2: Run provisioning tests and confirm failure**

Run: `node --test test/provisioning.test.js test/internal-provisioning.test.js`  
Expected: FAIL because entitlement-aware operations and internal authentication are absent.

- [ ] **Step 3: Implement provisioning operations**

Add `customerRef` to storefront-created peers, validate entitlement as non-negative integer byte/Kbps values plus nullable ISO expiry, and apply traffic control after peer persistence. If traffic-control application fails, roll back the peer/store/config/key changes using the existing transaction pattern.

- [ ] **Step 4: Implement HMAC and replay protection**

Canonical input is `${timestamp}\n${nonce}\n${method}\n${path}\n${sha256(rawBody)}`. Reject timestamps outside 60 seconds, reused nonces, non-loopback source addresses, and signatures that fail `timingSafeEqual`. Keep nonces in a bounded five-minute in-memory cache.

- [ ] **Step 5: Implement internal routes**

Parse the raw JSON body before normal JSON middleware consumes it. Return only public identifiers and configuration content required by the storefront; never return the server private key or unrelated peers. Map duplicate `customerRef + codeName` requests to the existing profile for idempotency.

- [ ] **Step 6: Extend the safety test**

Assert all new workflows are expressible using `awg set`, store writes, and `tc` operations, with no command containing `awg-quick`, `systemctl`, `service`, `down`, `up`, or interface reload behavior.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/internal-provisioning.test.js test/provisioning.test.js test/safety.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/provisioning.js lib/internal-auth.js app.js test/internal-provisioning.test.js test/provisioning.test.js test/safety.test.js
git commit -m "feat: add safe storefront provisioning API"
```

### Task 4: Trial Orchestration and Secure Guest Tracking

**Files:**
- Create: `storefront/repositories/profiles.js`
- Create: `storefront/services/provisioning-client.js`
- Create: `storefront/services/trials.js`
- Create: `storefront/services/tracking.js`
- Create: `test/storefront-trials.test.js`
- Create: `test/storefront-tracking.test.js`

**Interfaces:**
- Consumes: `verifyCode`, customer/profile repositories, and signed internal provisioning API.
- Produces: `startTrial({ name, email, codeName, verificationGrant })`.
- Produces: `getGuestDashboard({ email, verificationGrant })` and `getCustomerDashboard(customerId)`.

- [ ] **Step 1: Write failing concurrent trial tests**

Run two simultaneous `startTrial` calls for `Buyer@Example.com` and `buyer@example.com`. Assert one succeeds, one receives `TRIAL_ALREADY_USED`, and the fake provisioning client is called exactly once. Test that a failed provisioning request rolls back the trial-consumed marker so the customer can retry.

- [ ] **Step 2: Run trial tests and confirm failure**

Run: `node --test test/storefront-trials.test.js`  
Expected: FAIL because the trial service is missing.

- [ ] **Step 3: Implement the signed provisioning client and trial transaction**

Use `http.request` to `127.0.0.1:7500`, calculate the Task 3 signature, set a five-second timeout, and never follow redirects. Reserve the trial in an immediate SQLite transaction, provision once, then bind the returned `deviceId`, `pubkey`, and `ip` to the profile.

- [ ] **Step 4: Write failing tracking tests**

Assert email-only lookup is rejected, a tracking-purpose verification grant reveals only profiles belonging to that normalized email, a registered session reveals all profiles for its customer, and usage returns `quotaBytes`, `usedBytes`, `remainingBytes`, `expiresAt`, `downKbps`, `upKbps`, and status without keys.

- [ ] **Step 5: Implement tracking service**

Merge storefront profile metadata with the safe status returned by the internal API. Clamp remaining bytes to zero and translate internal failures into `STATUS_TEMPORARILY_UNAVAILABLE` without exposing network or filesystem details.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test test/storefront-trials.test.js test/storefront-tracking.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add storefront/repositories/profiles.js storefront/services/provisioning-client.js storefront/services/trials.js storefront/services/tracking.js test/storefront-trials.test.js test/storefront-tracking.test.js
git commit -m "feat: add automatic trials and secure tracking"
```

### Task 5: Payment Proofs and Paid Orders

**Files:**
- Create: `storefront/repositories/orders.js`
- Create: `storefront/repositories/settings.js`
- Create: `storefront/services/orders.js`
- Create: `storefront/middleware/uploads.js`
- Create: `test/storefront-orders.test.js`
- Create: `test/storefront-uploads.test.js`

**Interfaces:**
- Produces: `submitOrder({ customerId, guestGrant, profileId, planId, months, paymentMethod, proof })`.
- Produces: `rejectOrder({ orderId, adminRef, reason })`; paid approval is added in Task 6.
- Produces: `storeQrImage(method, file)` and `getActiveQr(method)` for `wechat` and `alipay`.

- [ ] **Step 1: Write failing upload tests**

Use real PNG, JPEG, and WebP fixture headers. Assert images up to 5 MiB are accepted, decoded type must match, SVG/PDF/text/polyglot input is rejected, filenames are random UUIDs, and storage remains outside the static directory.

- [ ] **Step 2: Run upload tests and confirm failure**

Run: `node --test test/storefront-uploads.test.js`  
Expected: FAIL because upload validation is absent.

- [ ] **Step 3: Implement memory upload validation and atomic private storage**

Configure Multer memory storage with one file and 5 MiB limit. Validate PNG signature, JPEG SOI/EOI, or WebP RIFF/WEBP bytes. Write mode `0600` to a temporary file in the destination directory, then rename atomically.

- [ ] **Step 4: Write failing order tests**

Assert missing proof rejection, invalid payment method rejection, guest ownership, registered multi-profile ownership, server-side recalculation that ignores browser totals, immutable package snapshot, pending initial state, one active pending order per profile, optional rejection reason, and no provisioning on rejection.

- [ ] **Step 5: Run order tests and confirm failure**

Run: `node --test test/storefront-orders.test.js`  
Expected: FAIL because order service and repositories are missing.

- [ ] **Step 6: Implement order submission and review state machine**

Allow transitions `pending -> provisioning -> approved` or `pending -> rejected`; allow `provisioning -> provisioning_failed`; disallow all other transitions. Store the proof before the database insert and remove only that new file if the insert fails. Calculate entitlement using Task 1 and record all values in the order snapshot.

- [ ] **Step 7: Implement QR settings storage**

Accept only validated images. Replacing a QR image updates the database transaction first, then removes the superseded file after commit. If no QR exists, customer checkout marks that payment method unavailable.

- [ ] **Step 8: Run focused and full tests**

Run: `node --test test/storefront-uploads.test.js test/storefront-orders.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add storefront/repositories/orders.js storefront/repositories/settings.js storefront/services/orders.js storefront/middleware/uploads.js test/storefront-orders.test.js test/storefront-uploads.test.js
git commit -m "feat: add private payment proof orders"
```

### Task 6: Approval, In-Place Upgrade, and Idempotent Retry

**Files:**
- Modify: `storefront/services/orders.js`
- Modify: `storefront/repositories/orders.js`
- Create: `test/storefront-approval.test.js`

**Interfaces:**
- Produces: `approveOrder({ orderId, adminRef })` returning `{ order, profile, provisioningState, deliveryState }`.
- Produces: `retryProvisioning({ orderId, adminRef })` without duplicating entitlement.

- [ ] **Step 1: Write failing approval tests**

Assert a trial order calls `upgradeCustomerProfile` with the existing device ID, a new paid profile calls `createCustomerProfile`, repeated approval does not call provisioning twice, provisioning failure records `provisioning_failed`, rejection never calls provisioning, and retry resumes only the failed provisioning step.

- [ ] **Step 2: Run approval tests and confirm failure**

Run: `node --test test/storefront-approval.test.js`  
Expected: FAIL because approval orchestration is absent.

- [ ] **Step 3: Implement compare-and-set approval claiming**

Claim with `UPDATE orders SET state='provisioning' WHERE id=? AND state IN ('pending','provisioning_failed')`. Require exactly one changed row before calling the internal service. Store an idempotency key `order:<id>:approval` and the returned profile identity.

- [ ] **Step 4: Implement trial upgrade and new-profile branches**

For a profile with an existing `device_id`, call the upgrade endpoint. For a profile without one, call paid creation. Store the authoritative entitlement on both profile and order after the internal response succeeds.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/storefront-approval.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add storefront/services/orders.js storefront/repositories/orders.js test/storefront-approval.test.js
git commit -m "feat: add idempotent paid VPN approval"
```

### Task 7: Branded Gmail Email, Outbox, and Secure Downloads

**Files:**
- Create: `storefront/email/templates.js`
- Create: `storefront/services/email.js`
- Create: `storefront/services/downloads.js`
- Create: `storefront/repositories/download-tokens.js`
- Modify: `storefront/repositories/outbox.js`
- Modify: `storefront/services/orders.js`
- Modify: `storefront/services/trials.js`
- Create: `test/storefront-email.test.js`
- Create: `test/storefront-downloads.test.js`

**Interfaces:**
- Produces template renderers `verificationEmail`, `orderReceivedEmail`, `trialActivatedEmail`, `orderApprovedEmail`, `orderRejectedEmail`, and `passwordRecoveryEmail` returning `{ subject, html, text }`.
- Produces: `createDownloadToken({ profileId, configCiphertext })`, `redeemDownloadToken(rawToken)`.
- Produces: `processOutboxBatch({ limit: 20 })`.

- [ ] **Step 1: Write failing email rendering tests**

Assert Bright Pocket brand colors, escaped customer/code-name content, exact plan/quota/speed/expiry facts, plain-text alternative, verification code display, rejection reason display, and approval attachment metadata `{ filename: 'user22-d1.conf', contentType: 'text/plain' }`.

- [ ] **Step 2: Run email tests and confirm failure**

Run: `node --test test/storefront-email.test.js`  
Expected: FAIL because templates and sender are missing.

- [ ] **Step 3: Implement templates and Nodemailer transport**

Use Gmail SMTP host `smtp.gmail.com`, port 465, `secure: true`, sender `nayem3622@gmail.com`, and an injected transport in tests. Escape all dynamic HTML. Never log message bodies, codes, config content, or SMTP credentials.

- [ ] **Step 4: Write failing download token tests**

Assert a 32-byte random token, SHA-256 hash storage, encrypted configuration payload, 24-hour expiry, one successful redemption, rejection on reuse, rejection after expiry, and portable `.conf` filename.

- [ ] **Step 5: Implement encrypted single-use downloads**

Encrypt configuration content with AES-256-GCM using `DOWNLOAD_KEY`; store IV, tag, ciphertext, token hash, expiry, and nullable consumption time. Claim the token with a transaction before decrypting and return `Cache-Control: no-store`.

- [ ] **Step 6: Implement outbox retry semantics**

Claim queued rows atomically, mark success separately from VPN provisioning, and retry temporary failures with delays of 1, 5, 20, and 60 minutes. After five failures mark `failed` for admin retry. Approval retries enqueue email only when no successful approval delivery exists.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/storefront-email.test.js test/storefront-downloads.test.js && npm test`  
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add storefront/email storefront/services/email.js storefront/services/downloads.js storefront/repositories/download-tokens.js storefront/repositories/outbox.js storefront/services/orders.js storefront/services/trials.js test/storefront-email.test.js test/storefront-downloads.test.js
git commit -m "feat: add branded VPN email delivery"
```

### Task 8: Public APIs, Sessions, CSRF, and Rate Limits

**Files:**
- Create: `storefront/config.js`
- Create: `storefront/app.js`
- Create: `storefront/server.js`
- Create: `storefront/middleware/auth.js`
- Create: `storefront/middleware/csrf.js`
- Create: `storefront/middleware/errors.js`
- Create: `test/storefront-api.test.js`
- Create: `test/storefront-security.test.js`

**Interfaces:**
- Public endpoints: catalog, QR retrieval, verification-code request/verify, registration, password/code login, password recovery, trial start, order submit, secure download.
- Customer endpoints: session, dashboard, code-name creation, order list.
- All JSON errors use `{ error: { code, message } }` and never include stacks or secrets.

- [ ] **Step 1: Write failing API contract tests**

Test complete guest trial, registration, both login methods, password recovery, guest tracking grant, registered dashboard, order multipart upload, unauthenticated denial, CSRF denial, and normalized safe errors. Use real HTTP servers with temporary SQLite and injected services.

- [ ] **Step 2: Run API tests and confirm failure**

Run: `node --test test/storefront-api.test.js test/storefront-security.test.js`  
Expected: FAIL because the storefront app is absent.

- [ ] **Step 3: Implement configuration validation and Express composition**

Require `STOREFRONT_SESSION_SECRET`, `OTP_PEPPER`, `OUTBOX_KEY`, `DOWNLOAD_KEY`, `INTERNAL_SHARED_SECRET`, `GMAIL_APP_PASSWORD`, database path, and private storage path in production. Permit explicit injected fakes during tests. Bind only to `127.0.0.1:7600`.

- [ ] **Step 4: Implement separate customer sessions and CSRF**

Use cookie name `vpn_customer_sid`, `httpOnly`, `secure` in production, `sameSite=lax`, and 30-day maximum age. Store sessions in SQLite. Issue a random CSRF token in the session and require `x-csrf-token` on every state-changing authenticated request.

- [ ] **Step 5: Add security headers and rate limits**

Apply Helmet with a restrictive Content Security Policy. Rate-limit code requests per normalized email and source address, code verification attempts, login attempts, trial creation, and uploads. Trust exactly one Nginx proxy hop.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test test/storefront-api.test.js test/storefront-security.test.js && npm test && npm audit`  
Expected: all tests PASS and audit reports no known vulnerabilities.

- [ ] **Step 7: Commit**

```bash
git add storefront/config.js storefront/app.js storefront/server.js storefront/middleware test/storefront-api.test.js test/storefront-security.test.js
git commit -m "feat: expose secure storefront APIs"
```

### Task 9: Bright Pocket Storefront, Authentication, and Checkout UI

**Files:**
- Create: `storefront/public/index.html`
- Create: `storefront/public/styles.css`
- Create: `storefront/public/app.js`
- Create: `storefront/public/auth.html`
- Create: `storefront/public/auth.js`
- Create: `storefront/public/checkout.html`
- Create: `storefront/public/checkout.js`
- Create: `test/storefront-browser-model.test.js`

**Interfaces:**
- Consumes Task 8 JSON and multipart APIs.
- Produces responsive public experience for packages, trial, account auth, QR payment, proof upload, and submission confirmation.

- [ ] **Step 1: Write failing browser-model tests**

Extract pure functions and test month summary calculation from server responses, quota/speed copy, guest versus registered code-name rules, QR-method availability, proof-required submit state, safe error mapping, and local date formatting.

- [ ] **Step 2: Run browser tests and confirm failure**

Run: `node --test test/storefront-browser-model.test.js`  
Expected: FAIL because the browser model is missing.

- [ ] **Step 3: Build the approved storefront pages**

Use semantic HTML, labels, visible focus, 44px touch targets, cream/yellow/purple tokens, no gradients, and no external runtime font dependency. The landing page must show exact package facts, one-time trial rules, and approval expectations. Checkout must disable unavailable QR methods and refuse submit until proof preview is present.

- [ ] **Step 4: Implement accessible dialogs and status states**

Provide loading, success, validation, server error, email-sent, code-expired, proof-too-large, and payment-method-unavailable states. Preserve entered non-sensitive fields after recoverable errors and clear verification codes/passwords after submission.

- [ ] **Step 5: Run tests and mechanical checks**

Run:

```bash
node --test test/storefront-browser-model.test.js
node --check storefront/public/app.js
node --check storefront/public/auth.js
node --check storefront/public/checkout.js
npm test
```

Expected: all checks PASS.

- [ ] **Step 6: Inspect responsive layouts once**

Render and inspect 1440×900, 820×1180, 390×844, and 320×700. Verify no horizontal overflow, complete package facts, readable QR instructions, keyboard order matching visual order, and proof upload usability. Fix findings in one batch and perform one confirmation pass.

- [ ] **Step 7: Commit**

```bash
git add storefront/public test/storefront-browser-model.test.js
git commit -m "feat: build Bright Pocket VPN storefront"
```

### Task 10: Customer Dashboard and Guest Tracking UI

**Files:**
- Create: `storefront/public/dashboard.html`
- Create: `storefront/public/dashboard.js`
- Create: `storefront/public/track.html`
- Create: `storefront/public/track.js`
- Modify: `storefront/public/styles.css`
- Modify: `test/storefront-browser-model.test.js`

**Interfaces:**
- Consumes: `getGuestDashboard` and `getCustomerDashboard` APIs.
- Produces: secure code-verification tracking and signed-in multi-profile dashboard.

- [ ] **Step 1: Add failing dashboard view-model tests**

Assert remaining quota percentage, exhausted state, no-expiry trial copy, calendar expiry copy, speed labels, pending/approved/rejected order labels, multi-code-name ordering, and renewal/upgrade action choice.

- [ ] **Step 2: Run browser tests and confirm failure**

Run: `node --test test/storefront-browser-model.test.js`  
Expected: FAIL on the new dashboard expectations.

- [ ] **Step 3: Implement guest tracking and account dashboard**

Guest tracking always starts with email plus six-digit code. Registered dashboard loads from session and lists all code names. Display used, remaining, and total bytes numerically; do not use a ring chart. Show download only when a valid delivery token is available.

- [ ] **Step 4: Verify responsive and accessibility states**

Check real content with zero, one, and ten code names at desktop and phone sizes. Verify expired, exhausted, pending, rejected, and temporarily unavailable states remain understandable without color alone.

- [ ] **Step 5: Run full tests and commit**

Run: `npm test && node --check storefront/public/dashboard.js && node --check storefront/public/track.js`  
Expected: all checks PASS.

```bash
git add storefront/public/dashboard.html storefront/public/dashboard.js storefront/public/track.html storefront/public/track.js storefront/public/styles.css test/storefront-browser-model.test.js
git commit -m "feat: add customer VPN usage dashboards"
```

### Task 11: Admin Route Migration, Orders, Proof Review, and QR Settings

**Files:**
- Modify: `app.js`
- Modify: `server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Create: `lib/storefront-admin-client.js`
- Modify: `storefront/app.js`
- Create: `storefront/middleware/internal-admin.js`
- Create: `test/admin-orders.test.js`
- Modify: `test/api.test.js`

**Interfaces:**
- Admin UI and APIs live under `/admin` and `/admin/api`.
- Admin process calls private storefront admin endpoints over localhost using HMAC.
- Produces order queue, proof stream, approve/reject/retry, customer lookup, and QR replacement controls.

- [ ] **Step 1: Write failing admin route and order tests**

Assert `/admin` serves the current panel, old `/` no longer serves admin, existing controls use `/admin/api`, unauthenticated order/proof access is denied, proof responses use `Content-Disposition: inline` and `Cache-Control: no-store`, approval/rejection payloads are exact, and QR replacement accepts validated images only.

- [ ] **Step 2: Run admin tests and confirm failure**

Run: `node --test test/api.test.js test/admin-orders.test.js`  
Expected: FAIL because admin mounting and storefront admin client are absent.

- [ ] **Step 3: Mount existing admin UI without redesign**

Serve static assets at `/admin/assets`, redirect `/admin` to `/admin/`, move existing endpoints to `/admin/api`, and update client URLs. Preserve all current visuals and behavior except the added navigation and views.

- [ ] **Step 4: Implement signed admin client and order actions**

Expose storefront admin endpoints only on localhost with the same HMAC scheme. Add admin tabs for Pending, Approved, Rejected, Customers, and Payment QR. Show the calculated amount, plan, months, code name, proof, submission time, and customer email before approval.

- [ ] **Step 5: Implement confirmation and retry behavior**

Approval confirmation names the exact order, email, code name, amount, and entitlement. Rejection supports an optional reason. Provisioning retry and email retry are separate controls and never repeat a successful step.

- [ ] **Step 6: Run tests and responsive checks**

Run: `node --test test/api.test.js test/admin-orders.test.js && npm test && node --check public/app.js`  
Expected: all checks PASS. Inspect existing peer view plus new order view at desktop, tablet, and phone sizes.

- [ ] **Step 7: Commit**

```bash
git add app.js server.js public lib/storefront-admin-client.js storefront/app.js storefront/middleware/internal-admin.js test/api.test.js test/admin-orders.test.js
git commit -m "feat: add private storefront order administration"
```

### Task 12: End-to-End Tests, Operations, and Zero-Interruption Deployment

**Files:**
- Create: `test/storefront-integration.test.js`
- Create: `ecosystem.config.example.js`
- Create: `deploy/nginx-vpn.conf`
- Create: `scripts/backup-storefront.sh`
- Modify: `README.md`

**Interfaces:**
- Verifies all prior interfaces together.
- Produces reproducible PM2/Nginx configuration and backup/rollback documentation.

- [ ] **Step 1: Complete end-to-end integration tests**

Use temporary SQLite, filesystem storage, fake email transport, and fake signed provisioning server. Cover:

```text
verify email -> automatic trial -> email attachment/link -> guest tracking
register -> password login -> add paid code name -> submit proof -> approve -> delivery
trial -> submit paid proof -> approve -> same device/key remains active
submit -> reject with reason -> no provisioning
approve -> email failure -> email-only retry
duplicate approve -> no duplicate peer, quota, expiry, or email
```

- [ ] **Step 2: Run all verification**

Run:

```bash
npm test
npm audit
node --check server.js
node --check storefront/server.js
git diff --check
```

Expected: zero test failures, zero known vulnerabilities, all syntax checks pass, and no whitespace errors.

- [ ] **Step 3: Create deployment configuration**

Define PM2 processes `vpn-admin` on 7500 and `vpn-storefront` on 7600. The example contains environment variable names only. Nginx routes `/admin/` and `/admin/api/` to 7500, all storefront routes to 7600, and returns 404 for `/internal/` from public traffic.

- [ ] **Step 4: Document secure prerequisites**

Document generation of 32-byte secrets, Gmail app-password setup, private directory ownership, first admin upload of WeChat/Alipay QR images, database backup, email delivery test, and explicit prohibition on committing secrets or QR assets.

- [ ] **Step 5: Commit implementation documentation**

```bash
git add test/storefront-integration.test.js ecosystem.config.example.js deploy/nginx-vpn.conf scripts/backup-storefront.sh README.md
git commit -m "docs: add storefront deployment and recovery"
```

- [ ] **Step 6: Push only after a final branch review**

Run: `git log --oneline --decorate -15 && git status --short --branch`  
Expected: clean branch with the complete task commit sequence. Push `main` only after review confirms the planned scope.

- [ ] **Step 7: Capture live baseline and backups**

On the server, record PM2 state, public HTTPS status, `awg0` flags, peer count, and checksum of `/etc/amnezia/amneziawg/awg0.conf`. Back up `/opt/vpn-admin`, `data/`, `storefront-data/` if present, Nginx config, and `awg0.conf` into a timestamped `/opt/backups/vpn-admin-before-storefront-*` directory.

- [ ] **Step 8: Stage the storefront without switching traffic**

Sync source while excluding `.git`, `.worktrees`, `.superpowers`, `node_modules`, `data`, storefront private data, production ecosystem configuration, and secrets. Install locked dependencies, run migrations against the production storefront database, run all tests on the server, start `vpn-storefront` on localhost, and verify it directly on port 7600.

- [ ] **Step 9: Obtain activation-only assets securely**

Before enabling customer email and checkout, obtain the Gmail app password, WeChat Pay QR image, and Alipay QR image through a secure user-controlled method. Store the secret in the production process environment and upload QR images through the authenticated admin settings. Never print or return the Gmail app password in logs or chat.

- [ ] **Step 10: Switch Nginx and verify live behavior**

Validate Nginx configuration, reload Nginx only, then reload the two PM2 web processes. Do not restart or reload AmneziaWG. Verify public storefront 200, `/admin` authentication, internal-path denial, email code delivery, QR rendering, private proof authorization, and one controlled trial using an unused test email approved by the operator.

- [ ] **Step 11: Prove VPN preservation**

Recheck `awg0` flags, pre-existing peer presence, peer count adjusted only by the controlled trial, and configuration diff containing only that intentional new peer. Confirm all pre-existing peers still handshake normally. If any unrelated VPN state changed, restore web routing/application state and investigate without restarting the interface.

- [ ] **Step 12: Report deployment evidence**

Report commit, test counts, backup path, storefront/admin URLs, email test status, QR status, trial result, peer preservation evidence, and any activation item still awaiting the user.
