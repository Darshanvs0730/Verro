# VÉRRO — Phase 11: Commerce Backend Security Hardening Report

**Scope:** seven confirmed findings (F-1, F-2, F-3, P-4, P-5, P-1, G-1) in the Express/TypeScript/SQLite
commerce backend, plus new regression and concurrency coverage.
**Constraint honoured:** no change to the storefront's user-visible behaviour, server-authoritative
pricing, HMAC webhook authentication, purchaser-bound access, or private-master isolation.

---

## A. Findings, exploit closure and implementation

### F-1 — Unauthenticated test-fixture settlement (critical)
* **Exploit:** `POST /api/v1/test/orders/:id/simulate-paid` settled any order with **no credential at
  all** whenever `ENABLE_TEST_ROUTES=true` in a non-production process (`NODE_ENV` unset defaults to
  `development`). A single mis-set flag turned "buy" into "free download" for every order ID.
* **Fix (three independent, fail-closed gates):**
  1. `config/env.ts` — `testRoutesEnabled` is true only when **all** of: `NODE_ENV === "test"`,
     `ENABLE_TEST_ROUTES=true`, and `TEST_FIXTURE_TOKEN` of at least
     `MIN_TEST_FIXTURE_TOKEN_LENGTH` (16) characters are present. Development can no longer expose it.
  2. `routes/testRoutes.ts` — Layer 1 repeats the environment gate and answers **404** when disabled
     (surface existence is not disclosed); Layer 2 applies `testFixtureLimiter` (30/min) so the shared
     token cannot be brute-forced; Layer 3 is `createFixtureTokenGuard()`, which requires
     `X-Test-Fixture-Token` and compares it with `crypto.timingSafeEqual` over raw bytes (length compared
     first), answering a generic **403** on missing/empty/over-long/wrong/array-valued headers.
  3. `app/app.ts` — mounts `/api/v1/test` only when `env.testRoutesEnabled`; the header is also added to
     the CORS allow-list for browser-driven test tooling.
* **Evidence:** tests 17, 20, 21, 22 (unit) and E2E step 12 token assertions.

### F-2 — Webhook `eventId` collision (high)
* **Exploit:** malformed/absent event ids were coerced to the constant `"untrusted_event_id"`
  (and, for a missing id, to a fabricated `evt_<Date.now()>`). Two *unrelated* events therefore shared
  one replay record: the second was answered "duplicate acknowledged" **without ever being processed**,
  silently suppressing a legitimate settlement.
* **Fix:** a single shared grammar (`models/webhookIdentifiers.ts`) is enforced by the adapter's
  structural validation *and* by the controller. Malformed/absent ids are rejected (`400`/`401`, never
  acknowledged, never cached), the fabricated-timestamp fallback is deleted, and the replay key is
  namespaced and additionally bound to the exact `orderId|status` pair via a SHA-256 fingerprint, so no
  event id can ever suppress a different settlement.
* **Evidence:** tests 23, 24; E2E `SEC-9`.

### F-3 — Idempotency-key squatting / replay poisoning (high)
* **Exploit:** the replay cache and the `orders.idempotency_key` unique index keyed on the client-supplied
  header alone. Whoever sent a key first owned it: a squatter could pre-claim a key so the genuine
  buyer's later request was served a *foreign* order (or hit an unhandled `UNIQUE` constraint → HTTP 500),
  and replaying a probed key disclosed another order's existence/amount/status.
* **Fix:** the request is canonicalised (method + route + trimmed `productId` + lower-cased
  `customerEmail`) into a SHA-256 fingerprint. It is persisted alongside the replay record
  (`idempotency_records.request_fingerprint`) **and** on the order row (`orders.request_fingerprint`,
  both with safe `ALTER TABLE` migrations). A reused key with a different payload now returns
  **409 Conflict** at both layers (middleware and `OrderService.assertIdempotencyKeyOwnership`), no
  foreign data is disclosed, replay still returns `X-Idempotency-Replay: true` for the true retry, and
  a concurrent insert that slips past the cache is recovered into the same order instead of a 500.
  Keys longer than 255 characters are rejected with 400.
* **Evidence:** test 25 and concurrency test 32; E2E `SEC-8`.

### P-4 — Unknown-order webhook handling (medium)
* **Exploit:** a correctly signed event for an order that does not exist fell through to
  `processVerifiedPayment`, which threw `Cannot verify payment for nonexistent order` → an **unmapped 500**
  that a gateway would retry forever, with no audit trail and no deterministic contract.
* **Fix:** the controller looks the order up first: unknown references return **404**
  (`Webhook rejected: referenced order was not found.`), are written to the audit log as
  `UNKNOWN_ORDER_REJECTED`, and are deliberately **not** cached, so a genuine later retry can still
  settle the order once it exists (no permanent cache poisoning). Responses now carry `applied` and
  `orderStatus` so callers can see what actually happened.
* **Evidence:** test 26; E2E `SEC-10`.

### P-1 — Order status policy (medium)
* **Exploit:** `updateStatus()` applied any `from → to` transition. A late, duplicated or replayed
  `failed` callback could therefore **downgrade a settled (paid) order**, revoking a paying customer's
  entitlement.
* **Fix:** a server-side state machine (`models/orderStatusPolicy.ts`) is enforced at the single write
  choke point (`orderRepository.updateStatus`), with refusals audit-logged as
  `STATUS_TRANSITION_REJECTED` and reported as `false`. `paid` is terminal (`paid: []`); a settlement
  may still rescue `failed`/`expired`/`cancelled` because real money can be captured after a timeout or
  cancellation. Re-applying the current status is an idempotent no-op; unknown orders are not writable.
* **Evidence:** tests 27, 28.

### P-5 — Idempotency retention (low)
* **Defect:** `purgeExpired()` existed but was **never called**; expired rows were only ignored at read
  time, so a long-lived deployment accumulated unbounded replay rows (slow storage exhaustion), and a
  non-numeric `IDEMPOTENCY_TTL_MINUTES` silently disabled both expiry and purging.
* **Fix:** the sweep now runs at boot from `app/server.ts` (count logged), the TTL is validated with
  `Number.isFinite` before use, and expiry is still enforced on every read.
* **Evidence:** test 30.

### G-1 — Trust-proxy configuration (medium)
* **Defect:** the process trusted no proxy (so behind a load balancer every client shared one rate-limit
  bucket — a trivial self-DoS), while the obvious "fix" of `app.set('trust proxy', true)` would have made
  `req.ip` attacker-controlled through a forged `X-Forwarded-For`, defeating every per-IP control.
* **Fix:** an explicit, bounded hop count (`TRUST_PROXY_HOPS`, default `0` = trust nothing) is parsed by
  `resolveTrustProxyHops()`, which rejects booleans, junk, negatives and values above 10 by **failing
  closed** to `0`. `createApp()` sets `trust proxy` only when the hop count is greater than zero, so the
  blanket-boolean posture is not reachable.
* **Evidence:** test 29.


## B. Files changed

| File | Change |
| :--- | :--- |
| `backend/src/config/env.ts` | `TEST_FIXTURE_TOKEN` + min-length gate, test-only fixture enablement, `resolveTrustProxyHops()` |
| `backend/src/routes/testRoutes.ts` | `createFixtureTokenGuard()` (timing-safe, fail-closed), 3-layer router gate, router-level limiter |
| `backend/src/app/app.ts` | Explicit `trust proxy` hop count; `X-Test-Fixture-Token` CORS header; gated fixture mount |
| `backend/src/app/server.ts` | Boot-time idempotency purge; trust-proxy / fixture posture logging |
| `backend/src/adapters/developmentPaymentAdapter.ts` | Requires a well-formed `eventId`; removed the fabricated `evt_<timestamp>` fallback |
| `backend/src/models/webhookIdentifiers.ts` | **New** — shared bounded identifier grammars (F-2) |
| `backend/src/models/orderStatusPolicy.ts` | **New** — order lifecycle state machine (P-1) |
| `backend/src/models/order.ts` | `request_fingerprint` on `OrderRecord`; fingerprint input |
| `backend/src/repositories/database.ts` | `request_fingerprint` columns + isolated progressive migrations |
| `backend/src/repositories/orderRepository.ts` | Fingerprint persistence; transition policy enforced at `updateStatus` |
| `backend/src/repositories/idempotencyRepository.ts` | Fingerprint-aware `get`/`save`, hardened TTL validation, purge semantics |
| `backend/src/middleware/idempotency.ts` | Canonical request fingerprint, 409 on mismatch, key length bound, `res.locals` hand-off |
| `backend/src/middleware/errorHandler.ts` | `Conflict:` → 409; nonexistent-order → 404 |
| `backend/src/controllers/orderController.ts` | Passes the middleware fingerprint to the service |
| `backend/src/controllers/webhookController.ts` | Identifier validation, fingerprinted replay, unknown-order 404 + audit, `applied`/`orderStatus` |
| `backend/src/services/orderService.ts` | Fingerprint-bound replay/conflict, race recovery, policy-aware `failOrder` |
| `backend/.env.example` | `TRUST_PROXY_HOPS`, `TEST_FIXTURE_TOKEN`, documented fail-closed fixture policy |
| `backend/package.json` / `package.json` | `serve:test`; root `test:backend` / `test:e2e` / `test:viewport` / `dev:backend` scripts |
| `backend/tests/testEnvSetup.ts` | **New** — deterministic test env (`NODE_ENV=test`, fixture token, isolated DB) |
| `backend/tests/backend.test.ts` | Test 17 rewritten; tests 20–32 added (regression + concurrency) |
| `src/lib/purchaseService.js` | Retires the idempotency key on 409 so a retry uses a fresh key (F-3 client compat) |
| `tests/e2e-commerce.test.js` | Self-managed backend/storefront harness with fixture token + webhook secret; step 12 token assertions; SEC-8/9/10; deterministic process-group teardown |
| `backend/.gitignore` | WAL sidecar patterns (`*.sqlite-wal` / `*.sqlite-shm`) for the throwaway test databases |

## C. Test coverage added

| # | Test | Finding |
| :--- | :--- | :--- |
| 17 | Fixture surface requires the shared token (403, order untouched) | F-1 |
| 20 | Fixture guard fails closed for unconfigured/weak tokens; denied header shapes | F-1 |
| 21 | Fixture router repeats the environment gate (404 when the flag is off) | F-1 |
| 22 | Fixture settles only with the correct token | F-1 |
| 23 | Malformed/absent `eventId` rejected, no shared bucket, order untouched | F-2 |
| 24 | Distinct event ids stay independent, including across orders | F-2 |
| 25 | Idempotency-Key reuse with a different payload → 409, true retry still replays | F-3 |
| 26 | Unknown-order event → 404, un-cached, audited | P-4 |
| 27 | Settled orders are terminal; `failed` callback is acknowledged but not applied | P-1 |
| 28 | Transition matrix refused at the write choke point (incl. late settlement rescue) | P-1 |
| 29 | Trust proxy opt-in, hop-counted, `"true"`/junk fail closed, wiring verified | G-1 |
| 30 | Expired records read as absent and physically purged | P-5 |
| 31 | **Concurrency:** 6 parallel duplicate webhooks → all ack, exactly one paid transition | P-4/F-2 |
| 32 | **Concurrency:** 4 parallel duplicates with one key → one order, one row | F-3 |
| E2E 12 | Token-less/forged fixture calls refused; correct token settles | F-1 |
| E2E SEC-8/9/10 | Squatting 409; signed malformed `eventId`; signed unknown order | F-3/F-2/P-4 |

## D. Validation results (final state)

| Suite | Result |
| :--- | :--- |
| `npm test` (architecture integrity) | **46 passed, 0 failed** (exit 0) |
| `npm --prefix backend test` (backend suite) | **32 passed, 0 failed** (exit 0) |
| `node tests/e2e-commerce.test.js` | **25 passed, 0 failed** (servers auto-started and torn down as process groups; verified by two back-to-back runs with no port reuse) |
| `node tests/viewport-test.js` | 6/6 viewports PASS, 0 horizontal overflow, 0 console errors (transient `brokenImages` counts on 3 viewports are the storefront's lazy-load/preview placeholders, not assertions; the image files exist and pass on other viewports) |
| `npx tsc --noEmit` / `npm run build` | clean / exit 0 |
| `npm audit --omit=dev` (root and backend) | 0 vulnerabilities |

## E. Residual risk and unverified production controls
* The development payment adapter is still a mock; no real gateway adapter exists, so live rail
  behaviour (signature header names, event-id uniqueness guarantees, retry policy) remains unverified.
* Unknown-order and in-flight duplicate webhooks rely on the gateway honouring non-2xx responses as
  retryable. A durable event queue with a dead-letter path is still required for multi-process
  deployments; per-process guarantees (single settlement, fingerprinted replay) are what is tested here.
* `TRUST_PROXY_HOPS` must be set to the real proxy chain length at deploy time; leaving it at `0` behind
  a proxy collapses all clients into one rate-limit bucket (fail-safe, but coarse).
* Rate limiting remains in-memory per process; a shared store is a production prerequisite.
* Test-fixture enablement is now test-only, which is stricter than before — operators who previously
  used fixtures on a `development` server must start it with `NODE_ENV=test`, `ENABLE_TEST_ROUTES=true`
  and `TEST_FIXTURE_TOKEN` (see `backend/.env.example`).

## F. Frontend behavioural impact
* **None for the happy path.** `purchaseService.checkout()` keeps one idempotency key per purchase
  attempt and sends an identical payload on retry, so it still receives the normal 201/`X-Idempotency-Replay`
  responses; the storefront was retested end-to-end (steps 1–15, 6 viewports) with zero console errors.
* The storefront never calls `/api/v1/test/*`, so the stricter fixture gate is invisible to users.
* A new `409 Conflict` is possible only if a client reuses one key with a *changed* payload. The service
  now explicitly retires the key on a 409 (`purchaseService.checkout()`), so an automatic retry can never
  repeat the conflict; the next attempt generates a fresh key. The user sees the existing generic error
  path ("PAYMENT SERVICE UNAVAILABLE · PLEASE TRY AGAIN"), and no foreign order data is ever rendered —
  the 409 body contains only a generic conflict message.
* Webhook responses now include `applied`/`orderStatus`; no storefront code parses webhook responses.
