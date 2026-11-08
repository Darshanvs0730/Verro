# VÉRRO — Phase 12 Adversarial Security Audit & Remediation Report

**Project:** VÉRRO Digital Art Gallery — Vol. 01 ("NO DEFAULTS.") digital-wallpaper commerce
**Scope:** storefront (`src/`, `index.html`, `serve.json`) + commerce backend (`backend/src`)
**Audit type:** full adversarial security audit (critical → low), exploit-reproduction driven
**Baseline commit:** `6de2484` — *chore(security): pre-remediation baseline snapshot* (tag `pre-remediation`)
**Remediation state:** working tree on top of `6de2484`
**Report date:** 2026-10-23
**Verdict:** **all identified critical/high findings remediated and regression-pinned; no critical,
high or medium finding remains open. Residual items are documented in §7.** The one advisory
published after this audit was frozen (`F-47`, a transitive `body-parser` denial of service) is
remediated and pinned, and its local impact was already bounded by the unconditional `100 kb` body
limit applied to every parser.

---

## 1. Executive summary

The audit began from a single, decisive observation: the storefront's *primary* settlement path is
`POST /api/v1/orders/:orderId/verify`, not the gateway webhook. That endpoint could be called with
**no credential at all**, and it would reconcile (i.e. settle) any order whose id it knew. Chained
with a second class of defects — a *fabricated* payment session created when the gateway was
unreachable, and a settlement-evidence check that accepted self-synthesised references such as
`youpi_reconciled` — this produced a complete, unauthenticated **payment bypass**: an attacker could
mark any order paid, receive the private master archive, and never pay.

Thirteen distinct weaknesses were reproduced and fixed. Every fix is pinned by a regression test
that fails on the baseline build. A subsequent adversarial re-verification pass against the *fixed*
build surfaced four further findings (F-43 → F-46, §3), and a routine dependency-advisory refresh
surfaced a fifth (F-47), all of which are remediated and pinned in the same way:

| Suite | Baseline (`6de2484`) | Post-fix | Δ |
| --- | --- | --- | --- |
| architecture / static guards (`npm test`) | 46 passed, 0 failed | **85 passed, 0 failed** | +39 guards |
| backend unit + adapter (`backend`) | 32 passed + 8/8 TAP | **32 passed + 9/9 TAP** | +1 |
| backend security suite (new) | *(did not exist)* | **23 passed, 0 failed** | +23 |
| e2e commerce + adversarial (`test:e2e`) | 25 passed, 0 failed | **28 passed, 0 failed** | +3 |
| viewport QA (6 viewports) | 6/6 PASS | **6/6 PASS** (commerce assertion now genuinely asserted, see F-44) | = |
| live adversarial re-check (mock YouPI rail) | *(did not exist)* | **27/27 probes** | +27 |
| `npm audit` (root + backend) | 0 vulnerabilities | **0 vulnerabilities** (one advisory published after the run — F-47 — remediated) | = |
| `tsc --noEmit` (backend) | clean | **clean** | = |

Headline outcomes:

1. **The payment bypass is closed.** `/verify` now requires a purchaser access token that is
   verified server-side with a constant-time comparison of SHA-256 digests; missing and forged
   tokens are answered identically (403) so the endpoint is not an authorization oracle.
2. **The settlement decision is server-authoritative.** Reconciliation consults only the session id
   the *server* persisted (`orders.payment_session_id`); nothing the client sends can steer it. A
   client-supplied reference is recorded as an unverified claim and can never settle an order.
3. **Fabrication is gone.** If the gateway cannot be reached, session creation fails loudly — no
   fallback/mock session is issued, and only a gateway-issued session id is ever persisted.
4. **The unauthenticated multi-rail webhook surface was deleted** (`/webhooks/sms`,
   `/webhooks/email` → 404). The single remaining intake is HMAC-verified.
5. **Downloads are single-use capabilities.** A minted link is claimed exactly once (hash-only
   storage), a replay is refused with `410 Gone`, and a fresh link remains available so the customer
   is never denied the product they paid for.
6. **Notification dispatch is idempotent.** A download-access email is sent at most once per order,
   so a purchaser token can no longer be looped to amplify outbound mail.
7. **The client half of the boundary was fixed too.** The storefront now *sends* the purchaser
   credential, restricts embedded-checkout `postMessage` to configured origins *and* the exact
   embedded frame, survives a refresh without minting a duplicate order, and escapes
   server-provided strings before they reach `innerHTML`.


---

## 2. Method & evidence base

**Approach.** (1) Capture a reproducible baseline and a safety net before touching anything.
(2) Reproduce each finding against that baseline as an executable exploit. (3) Fix at the single
choke point rather than at the call sites. (4) Pin every fix with a regression test that fails on
the baseline. (5) Re-run the *identical* harness so baseline and post-fix numbers are comparable.

**Safety net captured before any source change** (`qa-artifacts/baseline/SUMMARY.md`):

- Live database backed up with `VACUUM INTO`, `PRAGMA integrity_check` = `ok`, 0 FK violations, full
  table parity (275 orders / 70 paid / 22 fulfilled), in-repo + off-repo copies.
- Credential scan (`backend/scripts/scan-secrets.mjs`): **PASS** — no credential value from
  `backend/.env` appears in any tracked file.
- Tracked-asset check: zero `*.sqlite`, zero `.env`, zero `node_modules` staged.
- SHA-256 manifest of all security-relevant sources recorded pre-fix (see §6).

**Harness.** `bash backend/scripts/run-suites.sh <label>` runs architecture, backend unit, backend
typecheck, e2e, viewport, and both dependency audits, writing one log per suite plus a
machine-readable `summary.txt` whose per-suite exit codes are the *real* exit codes, and it fails its
own exit status if any suite failed (`SUITES-FAILED: <suite>`) so a red run cannot be read as green.
The viewport
step is self-managing (F-44): it starts an isolated backend (throwaway
`backend/verro_commerce.suite.sqlite`) and the static storefront when those ports are free, reuses
them when they are already listening, asserts the commerce lifecycle for real, and tears down only
the processes it started (including the grandchild that actually holds the port). Post-fix
artifacts: `qa-artifacts/postfix/`.

**Adversarial sources.** Four complementary layers, because the defects lived in different places:

| Layer | Artifact | What it proves |
| --- | --- | --- |
| Static | `tests/validate-architecture.js` — *Check 7: Commerce Security Remediation Guards* (39 guards) | A remediation cannot be silently reverted: absence of `/webhooks/sms\|email`, presence of `Authorization` on reconciliation, synthetic-reference absence, additivity of migrations, CSP invariants, CSPRNG idempotency keys, escaped output, *and* the F-43/F-44/F-45/F-46/F-47 shapes (reconcile-before-mint, compare-and-swap supersede, deduplicated evidence, honest test exit codes, real rail banner, test-suite database isolation, harness exit aggregation, dependency-resolution floor) |
| Unit / service | `backend/tests/security.test.ts` (23 tests) | Endpoint-level contracts: 404s, 403s, no state mutation, fail-closed on invalid evidence, four distinct gateway outcomes, migration parity, single-use grants, reused/settled/superseded session policy (F-43), bounded evidence (F-45), banner accuracy (F-46) |
| Browser / e2e | `tests/e2e-commerce.test.js` (28 steps) | Real HTTP + real Chromium: the storefront sends the credential, a refresh resumes the same order, a consumed link is refused and re-issuable |
| Live adversarial | `backend/scripts/live-exploit-check.mjs` (27 probes) | The closed findings re-exploited over real HTTP against an isolated backend driven by an ephemeral mock YouPI-PG gateway that *counts every session creation* — the only way to prove "no second payable session" from the outside |

**Environment note (F-44, corrected).** `tests/viewport-test.js` no longer depends on an operator
starting servers and no longer reports an assertion it did not make. Its `QA-8` step calls
`window.purchaseProduct('vol-01')`: the suite probes `GET /health` first, **skips** (labelled) the
commerce assertion when no backend is reachable, and **asserts** it — failing the process with a
non-zero exit code — when one is. The harness therefore starts an isolated backend + storefront for
this step, so `qa-artifacts/postfix/viewport.log` is a genuine `exit=0` run with
`[QA 8] Commerce Lifecycle State: PASS (payment_pending rendered)` printed for all six viewports.


---

## 3. Findings register

Severity reflects exploitability × impact as assessed in this audit (`C` critical, `H` high,
`M` medium, `L` low). "Regression pin" names the test that fails if the fix is reverted.

| ID | Sev | Class | Pre-remediation behaviour | Remediation | Regression pin |
| --- | --- | --- | --- | --- | --- |
| **F-01 / F-02** | C | Unauthenticated state change | `POST /api/v1/webhooks/sms` and `/webhooks/email` settled orders from an attacker-supplied body with no signature and no order binding | Routes deleted; only the HMAC-verified `POST /api/v1/webhooks/payment` remains; legacy handler and order-guessing helpers removed | `security.test.ts` F-01/F-02 (6 tests), incl. the *exact* baseline payload mutating nothing |
| **F-03** | C | BOLA + payment bypass | `POST /verify` required **no** credential: knowing/guessing an order id triggered settlement, and the response leaked `payment_reference` | Mandatory purchaser token (`Authorization: Bearer` / `X-Customer-Token`) compared in constant time; missing ≡ forged (403); refusals record evidence and leak nothing; storefront sends the token | `security.test.ts` F-03; `e2e` SEC-13 (browser-captured `authorization` header) |
| **F-05** | C | Attacker-controlled evidence | A client-supplied reference was stamped onto the order as proof of payment; self-synthesised placeholders (`youpi_reconciled`, `youpi_settlement`, `dev_ref`) were accepted | References must satisfy a shared grammar and are refused if synthetic; a claim is recorded as *unverified* and never settles; settlement lives in one choke point | `security.test.ts` F-05 (client claim + retired synthetic refs) |
| **F-20** | H | Client-controlled reconciliation key | Reconciliation could be steered by a client-supplied reference/session; sessions were fabricated as `youpi_<orderId>` when the gateway was down | `orders.payment_session_id` persisted server-side; `attachPaymentSession` is *first-wins*; reconciliation reads only that column | `security.test.ts` F-20 + Check 7 |
| **F-22** | H | Broken access control | `POST /checkout` was reachable anonymously, so a payment session could be created for someone else's order | Session creation is purchaser-scoped and mandatory | `security.test.ts` F-22 (anonymous caller refused) |
| **F-23** | H | Fabricated success path | When the gateway was unreachable, a *mock* session was returned and the storefront proceeded as if checkout were real | Session creation fails loudly; no fallback session is ever issued or persisted | `youpiAdapter.test.ts` (9/9) + `security.test.ts` F-20 |
| **F-24** | M | Ambiguous amount parsing | Amount parsing was permissive/guess-based, so a malformed payload could be interpreted as a different amount | `toAmountPaise` is deterministic and rejects ambiguity; any mismatch fails closed | `security.test.ts` F-24 |
| **F-25** | M | Collapsed terminal states | `paid` / `failed` / `expired` / `cancelled` collapsed into fewer states, and a *stale* signed event was still applied | Four distinct outcomes with a bounded freshness window; an unrecognised status is rejected outright | `security.test.ts` F-25 (four states; mismatch never writes `failed`) |
| **F-32** | M | Credential reuse across trust boundaries | The inbound webhook signing secret doubled as the outbound merchant credential | Separate `PAYMENT_GATEWAY_MERCHANT_KEY`; outbound calls never present the webhook secret | `youpiAdapter.test.ts` + Check 7 |
| **F-40** | M | Destructive migration risk | Schema changes had to be applied to a live database holding real orders | Additive, isolated migrations (new column/table/index only) with parity verification | `security.test.ts` F-40 (pre-existing columns/tables survive) + Check 7 |
| **F-41** | M | Reusable capability / mail amplification | A minted download URL stayed valid for its whole TTL and was replayable; every `POST /download` re-sent the access email | `download_grants` (SHA-256 of the token only, as primary key) claimed atomically exactly once; `notification_dispatches` ledger makes dispatch one-per-order; replay → `410 Gone`; a fresh link still works | `security.test.ts` F-41 (3 tests); `e2e` SEC-11 |
| **F-42** | L | Weak randomness / DOM XSS surface | Idempotency keys came from `Math.random()`; server-provided strings were interpolated unescaped into `innerHTML` | CSPRNG-derived ids (`crypto.getRandomValues`); single-point HTML escaping in the storefront toast and payment modal | Check 7 (3 guards) |

**Findings raised by the post-fix adversarial re-verification pass** (same remediation cycle; the
first three are properties of the *remediated* code rather than of the baseline, which is why they
were only reachable once the earlier bypasses were closed):

| ID | Severity | Finding | Root cause | Remediation | Pinned by |
| --- | --- | --- | --- | --- | --- |
| **F-43** | M | **Duplicate payable-session minting** — a refresh, retry or double-submit of `POST /orders/:orderId/checkout` created a SECOND live payable gateway session for the same order | The handler always called `adapter.createPaymentSession()`; the persisted session id is first-wins (`F-20`), so reconciliation could only ever see the first session — a payment made on the duplicate was invisible to the storefront's own settlement path, and the customer faced two live QR/UPI sessions for one order | Checkout now **reconciles the persisted session first**: settled → settle through the single choke point; `pending`/unverifiable → reuse and say so (`paymentStatusUncertain`); only gateway-terminal `unpaid\|failed\|expired\|cancelled` → replace via a real compare-and-swap (`WHERE payment_session_id = ?`), so it cannot race a first-wins bind. A lost bind is reported as `session_binding_contended` and never advertises the unbound session as payable | `security.test.ts` F-43 ×3; live check §4 (gateway-side session-creation counter); Check 7 ×6 |
| **F-44** | M | **Test harness reported success it had not verified** — the viewport suite printed `FAIL` for the commerce step whenever no backend was running yet still exited `0`, and the harness recorded the viewport result as `PASS` by hand | No reachability gate, no failure accounting, no non-zero exit; the commerce assertion depended on servers the harness never started | Viewport suite probes `/health`: **skips** the commerce assertion (clearly labelled) when the backend is absent, **asserts** it when present, records every failed assertion and exits non-zero. The harness starts/tears down its own isolated backend + storefront for that step and writes the real exit code into `summary.txt`. Unrelated defect found by the same review: `youpiAdapter.test.ts` was resolving `DATABASE_URL` to the **live developer database**; it now imports the shared test bootstrap first, and Check 7 pins that ordering (×3). The harness *itself* also always exited `0`, so a red run still looked green to any automation that reads only its status: it now aggregates the per-suite exit codes and exits non-zero (`SUITES-FAILED: <suite>`) | Check 7 ×7; `qa-artifacts/postfix/viewport.log` + `summary.txt` (real exit codes) |
| **F-45** | L | **Payment-attempt evidence amplification** — every refused/duplicate probe wrote an unbounded `payment_attempts` row (and audit-log row), so a retrying client or an attacker could inflate an order's evidence trail without bound | `recordPaymentEvidence` inserted unconditionally | Identical `(order, outcome, source)` bursts collapse inside a bounded 60 s window; the **first** occurrence of every distinct outcome is always recorded, so no security event is ever hidden | `security.test.ts` F-45; live check §5 (12 probes → 1 row); Check 7 ×2 |
| **F-46** | L | **Misleading boot banner** — the server always printed `Payment Gateway Adapter: Inactive / Dev-Safe (mock rail)`, even when YouPI-PG was the live settlement rail | Hard-coded log line | The banner resolves the active adapter and prints its real name plus production readiness (`YouPI-PG Sovereign Payment Gateway [production-ready]`); an unresolvable rail aborts startup in production (fail-closed). Extracted to `paymentRailBanner.ts` so it is assertable without binding a port | `security.test.ts` F-46; live check §6 (asserted from real boot output); Check 7 ×3 |
| **F-47** | L | **Vulnerable transitive dependency, published after the freeze** — a routine `npm audit` refresh flagged `body-parser` `<2.4.0` (pulled in by `express`) as **high** severity upstream: GHSA-27r3-jxmh-p828, denial of service from trailing bytes after a compressed request body | The lockfile pinned a version inside the vulnerable range; the advisory was published *after* the remediation run captured its `0 vulnerabilities` result, so the earlier evidence was true when taken and stale when re-read | Lockfile-only bump to `body-parser@2.4.0` (inside `express`'s own `^2.2.1` range) plus `qs@6.16.1`; no application code touched, so the §8 hash manifest is unaffected. Exposure was already bounded locally — every body parser, including the raw webhook parser, carries an unconditional `100kb` limit, so the amplification the advisory describes cannot be reached at scale | `npm audit` in the harness (which now fails the run on any advisory); Check 7 — lockfile resolution floor |
| **G-1** | M | Rate-limit bypass via spoofed IP | `trust proxy` permitted `true`, making `req.ip` — and therefore every rate-limit bucket — attacker-controlled via `X-Forwarded-For` | Explicit, bounded hop count only; `trust proxy = true` is unsupported by design | Check 7 + `env.ts` |
| **P-1** | M | Denial of sale / state downgrade | A late, duplicated or replayed failure notification could downgrade a paid (terminal) order | Transition policy enforced at the single repository write choke point | `security.test.ts` + `orderStatusPolicy.ts` |
| **P-4** | L | Silent acceptance of unknown references | A correctly signed webhook naming an unknown order was acknowledged, hiding integration faults | Unknown order → `404` (loud failure) | `e2e` SEC-10 |
| **F-2** | M | Missing identifier grammar | The webhook event identifier was neither required nor validated | Shared identifier grammar; malformed/absent `eventId` rejected before any state change | `e2e` SEC-9 |
| **F-3** | M | Idempotency-key squatting | A replayed key with a *different* payload returned the original response, disclosing another order's data | Key bound to a canonical request fingerprint; a mismatched payload is refused (`409`) with no foreign data | `e2e` SEC-8 |
| **F-1** | L | Test-only surface exposure | Fixture routes could exist outside the test environment | Mounted only under `NODE_ENV=test` **and** a mandatory token; forged tokens refused | `e2e` Step 12 (forged token → 403, order untouched) |
| **CSP** | M | Missing defence-in-depth headers | `serve.json` CSP lacked `frame-src`/`object-src`/`base-uri`/`form-action`/`worker-src`/`manifest-src` | CSP extended with explicit `frame-src` (self + local checkout origin), `object-src 'none'`, `worker-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `manifest-src 'self'` | Check 7 (CSP invariants) |



---

## 4. Deep dive: the `/verify` payment-bypass chain (F-03 → F-05 → F-20)

This is the chain that mattered, so it is documented end to end.

**The exploit as reproduced on the baseline build.** An attacker needed only an order id — no
session, no token, no signature — because `/verify` was unauthenticated and trusted the *request
body* to say what had been paid. Three independent defects made the chain work:

1. **F-03 — no authorization on settlement.** `POST /api/v1/orders/:orderId/verify` accepted
   anonymous calls. Order ids are not secrets in a shop that displays them in confirmation screens,
   and they are also enumerable in the baseline (see the `P-4`-era behaviour).
2. **F-05 — evidence was whatever the caller said it was.** The reference supplied in the body was
   written to the order as proof of payment, and the code additionally *synthesised* its own
   references (`youpi_<orderId>`, `youpi_settlement`, `youpi_reconciled`, `dev_ref`) when the
   gateway was unavailable, then accepted them on the way back in. A forged assertion was therefore
   indistinguishable from a real settlement.
3. **F-20 — the reconciliation key was client-controlled.** Because the session id was not
   authoritative, the attacker could also choose *which* gateway record would be consulted, or
   fabricate one.

**The fix, as a single invariant.** *Settlement is a server-side consequence of a gateway record
that the server itself named.* Concretely:

- `orders.payment_session_id` is written **only** from a gateway-issued session
  (`session.mode === 'production' && session.sessionId`), and `attachPaymentSession` is first-wins —
  a persisted session is never overwritten by a later caller.
- `/verify` requires a purchaser token (constant-time SHA-256 digest comparison) *before* anything
  else happens; a missing token and a forged token produce the same `403`, and the refusal itself
  is written to the payment-evidence ledger so abuse is visible.
- The claimed reference from the request is recorded as **unverified evidence** and never settles.
  Settlement proceeds only from `adapter.verifyPayment(order.id, order.payment_session_id)`.
- `processVerifiedPayment` re-validates reference *grammar*, rejects the retired synthetic
  placeholders outright, and validates amount + currency. On any mismatch it **leaves the order
  untouched** — the pre-fix code wrote `failed`, which turned one malformed payload into a permanent
  denial of sale for a legitimately payable order.

**Live re-check against the remediated build** (full output: `qa-artifacts/postfix/live-exploit-check.log`):

```
POST /api/v1/webhooks/sms          -> HTTP 404  {"error":"Resource not found."}
POST /api/v1/webhooks/email        -> HTTP 404  {"error":"Resource not found."}
create order                       -> 201, orderId ord_verro_...c9a41feb6aaff0f1, status pending
POST /orders/<id>/verify (no auth) -> HTTP 403  {"error":"Customer authorization denied."}
order status after the attempt     -> status=pending          (no state mutation)
GET /download/file?token=malformed -> HTTP 403  {"error":"Invalid or forged download authorization token."}
```

The bypass payload that worked on `6de2484` now changes nothing, and the order remains payable.

---

## 5. Deep dive: the two "quiet" findings

**F-41 — replayable downloads.** The private master archive is the product. The pre-fix design
minted a signed URL valid for `DOWNLOAD_TOKEN_TTL_MINUTES` (default 15) and honoured it as many
times as it was presented; the same call also re-sent the access email on *every*
`POST /download`. The fix makes the URL a **single-use capability**: `download_grants` stores only
the token's SHA-256 digest (the primary key), the row is claimed with a single conditional
`UPDATE ... WHERE consumed_at IS NULL`, and the claim is deliberately the **last** step of
`verifyDownloadRequest` — so a request that fails an authorization check can never burn a
legitimate grant. Replays return `410 Gone` (distinct from the `403` used for forged/expired
tokens, so clients can tell "get a new link" from "you are not allowed"), and `POST /download`
always issues a fresh grant, so the customer is never locked out of a purchase they own. The email
side is made idempotent by `notification_dispatches` (`claimNotificationDispatch` returns true only
for the first claimant).

**F-42 — the client half.** A boundary is only as strong as the side that presents the credential.
The storefront previously called reconciliation **anonymously** (which is exactly what made F-03
exploitable in the real product, not just by hand-crafted curl), generated its idempotency key with
`Math.random()`, acted on *any* `message` event carrying a `youpi.payment_success` name, and
interpolated server-returned strings straight into `innerHTML`. It now sends
`Authorization: Bearer <purchaser token>`, derives ids from `crypto.getRandomValues`, accepts
embedded-checkout messages only from configured origins **and** only from the exact iframe it
embedded, escapes its toast/modal output, and persists the in-flight purchase in `sessionStorage`
(per-tab, 30-minute TTL, cleared on settlement) so an interrupted checkout resumes the *same* order
instead of minting a duplicate.


---

## 6. Verification: baseline vs post-fix

All figures below come from the identical harness (`backend/scripts/run-suites.sh`), so they are
directly comparable. Raw logs: `qa-artifacts/baseline/*.log` and `qa-artifacts/postfix/*.log`.
The post-fix column was re-executed on 2026-10-24 after the F-47 lockfile-only dependency bump
(no source changes), so every figure below is from that final run.

| Suite | Command | Baseline (`6de2484`) | Post-fix | Exit |
| --- | --- | --- | --- | --- |
| architecture / static guards | `npm test` | 46 passed, 0 failed | **85 passed, 0 failed** (Check 7 = 39 guards) | 0 |
| backend unit | `npm --prefix backend run test` | 32 passed, 0 failed | **32 passed, 0 failed** | 0 |
| backend adapter (TAP) | (same command) | 8 pass, 0 fail | **9 pass, 0 fail** | 0 |
| backend security (new) | (same command) | — | **23 passed, 0 failed** | 0 |
| backend typecheck | `npm --prefix backend run typecheck` | clean | **clean** | 0 |
| e2e commerce + adversarial | `npm run test:e2e` | 25 passed, 0 failed | **28 passed, 0 failed** | 0 |
| viewport QA | `npm run test:viewport` (harness-managed servers) | 6/6 viewports PASS *(recorded by hand)* | **6/6 viewports PASS**, 0 console errors each, commerce step asserted | 0 |
| live adversarial re-check | `node backend/scripts/live-exploit-check.mjs` | — | **27/27 probes** (isolated backend + mock YouPI-PG rail) | 0 |
| `npm audit` (root) | `npm audit` | 0 vulnerabilities | **0 vulnerabilities** | 0 |
| `npm audit` (backend) | `npm --prefix backend audit` | 0 vulnerabilities | **0 vulnerabilities** (transient advisory F-47 appeared after the freeze and was remediated before this run) | 0 |
| secret scan | `node backend/scripts/scan-secrets.mjs` | PASS | **PASS** | 0 |
| env audit (no credential in VCS) | `node backend/scripts/compare-env.mjs` | (tool over-reported: counted empty placeholders) | **0 real secret values duplicated**; 6 empty placeholders + 2 non-secret literals listed explicitly | 0 |
| migration parity (pre-existing data) | `backend/tests/security.test.ts` F-40 + DB backup parity check | 275 orders / 70 paid / 22 fulfilled | **all pre-existing columns/tables survive; all pre-existing rows byte-identical (VACUUM INTO snapshot compares clean); suite run leaves the live DB untouched → see §7 (items 8–10)** | 0 |

**New regression tests added by this remediation** (each verified to pass on the fixed build; the
corresponding exploit was verified to fail on the baseline build before the fix):

*Backend security suite (`backend/tests/security.test.ts`, 23 tests)* — F-01/F-02 ×6 (routes gone,
no enumeration, exact baseline payload mutates nothing, no unauthenticated rail anywhere, HMAC rail
is the only intake), F-03 ×1, F-05 ×2, F-20 ×1, F-22 ×1, F-24 ×1, F-25 ×2, F-40 ×1, F-41 ×3, plus the
re-verification findings: F-43 ×3 (reuse while pending / settle when paid / replace only when
definitively dead, with the compare-and-swap audited), F-45 ×1 (12 identical probes → 1 evidence row,
with a distinct outcome still recorded), F-46 ×1 (banner reports the real rail).

*Storefront e2e (`tests/e2e-commerce.test.js`, SEC-11/12/13)* — a consumed download link is refused
(`410`) and a fresh link is still issued and streamed; an interrupted purchase survives a refresh
without minting a second order and the cold page recovers the purchaser credential from the
persisted session; storefront settlement is captured in-flight and asserted to carry
`Authorization: Bearer <purchaser token>`, and a forged token is refused identically to a missing
one with no settlement state or payment reference disclosed.

*Live adversarial re-check (`backend/scripts/live-exploit-check.mjs`, 27 probes)* — every closed
finding re-exploited over real HTTP against an isolated backend whose payment rail is an ephemeral
mock YouPI-PG gateway. The gateway counts each `POST /api/v1/payments`, which is what turns "no
duplicate payable session" into a hard assertion: a pending attempt is reused (creation count
unchanged), a paid attempt settles (count unchanged), and only a definitively dead attempt
(gateway 404 → `unpaid`) is replaced — exactly once, with the replacement reused thereafter. The
same run re-confirms F-01/F-02 (404), F-03 (403), F-05 (no settlement from a claim), F-20 (no
client-steered settlement), F-41 (forged grant refused), F-45 (12 probes → 1 row) and F-46 (banner
naming the live rail), and checks the F-1 fixture gate (403 without the fixture token).

*Static guards (`tests/validate-architecture.js`, Check 7 — 39 new guards; the suite grows from 46
to 85 checks, and Check 7 did not exist on the baseline build)* — pins: no
`/webhooks/sms|email` route; reconciliation sends `Authorization` via `getPurchaserToken`;
`postMessage` handlers check both `origin` and `source`; synthetic references
(`youpi_reconciled|youpi_settlement|dev_ref`) absent; `payment_session_id` persisted and
`access.authorized` precedes `processVerifiedPayment`; additive migration + `idx_orders_payment_session`;
CSP invariants; CSPRNG idempotency keys; escaped storefront/modal output; and the new shapes —
reconcile-before-mint ordering, `outcome !== 'superseded'` gating, compare-and-swap supersede,
terminal-status-only replacement, contended bind never advertised as payable, evidence dedupe
ordering, viewport reachability/skip/non-zero-exit behaviour, harness-recorded viewport exit code,
harness-level aggregation of per-suite exit codes, the lockfile resolution floor for the F-47
advisory, and the real-rail boot banner with fail-closed resolution.

---

## 7. Residual risk, accepted limitations & recommendations

Nothing critical, high or medium remains open. The following are either deliberately accepted or
belong to the deployment boundary rather than the code:

1. **Dev-mode secrets are ephemeral per process.** In non-production, signing/download secrets are
   generated per process (the backend logs a *secret posture warning*), so tokens do not survive a
   restart. **Production requirement:** set `DOWNLOAD_TOKEN_SECRET`, `WEBHOOK_SECRET`,
   `PAYMENT_GATEWAY_SECRET` and `PAYMENT_GATEWAY_MERCHANT_KEY` to distinct, high-entropy values and
   keep them out of source control. `verifyRuntimeSecrets()` fails closed in production.
2. **CSP still allows CDN-hosted Tailwind** (`https://cdn.tailwindcss.com`) and inline
   configuration/JSON-LD script, which is why `script-src` cannot be locked down further today.
   **Recommendation:** pre-compile Tailwind at build time, then drop `cdn.tailwindcss.com` and move
   the inline config/JSON-LD into hashed assets so `script-src` can be strict.
3. **Single-process SQLite.** Rate-limit and idempotency state are process-local. **Recommendation:**
   when the app is horizontally scaled, move rate-limit buckets and idempotency/grant claims to a
   shared store (Redis/Postgres) so the guarantees remain global rather than per-replica.
4. **No email deliverability guarantee.** Dispatch idempotency is enforced in the ledger, but the
   transport is best-effort; a failed send is not retried. **Recommendation:** add a queue with
   at-least-once delivery and the same dispatch key for deduplication.
5. **PII retention.** Orders store buyer email; there is no automated purge job.
   **Recommendation:** define a retention window and a scheduled purge for fulfilled orders.
6. **Actionable next hardening steps (not findings):** rotate the gateway merchant credential on a
   schedule; add `Strict-Transport-Security` behind TLS termination; enable structured security
   logging/metrics for `rejected_*` evidence rows so attempted abuse is alertable.
7. **Audit-tooling precision (fixed during this audit).** `backend/scripts/compare-env.mjs`
   originally counted *any* secret-like key present in both `.env` and `.env.example` — including
   empty placeholders and non-secret literals — as a "duplicated secret". It now distinguishes real
   credentials from configuration, lists the excluded keys explicitly, and exits non-zero only on a
   genuine leak (current result: **0**). This prevents a future reviewer from either missing a real
   leak in noise or dismissing the check as a false positive.
8. **Test suites are isolated from developer data (fixed and now pinned during this audit).** The
   backend suites used to resolve `DATABASE_URL` to the live `backend/verro_commerce.sqlite`
   whenever the operator had not exported one, so a routine `npm --prefix backend run test` seeded
   fixture orders straight into local developer data - this is the concrete data-integrity instance
   behind F-44 (`youpiAdapter.test.ts` called `orderRepository.create()` against live local data).
   All three suites now import `backend/tests/testEnvSetup.ts` **before** any `../src/...` import,
   which redirects the run to a dedicated, gitignored `backend/verro_commerce.test.sqlite` that is
   deleted at the start of every run; the e2e harness (`verro_commerce.e2e.sqlite`) and the
   viewport harness (`verro_commerce.suite.sqlite`) were already isolated. **Verified by A/B on the
   frozen tree:** the live `orders` count was `340` immediately before and `340` immediately after a
   full `npm --prefix backend run test`, with the newest `created_at` unchanged
   (`2026-10-23T13:49:59.103Z`), while `verro_commerce.test.sqlite` received the 14 fixture orders -
   the suites now write **only** to throwaway databases. Check 7 pins the import ordering on all
   three suites plus the e2e spawn, so the leak cannot be reintroduced silently. **Residual:** the
   live database still carries the rows that *pre-fix* runs wrote. The parity checker reports
   `added-by-test-runs=65` against the pre-remediation snapshot, and no pre-existing row was removed
   or rewritten (`missing=0`, `modified=0`). Those 65 rows were independently re-derived in
   **item 10** (a read-only forensic pass enumerating every appended id, its evidence rows and the
   append timeline). The §9 recipe removes exactly those 65 by set
   difference; it was verified on a `VACUUM INTO` copy (`orders 340 -> 275`, `integrity_check ok`,
   0 foreign-key violations). Note that 37 of the *pre-existing* 275 rows also carry fixture emails
   (`buyer@example.com` &c.), so the developer database was already carrying test noise before this
   audit began.
9. **Audit-tooling precision (fixed during this audit).** `backend/scripts/db-parity-check.mjs`
   resolved its "rows added by test runs" count against the **live** row map rather than the
   snapshot map. A live row is by definition present in the live map, so the counter was
   structurally unreachable and printed `added-by-test-runs=0` no matter how much fixture data had
   leaked in - a false negative on exactly the defect it exists to detect. It also compared whole
   rows, so the additive `payment_session_id` migration (F-40) surfaced as `modified=275`. It now
   indexes live and snapshot separately, compares only the columns both schemas share, names the
   columns added by migration explicitly, groups additions by `customer_email`, and exits non-zero
   if any pre-existing developer row was removed or rewritten. Current result on the frozen tree:
   `missing=0, modified=0, added-by-test-runs=65` (exit `0`).
10. **Live-data count discrepancy (`316` / `89` vs `340`) resolved - nothing was lost.**
    Two different reads of the live database existed after the freeze: an earlier verification pass
    reported **316 orders / 89 paid**, while this report's final figure is **340 orders**. A strictly
    read-only re-investigation (the live bytes are copied first and the live file is *never* opened by
    SQLite - see §9 step 7 and `qa-artifacts/db-integrity-2026-10-24/`) shows the two figures are
    **two points on the same monotonically growing series**, not a corruption, a lost write or an
    inconsistent snapshot:
    * **Pre-remediation snapshot** (both verified `VACUUM INTO` backups, `07:12:37Z` / `07:13:01Z`):
      **275 orders / 70 paid / 22 fulfilled**, newest `2026-10-23T07:10:52.600Z`, order rowids
      `1..275`.
    * **Live now:** **340 orders** (225 `pending`, 101 `paid`, 14 `payment_pending`), newest
      `2026-10-23T13:49:59.103Z`, order rowids `1..340`.
    * **Set difference on order ids:** `added=65`, `missing=0`, `modified=0`; the paid delta `+31`
      equals `addedPaid(31) + preexistingTurnedPaid(0)`; the 65 additions occupy the **contiguous tail
      `rowid 276..340`**, so the change is *append-only* and no pre-existing developer row was removed,
      rewritten or re-statused.
    * **The earlier read is reproduced exactly.** Replaying the append stream by `created_at`, orders
      first reach `316` on the 41st appended row - and **at that same row `paid` is `89`**
      (`orders=316, paid=89` at `2026-10-23T12:21:30.257Z`). The `316`/`89` observation was therefore a
      **mid-session read taken while pre-fix suite runs were still appending rows**, and the
      "*additional* 24 orders" are simply the rest of that stream - six further pre-fix suite
      executions between `12:31:14Z` and `13:49:59Z`, four rows each (one purchase + `chk` + `rec` +
      `claim`).
    * **All 65 rows are test fixtures, not application traffic:** `16 × ord_verro_chk_`,
      `16 × ord_verro_rec_` and `14 × ord_verro_claim_` - the direct `orderRepository.create()`
      fixtures written by `youpiAdapter.test.ts` Tests 6/7/8 (`buyer@example.com`,
      `reconcile@example.com`, `claim@example.com`, same-millisecond id clusters) - plus `19`
      storefront purchases of `vol-01` (`39900 INR`): `16 × collector@atelier.art` (settled, with a
      gateway reference) and `3` with a **`NULL` customer email** (no reference, no session), which are
      the viewport-only runs described below.
    * **Companion rows are confined to the same window:** `+58 payment_attempts` (all 58 belong to an
      appended order), `+125 audit_logs` (`CREATED ×65`, `STATUS_UPDATED ×31`,
      `PAYMENT_SESSION_ATTACHED ×29` - i.e. they came through the audited application paths, not raw
      inserts), `+19 idempotency_records`.
    * **Positive control (the decisive one):** appended orders per calendar day =
      **`2026-10-23: 65`, `2026-10-24: 0`**; likewise no `payment_attempt`, `audit_log` or
      `idempotency_record` is dated `2026-10-24` or later. `PRAGMA integrity_check` = `ok`,
      0 foreign-key violations, `freelist_count` = 0, and nothing held the file open during the pass.
    * **Root cause**, sharpening F-44: `backend/.env` ships `DATABASE_URL=./verro_commerce.sqlite` - a
      **relative** path that `config/env.ts` stores unresolved - so any suite that did not import the
      bootstrap wrote to `./verro_commerce.sqlite` *relative to its own cwd*, i.e. the live file. All 19
      append events therefore ran under the pre-fix tree; the stream stops at the last pre-fix run
      (`13:49:59Z`, which is also the live page file's `mtime`) and never resumes.
    * **Residual (operator-dependent, not automatic).** The viewport step reuses a server already
      listening on `:4000` ("reusing the running backend") rather than refusing it. If that
      pre-existing backend was launched from `backend/` with the relative `.env` value, the QA-8
      browser purchase lands in the **live** database - the three `NULL`-email `vol-01` purchases are
      exactly that path. **Recommendation:** have the harness treat a pre-existing `:4000` listener as
      a hard failure unless it advertises its own isolated database, and make the shipped
      `DATABASE_URL` absolute. The viewport suite itself spawns nothing (`tests/viewport-test.js` has
      no `child_process` use), so it can only ever write through whatever backend owns `:4000`.
    * **Revised conclusion on live-data integrity.** The frozen tree does **not** touch the live
      database: `added-by-test-runs` is still `65`, and the live page file is byte-identical before and
      after this investigation (`sha256 3870d367...`) with a **0-byte WAL**, so every committed page
      sits in the page file and no frame is pending. The live database is **complete, consistent and
      intact**; it simply still carries the 65 pre-freeze fixture rows and their evidence rows, which
      is what §9 step 6 exists to remove by set difference. Nothing was lost, and `316 → 340` is fully
      explained by *when* each read was taken. *(Sidecar note: the live `-shm` - a rebuildable WAL
      index that holds no committed records - carries a `2026-10-24` mtime from the read-only
      verification queries themselves; the page file and WAL timestamps are unchanged from
      `2026-10-23`. All of this is recorded in `qa-artifacts/db-integrity-2026-10-24/`.)*


---

## 8. Hash manifest (security-relevant sources)

Pre-fix values are from `qa-artifacts/baseline/SUMMARY.md` (captured at tag `pre-remediation`);
post-fix values were recomputed on the final frozen remediation tree (i.e. after the last source
edit, which predates the post-fix suite run — see §6).

| File | Pre-fix SHA-256 | Post-fix SHA-256 |
| --- | --- | --- |
| `backend/src/routes/webhookRoutes.ts` | `4ac371a9…6c2435` | `890e2fcf…2ee5e6` |
| `backend/src/controllers/webhookController.ts` | `3d161f1f…34c1e5` | `ed1ccfbc…c52bc0` |
| `backend/src/controllers/orderController.ts` | `b4f938b6…777028` | `3d35fd8a…665354` |
| `backend/src/adapters/youpiPaymentAdapter.ts` | `c56aebe1…f48882` | `ee9892c8…8eee3e` |
| `backend/src/services/orderService.ts` | `2f3d2d1a…f98fda` | `d306b6b6…624993` |
| `backend/src/models/orderStatusPolicy.ts` | `e40e8e0c…b9e4e1` | `e40e8e0c…b9e4e1` *(unchanged)* |
| `backend/src/repositories/orderRepository.ts` | `8e3f17df…050d3d` | `38ea1855…313d47` |
| `backend/src/repositories/database.ts` | `033053ee…c15dd4` | `7a629349…04a79d` |
| `backend/src/config/env.ts` | `290d9f92…a33dc4` | `290d9f92…a33dc4` *(unchanged)* |
| `backend/src/middleware/validation.ts` | *(not in manifest)* | `737ba07e…ea263e` |
| `backend/src/services/fulfillmentService.ts` | *(not in manifest)* | `720ebdb5…4e1a0d` |
| `backend/src/adapters/paymentAdapterFactory.ts` | *(not in manifest)* | `76309fe4…2dcc3b` |
| `serve.json` | `486edad2…a20255` | `7e232d18…87ca9d` |
| `src/lib/purchaseService.js` | `901e1e9d…1ad4d0` | `3433b13a…f2ce1a` |
| `src/components/PaymentModal.js` | `c7e66e76…721488` | `8975b0c5…cb913b` |
| `index.html` | `1e2dd164…a0c256` | `1e2dd164…a0c256` *(build output unchanged: markup-only build, no security-relevant markup delta)* |

Reproduce the post-fix manifest with:

```bash
shasum -a 256 backend/src/routes/webhookRoutes.ts backend/src/controllers/*.ts \
  backend/src/adapters/*.ts backend/src/services/*.ts backend/src/repositories/*.ts \
  backend/src/config/env.ts backend/src/middleware/validation.ts \
  serve.json src/lib/purchaseService.js src/components/PaymentModal.js index.html
```

---

## 9. Appendix — reproduction commands

```bash
# 0. Preconditions
node backend/scripts/scan-secrets.mjs          # expect: RESULT: PASS

# 1. Full suite (identical harness used for baseline and post-fix)
#    The harness aggregates the per-suite exit codes and exits non-zero if ANY suite failed
#    (printing `SUITES-FAILED: <suite>` instead of `SUITES-FINISHED`), so a red run cannot be
#    mistaken for green by automation.
bash backend/scripts/run-suites.sh postfix     # architecture, backend, typecheck, e2e, audits
npm --prefix backend run test                  # 32 unit + 9 TAP + 23 security

# 2. Viewport QA (needs live servers; the harness leaves these ports free)
bash qa-artifacts/tools/start-storefront.sh                     # storefront on :4173
cd backend && DATABASE_URL=/tmp/verro-viewport.sqlite \
  CORS_ORIGIN=http://127.0.0.1:4173 PORT=4000 HOST=127.0.0.1 \
  npx tsx src/app/server.ts                                     # backend on :4000
npm run test:viewport                                           # 6/6 viewports PASS

# 3. Live adversarial re-check of the closed findings
#    (see qa-artifacts/postfix/live-exploit-check.log for expected output)
curl -i -X POST http://127.0.0.1:4000/api/v1/webhooks/sms   -d '{"status":"paid"}'   # 404
curl -i -X POST http://127.0.0.1:4000/api/v1/orders/<id>/verify -d '{"status":"paid"}' # 403

# 4. Test-suite data isolation (a unit run must NOT grow the live database)
cd backend
node -e "const D=require('better-sqlite3');console.log('live orders:',new D('verro_commerce.sqlite',{readonly:true}).prepare('SELECT COUNT(*) c FROM orders').get().c)"
npm run test                       # 32 unit + 9 TAP + 23 security -> all against verro_commerce.test.sqlite
node -e "const D=require('better-sqlite3');console.log('live orders:',new D('verro_commerce.sqlite',{readonly:true}).prepare('SELECT COUNT(*) c FROM orders').get().c)"

# 5. Live-vs-snapshot parity (read-only; exits non-zero if a developer row was removed or rewritten)
node scripts/db-parity-check.mjs  # expect: missing=0, modified=0, added-by-test-runs=65

# 6. OPERATOR DECISION - remove the rows that pre-fix test runs left in the live database.
#    The purge is a SET DIFFERENCE against the pre-remediation snapshot, so it can only ever remove
#    rows that did not exist in the backed-up developer data; the 275 backed-up rows are never
#    touched. Back up first.
cp verro_commerce.sqlite ~/verro-db-backups/pre-purge.sqlite
node <<'JS'
const Database = require('better-sqlite3');
const db = new Database('verro_commerce.sqlite');
db.exec(`ATTACH DATABASE '../qa-artifacts/db-backup-2026-10-23T07-13-01-013Z/verro_commerce.live-snapshot-2026-10-23T07-13-01-013Z.sqlite' AS snap`);
const purge = db.transaction(() => {
  const orders = db.prepare('DELETE FROM orders WHERE id NOT IN (SELECT id FROM snap.orders)').run().changes;
  const attempts = db.prepare('DELETE FROM payment_attempts WHERE order_id NOT IN (SELECT id FROM orders)').run().changes;
  const grants = db.prepare('DELETE FROM download_grants WHERE order_id NOT IN (SELECT id FROM orders)').run().changes;
  const dispatches = db.prepare('DELETE FROM notification_dispatches WHERE order_id NOT IN (SELECT id FROM orders)').run().changes;
  return { orders, attempts, grants, dispatches };
});
console.log('purged:', purge());
console.log(db.prepare('PRAGMA integrity_check').get());
JS
# Verified on a VACUUM INTO copy: purged {orders:65, attempts:58}, orders 340 -> 275,
# integrity_check ok, 0 foreign-key violations. audit_logs is append-only evidence and is
# deliberately left intact.

# 7. Live-data forensic re-check (the `316` -> `340` question). Copies the live BYTES to /tmp first;
#    the live file is never opened by SQLite, so not even its -shm index is touched. Reproduces:
#    added=65, missing=0, modified=0, append-only rowids 276..340, orders first reach 316 with
#    paid=89 (the earlier observation), all 65 rows are youpiAdapter T6/T7/T8 + vol-01 fixtures, and
#    0 appended rows on 2026-10-24. Expected output is committed beside the probes.
node qa-artifacts/db-integrity-2026-10-24/probe-copy-then-query.cjs
node qa-artifacts/db-integrity-2026-10-24/probe-fixture-attribution.cjs
node qa-artifacts/db-integrity-2026-10-24/probe-evidence-rows.cjs
```


**Artifacts produced by this audit**

| Path | Contents |
| --- | --- |
| `qa-artifacts/baseline/` | Pre-fix logs for every suite + `SUMMARY.md` (baseline conditions, results, pre-fix hashes) |
| `qa-artifacts/postfix/` | Post-fix logs for every suite + `summary.txt` + `live-exploit-check.log` |
| `qa-artifacts/db-backup-<ts>/` | Verified `VACUUM INTO` database snapshots taken before any change |
| `qa-artifacts/tools/start-storefront.sh` | Reproducible detached storefront used by the viewport suite |
| `backend/scripts/{run-suites,scan-secrets,compare-env}.mjs\|.sh` | Harness, credential scan, environment/DB parity |
| `backend/scripts/live-exploit-check.mjs` | Live adversarial re-check (27 probes) against an isolated backend + ephemeral mock YouPI-PG rail |
| `backend/scripts/db-parity-check.mjs` | Read-only live-vs-snapshot parity (`missing` / `modified` / `added-by-test-runs`) + `integrity_check` |
| `backend/tests/security.test.ts` | 23-test regression suite pinning every finding above |
| `tests/validate-architecture.js` (Check 7) | 39 static guards that make a silent revert fail CI |
| `tests/e2e-commerce.test.js` (SEC-1…SEC-13) | Browser-level adversarial steps, incl. the storefront credential assertions |
| `qa-artifacts/db-integrity-2026-10-24/` | Read-only live-data forensics for the `316 → 340` count question (§7 item 10): re-runnable copy-then-query probes, set-difference + fixture-attribution outputs, the 65 appended order ids, and the live file hashes before/after |
| `phase12_security_audit_report.md` | This report |

---

*Audit conducted against commit `6de2484` (tag `pre-remediation`); remediation verified on the
working tree with all suites green. Every claim in this report is backed by a log file or a test
that can be re-run with the commands above.*

