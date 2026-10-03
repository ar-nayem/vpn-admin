# User and Device Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe numbered-user and per-device provisioning so the existing 21 peers remain unchanged and the next account is User 22.

**Architecture:** Extend peer records with optional user/device metadata while projecting legacy records non-destructively at read time. Put account numbering, IP allocation, key generation, live peer mutation, atomic persistence, and rollback in focused modules with injected adapters so tests never call the real VPN interface. Keep existing peer routes compatible and add grouped user APIs and UI.

**Tech Stack:** Node.js CommonJS, Express 4, Node built-in `node:test`, filesystem-backed JSON, AmneziaWG CLI adapter, vanilla HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-03-user-device-management-design.md`

## Global Constraints

- Existing Users 1–21, keys, IPs, configurations, limits, and enabled state must remain unchanged.
- The first new account must be User 22 and account numbers must never be reused.
- Every device must have a distinct key pair, client IP, and configuration.
- Production may use targeted `awg set awg0 peer ...` changes only; never restart or reload `awg0` or execute `awg-quick`.
- Automated tests must use temporary data and injected fake adapters; they must never execute a real VPN command.
- Revocation must retain archived metadata and must not expose archived private keys for download.
- Live deployment is out of scope.

---

### Task 1: Legacy-compatible user/device model

**Files:**
- Create: `lib/user-model.js`
- Create: `test/user-model.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `projectPeer(peer, index)`, `projectPeers(peers)`, `nextUserNumber(peers)`, `groupUsers(peers)`, and `allocateIp(peers, prefix)`.
- The projection returns metadata for display without mutating the source peer object.

- [ ] **Step 1: Add the built-in test command and write failing model tests**

Add `"test": "node --test"` to `package.json`. Create tests using literal fixtures that prove:

```js
test('21 legacy peers project to Users 1-21 without mutation', () => {
  const peers = Array.from({ length: 21 }, (_, i) => ({
    name: `Peer ${i + 1}`,
    pubkey: `key-${i + 1}`,
    ip: `10.66.67.${i + 2}`,
    enabled: true,
  }));
  const before = JSON.stringify(peers);
  const projected = projectPeers(peers);
  assert.equal(projected[0].userNumber, 1);
  assert.equal(projected[20].userNumber, 21);
  assert.equal(projected[0].deviceName, 'Existing device');
  assert.equal(JSON.stringify(peers), before);
});

test('next account after 21 legacy peers is User 22', () => {
  const peers = Array.from({ length: 21 }, (_, i) => ({ pubkey: `k${i}`, ip: `10.66.67.${i + 2}` }));
  assert.equal(nextUserNumber(peers), 22);
});

test('archived account numbers are never reused', () => {
  const peers = [{ userNumber: 22, archivedAt: '2026-10-03T00:00:00.000Z' }];
  assert.equal(nextUserNumber(peers), 23);
});

test('IP allocation skips addresses already in use', () => {
  const peers = [{ ip: '10.66.67.2' }, { ip: '10.66.67.4' }];
  assert.equal(allocateIp(peers, '10.66.67'), '10.66.67.3');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- test/user-model.test.js`

Expected: FAIL because `lib/user-model.js` does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Implement non-mutating projection, grouping by `userNumber`, monotonic maximum-number allocation, and first-free host allocation in `.2` through `.254`. Explicit metadata always wins over legacy projection.

- [ ] **Step 4: Run the focused and full test suites**

Run: `npm test -- test/user-model.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json lib/user-model.js test/user-model.test.js
git commit -m "feat: add legacy-compatible user model"
```

### Task 2: Atomic stores and an injectable AmneziaWG adapter

**Files:**
- Modify: `lib/store.js`
- Modify: `lib/keys.js`
- Modify: `lib/awg.js`
- Create: `test/storage.test.js`
- Create: `test/awg-adapter.test.js`

**Interfaces:**
- `store.createStore(filePath)` returns `{ load(), save(peers) }`; existing top-level `load` and `save` remain compatible.
- `keys.createKeyStore(filePath)` returns `{ load(), getPrivateKey(pubkey), setPrivateKey(pubkey, privateKey), deletePrivateKey(pubkey), replace(allKeys) }`.
- `awg.createAdapter({ execFileSync, fs, iface })` returns the existing methods plus `generateKeyPair()`.

- [ ] **Step 1: Write failing atomic-storage tests**

Use `fs.mkdtempSync` and assert that saves produce parseable JSON, replace the previous complete value, preserve `0600` permissions for private keys, and leave no temporary file after success. Assert `deletePrivateKey` removes only the selected key.

- [ ] **Step 2: Verify storage tests RED**

Run: `npm test -- test/storage.test.js`

Expected: FAIL because factory and replacement interfaces are absent.

- [ ] **Step 3: Implement atomic JSON replacement**

Write JSON to a sibling uniquely named temporary file, set the requested mode, then rename it over the destination. Preserve the current default data paths and exports so existing callers continue to work.

- [ ] **Step 4: Write failing adapter tests**

Inject a recording `execFileSync` fake and assert that:

```js
assert.deepEqual(callsForAdd, [[
  'awg', ['set', 'awg0', 'peer', 'public-key', 'allowed-ips', '10.66.67.23/32'],
]]);
assert.equal(allRecordedArgs.flat(2).includes('awg-quick'), false);
```

Test that `generateKeyPair()` obtains a private key with `awg genkey`, passes that key on stdin to `awg pubkey`, and returns both values.

- [ ] **Step 5: Verify adapter tests RED**

Run: `npm test -- test/awg-adapter.test.js`

Expected: FAIL because `createAdapter` and `generateKeyPair` are absent.

- [ ] **Step 6: Implement the adapter without shell interpolation**

Use `execFileSync(command, args, options)` for key generation and peer mutation so public keys and IPs are arguments rather than shell source. Keep dump/config reading compatible. Do not add any restart or reload method.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`

```bash
git add lib/store.js lib/keys.js lib/awg.js test/storage.test.js test/awg-adapter.test.js
git commit -m "refactor: isolate safe VPN and storage adapters"
```

### Task 3: Transactional provisioning service

**Files:**
- Create: `lib/provisioning.js`
- Create: `test/provisioning.test.js`

**Interfaces:**
- `createProvisioningService({ peerStore, keyStore, awg, now, randomUUID, clientPrefix, confPath })`.
- Produces async-safe synchronous operations `createUser(input)`, `addDevice(userNumber, input)`, `archiveDevice(deviceId)`, and `archiveUser(userNumber)`.
- Returns public metadata only; never returns private keys except through the existing authenticated configuration-download path.

- [ ] **Step 1: Write the failing User 22 creation test**

Use 21 literal legacy fixtures and fakes with deterministic keys/UUIDs. Assert `createUser({ userName: 'Alice', devices: ['iPhone', 'Laptop'] })` returns user number 22, creates two records with different keys, IDs, and IPs `.23` and `.24`, and leaves all 21 original protected fields unchanged.

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/provisioning.test.js`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement validation and successful creation**

Validate a non-empty user name of at most 80 characters, one to ten unique non-empty device names of at most 80 characters, available addresses, and adapter-generated keys. Snapshot the current persistent server configuration, add targeted peers, atomically persist the new active configuration, and only then atomically save peer/key state. Configuration write failures must propagate rather than being silently ignored.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/provisioning.test.js`

Expected: PASS for successful creation.

- [ ] **Step 5: Write failing rollback and archive tests**

Cover a second device addition failing after the first targeted peer succeeds. Assert only the first new public key is removed, original stores remain exactly equal to their fixtures, and existing public keys never appear in remove calls. Add tests that archiving User 22 targets only that user's keys, retains metadata with `archivedAt`, and deletes only the archived private keys.

- [ ] **Step 6: Implement rollback, add-device, and archive behavior**

Snapshot both stores and the persistent configuration before mutation. On any failure, remove only new live peers, restore the configuration snapshot, and restore both store snapshots. Archive operations remove selected active peers, mark metadata, remove their private keys, and persist the remaining active configuration. Surface rollback failure as a distinct error with the original cause retained.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- test/provisioning.test.js && npm test`

```bash
git add lib/provisioning.js test/provisioning.test.js
git commit -m "feat: add transactional user provisioning"
```

### Task 4: Authenticated grouped-user API

**Files:**
- Create: `app.js`
- Modify: `server.js`
- Create: `test/api.test.js`

**Interfaces:**
- `createApp({ provisioning, peerStore, keyStore, awg, tc, sessionSecret, admin })` returns an Express app without listening or running timers.
- `server.js` wires production dependencies, starts polling, configures traffic control, and listens exactly as before.
- Adds `GET /api/users`, `POST /api/users`, `POST /api/users/:userNumber/devices`, `DELETE /api/users/:userNumber`, and `DELETE /api/devices/:deviceId`.

- [ ] **Step 1: Write failing API authentication and validation tests**

Start the app on an ephemeral localhost port with fake dependencies. Use built-in `fetch` and a cookie captured from `/api/login`. Assert unauthenticated calls return `401`, invalid create requests return `400` without provisioning calls, and valid create returns literal public metadata for User 22.

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/api.test.js`

Expected: FAIL because `createApp` does not exist.

- [ ] **Step 3: Extract the app factory and add routes**

Move Express middleware and routes into `app.js` while preserving current URLs and response shapes. Include projected `userNumber`, `userName`, `deviceId`, `deviceName`, and `archivedAt` fields in peer snapshots without rewriting legacy data. Map domain validation errors to `400`, duplicate/exhaustion errors to `409`, missing records to `404`, and operational failures to `500`. Do not include private keys in JSON.

- [ ] **Step 4: Add archive confirmation contract tests**

Require `{ confirmUserNumber: 22 }` for user deletion and `{ confirmDeviceId: 'device-22-a' }` for device deletion. Mismatches return `400` and do not call provisioning.

- [ ] **Step 5: Verify server compatibility**

Run: `npm test && node --check app.js && node --check server.js`

Expected: all PASS. Requiring `app.js` must not start a listener, timer, traffic-control command, or VPN command.

- [ ] **Step 6: Commit**

```bash
git add app.js server.js test/api.test.js
git commit -m "feat: expose authenticated user management API"
```

### Task 5: Grouped user and device interface

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Create: `test/browser-model.test.js`
- Create: `public/user-view.js`

**Interfaces:**
- `public/user-view.js` exports pure CommonJS-compatible helpers under Node and attaches them to `window.UserView` in the browser.
- Produces `groupPeerSnapshots(peers)` and request-payload builders used by the UI.

- [ ] **Step 1: Write failing browser-model tests**

Assert literal peer snapshots group into User 1 and User 22, two devices remain under User 22, archived devices sort after active devices, and create/archive payload builders include exact confirmation values without private data.

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/browser-model.test.js`

Expected: FAIL because `public/user-view.js` is absent.

- [ ] **Step 3: Implement pure browser helpers and verify GREEN**

Run: `npm test -- test/browser-model.test.js`

Expected: PASS.

- [ ] **Step 4: Build the grouped interface**

Add an Add User button and dialog with user name plus repeatable device-name inputs. Render numbered user sections containing current device rows and an Add Device action. Add explicit archive confirmations that state the user number/device name and call the authenticated delete routes. Preserve all current traffic, quota, expiry, limit, toggle, password, and configuration controls.

- [ ] **Step 5: Run syntax and full tests**

Run: `node --check public/app.js && node --check public/user-view.js && npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css public/user-view.js test/browser-model.test.js
git commit -m "feat: add grouped user and device controls"
```

### Task 6: Documentation and full safety verification

**Files:**
- Modify: `README.md`
- Create: `test/safety.test.js`

**Interfaces:**
- Documentation describes local testing, required VPN-server tools, User 22 numbering, per-device keys, backup expectations, and the separate deployment boundary.

- [ ] **Step 1: Write a behavioral safety test**

Exercise create, add-device, archive-device, and archive-user through a recording adapter. Assert the adapter's complete operation vocabulary is limited to targeted add/remove, key generation, configuration read/persist, and status dump. No restart/reload operation is representable.

- [ ] **Step 2: Verify the safety test detects an unsafe fake operation**

Initially include a deliberately unsafe recorded operation in the test fixture and confirm the assertion fails; then remove only that fixture entry so the real service behavior is tested.

- [ ] **Step 3: Update operational documentation**

Document that each device requires its own configuration, existing peers map to their existing account order, the next account is User 22 for the current data, and live deployment requires a backup plus separate authorization. State that the implementation never restarts the interface.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
node --check server.js
node --check app.js
node --check lib/user-model.js
node --check lib/provisioning.js
node --check lib/awg.js
node --check public/app.js
git diff --check
```

Expected: every test and syntax check passes with no warnings or whitespace errors.

- [ ] **Step 5: Confirm live-server isolation**

Review the test output and Git diff. Confirm no command was run outside the repository, no `/etc/amnezia/amneziawg/awg0.conf` file was read or written, no `awg`/`tc` command ran, and no deployment occurred.

- [ ] **Step 6: Commit**

```bash
git add README.md test/safety.test.js
git commit -m "docs: document safe user provisioning"
```
