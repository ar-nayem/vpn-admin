# VPN Storefront, Customer Portal, and Order Approval Design

Date: 2026-10-08  
Status: Approved

## Purpose

Add a public VPN storefront and customer portal to the existing VPN admin
system without exposing the privileged VPN controls or interrupting the live
AmneziaWG interface. Customers can start one automatic free trial, purchase
monthly packages using WeChat Pay or Alipay payment QR codes, submit payment
proof, track remaining quota, and receive a ready-to-import `.conf` file.

The public storefront is served at `https://vpn.arnayem.top/`. The existing
administrator interface moves to `https://vpn.arnayem.top/admin`.

## Product Rules

### Packages

| Package | Monthly price | Monthly data | Download | Upload |
| --- | ---: | ---: | ---: | ---: |
| Basic | ¥5 | 60 GB | 5 Mbps | 5 Mbps |
| Premium | ¥10 | 120 GB | Unlimited | Unlimited |
| Pro | ¥15 | 200 GB | Unlimited | Unlimited |

For an order of `n` months:

- price is monthly price multiplied by `n`;
- total data is monthly data multiplied by `n`;
- expiry is the activation time plus `n` calendar months;
- the package speed remains unchanged;
- data is one total allowance for the full purchased term and does not reset
  monthly.

The server calculates price, quota, speed, and expiry from the selected package
and month count. It never trusts totals submitted by the browser.

### Free trial

- A verified email address can receive exactly one trial.
- The trial creates one code name and one VPN configuration for one device.
- The trial includes 1 GB total data and 5 Mbps upload/download.
- The trial has no time expiry and ends when its 1 GB quota is exhausted.
- Trial creation is automatic after six-digit email verification and does not
  require administrator approval.
- A registered account cannot obtain extra trials by creating additional code
  names.
- A paid approval upgrades the same trial VPN profile when the order targets
  that code name, so the customer does not need to import a new configuration.

### Customer identity and code names

- Email address is the unique customer identity.
- A guest can own one code name and VPN profile.
- A registered customer can own multiple code names.
- Each code name represents exactly one device, VPN peer, quota, speed limit,
  expiry, and configuration file.
- Code names must be unique within a customer account and are normalized and
  validated on the server.

## Customer Experience

### Public storefront

The storefront uses the approved **Bright Pocket** direction: a warm cream
base, energetic yellow feature surfaces, vivid purple actions, and clear,
friendly typography. It is mobile-first, responsive, colorful, and distinct
from the private admin interface while remaining professional.

The page contains:

- a concise value proposition;
- a prominent **Start free** action;
- Basic, Premium, and Pro package cards;
- a month selector that immediately shows the server-derived price and total
  data;
- separate WeChat Pay and Alipay QR choices;
- sign-in, registration, and guest package tracking entry points;
- clear steps explaining payment proof and administrator approval.

### Guest flow

1. Enter name and email.
2. Receive and verify a six-digit email code.
3. Choose a unique code name for the single device.
4. Either start the one-time free trial or choose a paid package.
5. For a paid package, choose months and payment method, scan the displayed QR
   code, upload the payment screenshot, and submit the request.
6. Use six-digit email verification whenever returning to view the code name,
   remaining quota, usage, expiry, speed, and order status.

Entering an email address alone never reveals customer or VPN data.

### Registered account flow

- Registration requires name, email verification, and password creation.
- Customers can sign in with either password or a six-digit email code.
- Password recovery requires a six-digit email code.
- The dashboard lists every code name with status, package, remaining quota,
  expiry, speed, order state, and configuration download availability.
- Customers can add additional paid code names but receive no additional free
  trial.

### Paid purchase flow

1. Customer selects code name, package, months, and WeChat Pay or Alipay.
2. The server returns the authoritative price, quota, speed, and purchase term.
3. Customer uploads an image of the payment proof.
4. The request cannot be submitted without the proof image.
5. The customer and administrator receive branded submission notifications.
6. The order remains pending until the administrator approves or rejects it.

## Administrator Experience

The existing admin panel remains visually intact and gains navigation for:

- pending, approved, and rejected orders;
- customer and code-name lookup;
- payment proof review;
- package, quota, speed, expiry, and calculated amount review;
- approval and rejection with an optional rejection reason;
- delivery state and retry controls;
- WeChat Pay and Alipay QR image replacement.

Approval performs the following operation:

1. Lock the order against duplicate approval.
2. Recalculate its package entitlements from the stored package snapshot.
3. Upgrade the selected trial peer or create a new peer.
4. Apply total quota, speed, and expiry without restarting AmneziaWG.
5. Generate an expiring, single-use configuration download token.
6. Send a branded approval email with the `.conf` attachment and secure link.
7. Mark provisioning and delivery results separately for safe retry.

Rejection records the administrator, time, and optional reason, then sends a
branded rejection email. Rejection never creates, changes, or removes a VPN
peer.

## Architecture

### Process separation

The repository contains two runtime processes behind Nginx:

1. **Public storefront process** — runs as an unprivileged user and owns public
   pages, customer sessions, email verification, accounts, orders, private
   payment uploads, customer tracking, and notification delivery.
2. **VPN admin process** — remains bound to localhost and owns administrator
   authentication, privileged provisioning, live peer controls, and the
   internal provisioning endpoint.

Nginx routes `/admin` and existing authenticated admin APIs to the VPN admin
process. Public storefront and customer APIs route to the unprivileged public
process. The public process can request only narrowly defined trial and paid
provisioning actions over localhost using a rotating shared credential. It
cannot execute commands or supply arbitrary VPN configuration.

### Storage

Use SQLite in WAL mode for storefront state and transactional constraints. The
database is outside the public directory and uses restrictive filesystem
permissions. It is included in the server backup procedure.

Core records:

- `customers`: unique normalized email, display name, verification state,
  optional password hash, and trial-consumed timestamp;
- `verification_challenges`: purpose, hashed six-digit code, expiry, attempt
  count, consumption time, and request metadata;
- `vpn_profiles`: customer, code name, device identity, mapped VPN peer, state,
  current entitlement, and configuration delivery state;
- `packages`: Basic, Premium, and Pro definitions with versioning;
- `orders`: immutable package snapshot, months, calculated amount and quota,
  payment method, private proof path, state, review fields, and provisioning
  fields;
- `email_outbox`: template, recipient, payload reference, attempts, last error,
  and delivery time;
- `settings`: active WeChat Pay and Alipay QR asset references;
- `audit_events`: customer and administrator security-sensitive actions.

Payment screenshots and QR images are stored outside the web root. Database
rows reference generated filenames rather than user-provided paths.

### VPN integration

The existing transactional provisioning layer remains the sole owner of live
AmneziaWG mutations. It gains narrowly scoped operations to:

- create a one-device trial peer with fixed trial entitlement;
- create a paid peer from server-calculated entitlement;
- upgrade an existing trial peer in place;
- read a customer-safe usage snapshot;
- retrieve configuration content only for controlled delivery.

All mutations continue to use targeted `awg set` operations and persistent
configuration updates. They never run `awg-quick`, reload the interface, or
restart the VPN service.

## Authentication and Security

- Passwords use an adaptive password hash.
- Verification codes are cryptographically random, stored as keyed hashes,
  valid for 10 minutes, single-use, and attempt-limited.
- Code sending and verification are rate-limited by email and source address.
- Customer sessions and admin sessions use separate cookie names and scopes.
- State-changing browser requests require CSRF protection.
- Uploads accept decoded PNG, JPEG, or WebP images only, enforce a small size
  limit, randomize filenames, and are never served directly.
- Payment proof retrieval requires an authenticated administrator endpoint.
- The one-trial-per-email rule is enforced by a database uniqueness constraint
  inside the same transaction that creates the trial request.
- Configuration links use high-entropy token hashes, expire after 24 hours,
  and are single-use. The attached `.conf` file remains available in the
  approval email as explicitly requested.
- Customer-facing APIs never expose private keys, payment proof paths, password
  hashes, code hashes, or internal provisioning credentials.
- Gmail SMTP credentials, session secrets, token keys, and internal service
  credentials are supplied through protected environment variables.

## Email Delivery

Branded responsive HTML emails are sent from `nayem3622@gmail.com` using Gmail
SMTP with an app password. Plain-text alternatives are included.

Templates cover:

- six-digit email verification;
- order received;
- order approved with `.conf` attachment and secure link;
- order rejected with optional reason;
- free trial activated;
- password recovery;
- delivery retry or administrator-visible failure notification.

Email sending uses an outbox so temporary Gmail failures do not roll back an
already successful VPN operation. The admin panel shows delivery state and can
retry failed messages without reprovisioning the VPN.

## Failure Handling and Idempotency

- Trial creation, order submission, approval, rejection, and token redemption
  use idempotency guards.
- Repeated approval requests cannot create duplicate peers or extend quota
  twice.
- Provisioning success and email success are stored independently.
- A failed provisioning attempt leaves the order pending with an explicit
  admin-visible error and does not send an approval message.
- A successful provisioning operation followed by email failure leaves the
  order approved and queues only email retry.
- Expired or quota-exhausted profiles remain visible to the customer with a
  clear renewal action.

## Deployment and Operations

- Take backups of the application, storefront database, private uploads,
  private keys, and AmneziaWG configuration before deployment.
- Create the unprivileged storefront service and private data directories.
- Apply database migrations transactionally before switching Nginx routes.
- Preserve the current admin process and live `awg0` interface throughout.
- Verify peer count, interface state, and configuration checksum before and
  after deployment.
- Rollback restores application routing and storefront state without touching
  active VPN peers created before the deployment.

Production activation requires the administrator to provide through a secure
channel:

- the Gmail app password for `nayem3622@gmail.com`;
- the final WeChat Pay QR image;
- the final Alipay QR image.

These values and assets are never committed to Git.

## Testing and Acceptance

Automated tests must cover:

- exact package calculations for multiple month counts;
- one trial per normalized email under concurrent requests;
- guest tracking denial before six-digit verification;
- registration, password login, code login, and password recovery;
- upload validation and private proof authorization;
- order submission, approval, rejection, retry, and idempotency;
- in-place trial upgrade preserving the peer key and configuration identity;
- `.conf` attachment and single-use link delivery;
- quota exhaustion, speed limits, and expiry calculations;
- public/admin route separation and authorization;
- proof that provisioning workflows do not restart or reload AmneziaWG.

Browser verification covers the Bright Pocket storefront, checkout, account
dashboard, guest tracking, and admin order review on phone, tablet, and desktop.

The system is accepted when:

- a verified new email can automatically receive exactly one working 1 GB
  trial;
- a guest can securely view only their own remaining quota after code
  verification;
- a registered customer can manage multiple code names under one email;
- a paid request cannot be submitted without a valid proof image;
- an administrator can approve a request and the customer receives both the
  attachment and secure link;
- a trial upgrade keeps the existing VPN configuration working;
- rejecting an order changes no VPN state;
- the live VPN interface and existing peers remain uninterrupted throughout
  deployment.
