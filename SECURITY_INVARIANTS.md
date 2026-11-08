# VÉRRO — Security Invariants

These are the properties the codebase is now expected to hold **by construction**. Each one names
the mechanism that enforces it and the command that proves it still holds. If an invariant and the
code disagree, the code is wrong.

Everything below runs without a browser, without network access and without touching
`backend/verro_commerce.sqlite`:

```bash
npm run security:gate        # guards + typecheck + backend suites + dependency audits + secret scan + live-DB assertion
npm run security:gate:full   # adds the browser suites through backend/scripts/run-suites.sh
```

Both entry points call `backend/scripts/security-gate.sh`, which **aggregates**: every step runs and
the run fails if any step failed (see invariant 11).

---

## 1. A test run can never write to the developer database (F-44)

| | |
| --- | --- |
| **Rule** | When `NODE_ENV=test`, the database path must live under the temporary root, must not be inside the repository, and must not be the developer database. |
| **Enforced by** | `backend/src/config/databaseIsolation.ts` (pure policy), called from `backend/src/repositories/database.ts` **before** `new Database(...)`. Refusal is `process.exit(1)` — there is no warning-only mode. |
| **Proven by** | `backend/tests/security.test.ts` (7 × `F-44:`), `qa-artifacts/security-final/evidence/run-p1-2-guard-matrix.mjs` (7 real-process cases), `npm run security:gate` → `assert-live-db-untouched.mjs verify`. |
| **Why it was needed** | `backend/.env` ships a **relative** `DATABASE_URL`. A relative value used to reach better-sqlite3 verbatim and be resolved against `process.cwd()`, so the same configuration opened `backend/verro_commerce.sqlite` when the process started in `backend/` and an unrelated empty file when it started one level up. A routine suite that omitted `tests/testEnvSetup.ts` therefore wrote 65 fixture rows into real data. |

## 2. Database resolution does not depend on the working directory

Relative values resolve against the **backend package root**, derived from the module's own URL
(`BACKEND_ROOT` in `backend/src/config/env.ts`), never from `process.cwd()`. Absolute values are
used as-is. An unset value means `<backend>/verro_commerce.sqlite`.

## 3. Test databases are per-run and are cleaned up

`fs.mkdtempSync(path.join(os.tmpdir(), 'verro-test-'))` (unit suites), `verro-e2e-` (E2E) and
`mktemp -d` (suite harness). Each run gets a directory nobody else holds, and each is removed on
exit. No `.sqlite` file may exist inside the repository outside `backend/verro_commerce.sqlite`.

## 4. Test databases never collide with a concurrent run

Consequence of (3): there is no shared path. `VERRO_TEST_DB_DIR` exists only so a parent harness can
hand one directory to children.

## 5. A suite never writes through a server it did not start

`tests/e2e-commerce.test.js` refuses a pre-existing listener on `:4000` unless
`VERRO_ALLOW_EXTERNAL_BACKEND=1` is set explicitly, and `backend/scripts/run-suites.sh` refuses a
pre-existing `:4000` outright. A development backend is bound to the developer database, and the
lifecycle suites create and settle orders.

## 6. A held write lock is waited for, not failed on

`busy_timeout = 5000` is set on every connection (`database.ts`), so two concurrent webhook
deliveries cannot silently drop a state transition.

## 7. A failing suite makes the run fail

`run-suites.sh` aggregates per-suite exit codes and exits non-zero (`SUITES-FAILED: …`). No step
reports PASS by hand.

## 8. Secrets never reach version control, and nothing secret is served

`backend/.env` is git-ignored at two levels. `backend/scripts/scan-secrets.mjs --blocking` fails the
gate when a credential value from it appears in a tracked file. The backend serves **no** static
files at all, and `serve.json` denies `backend/**`, `.env`, `qa-artifacts/**` and `private_masters`.

## 9. Evidence never holds PII

`qa-artifacts/` is git-ignored. `qa-artifacts/security-final/baseline/` contains digests, integrity
results and row **counts** only — no database copies, no emails, no order identifiers. Database
backups live outside the repository under `~/verro-backups/<timestamp>/`.

## 10. The live database is verified untouched, not assumed untouched

`node backend/scripts/assert-live-db-untouched.mjs record|verify` compares sha256 of
`verro_commerce.sqlite` and `-wal`, plus every table's row count, around a gate run. It opens the
database **read-only** and stores only digests and counts.

> Caveat: the assertion is meaningful only while no legitimate writer is running. With a development
> backend running against the same file, a real order would change the digest. `-shm` differences are
> advisory, because a read-only open may legitimately touch the shared-memory index.

## 11. The gate reports a full posture, never a truncated one (F-45)

| | |
| --- | --- |
| **Rule** | Every gate step runs. A failure is recorded and the run continues; the process exits non-zero if any step failed. Only the live-database isolation checks may abort early. |
| **Enforced by** | `backend/scripts/security-gate.sh` — the single implementation behind both `npm run security:gate` and `security:gate:full`. |
| **Proven by** | the gate's own summary table (`<n> steps run, <m> failed`) and `GATE_FAILED` / `GATE_PASSED`. |
| **Why it was needed** | The gate was one `&&` chain. On 2026-11-01 the root dependency audit failed and the chain stopped — so `scan-secrets` and the live-database verification, the two steps that answer *"did a credential leak?"* and *"is real data intact?"*, never ran. The run looked like a complete gate that had failed on one dependency, when the security-relevant half of it had been silently skipped. |

The isolation checks (`assert-live-db-untouched.mjs record|verify`) are the deliberate exception: if a
test process can open the developer database, nothing downstream can be trusted and continuing risks
writing to it.

## 12. Dependency risk is accepted mechanically, with an expiry (F-45)

| | |
| --- | --- |
| **Rule** | The **production** surface (`npm audit --omit=dev`, root and backend) must report zero vulnerabilities, with no allowlist. The **full** audit (devDependencies included) may only contain advisories named in `backend/scripts/audit-allowlist.json`. |
| **Enforced by** | `backend/scripts/audit-allowlist.mjs`. Fails on: an unlisted advisory, an advisory whose affected package changed, a reported package set that differs from the reviewed set, an **expired** entry, or an unparseable audit result. |
| **Current accepted risk** | `GHSA-g3hv-75wg-m249` (`minimatch < 11.0.1`, moderate glob amplification) pulled in by `serve-handler@6.1.7` under the exact-pinned `serve@14.2.6`. Expires **2026-12-31**; the gate fails on or after that date until the decision is re-reviewed. |
| **Not accepted** | `GHSA-vc2v-76pw-4v95` (`compression < 1.8.2`, high) — **patched**, via `overrides.compression = 1.8.2`. The advisory states patched `1.8.2`, the registry publishes it, and the override changes exactly three lockfile entries (the nested `1.8.1` is replaced by a hoisted `1.8.2` plus its `destroy` dependency). |
| **Why no `minimatch` override** | The fix is a **three-major** jump over the version `serve-handler` declares. Its `require('minimatch')(...)` CommonJS call site does not survive that export-shape change, and that call site performs the static routing and the `serve.json` redirects that deliver the storefront CSP — overriding it would trade a dev-only DoS for a broken security control. |
| **Why acceptance is safe** | `serve` is a devDependency that is absent from `npm audit --omit=dev`, the storefront is bound to loopback (invariant 13), and the glob pattern comes from the reviewed in-repo `serve.json`, never from a request. |

## 13. The storefront is loopback-only (F-44)

`serve` binds `tcp://127.0.0.1:4173` in `package.json` (`dev`, `preview`),
`backend/scripts/run-suites.sh`, `tests/e2e-commerce.test.js` and
`qa-artifacts/tools/start-storefront.sh`.

The bare `-l 4173` form bound `*:4173`: the server publishes the whole working tree, so on a laptop
on a shared network it was reachable at the machine's LAN address. Recorded before/after in
`~/verro-backups/20261101T004648/meta/51-lan-binding-proof.txt`: `*:4173` → LAN fetch answered,
versus `127.0.0.1:4173` → LAN fetch refused. The e2e suite therefore addresses
`http://127.0.0.1:4173/` rather than `localhost`, because macOS resolves `localhost` to `::1` first
and no IPv6 listener exists.

## 14. Production refuses to start without a merchant payment identity (F-46)

The merchant UPI VPA and the payee name are configuration, not secrets — but they decide **where a
customer's money goes**. Both resolve through `secretDiagnostics`, so `verifyRuntimeSecrets()` aborts
a production boot when either is unset, and `getPaymentAdapter()` throws the same way if an adapter is
built through another entrypoint. The development fallback is a single documented constant
(`DEVELOPMENT_MERCHANT_VPA` / `DEVELOPMENT_MERCHANT_NAME`), reported at boot as
`development-default` and masked (`dvs****`), never echoed in full.

Before this there were three independent copies: `env.ts` defaulted the VPA,
`youpiPaymentAdapter.ts` defaulted it a second time (`|| 'dvs2004@slc'`), the payee name was a literal
inside the adapter with no environment variable at all, and the storefront carried both again. A
production deployment that omitted `PAYMENT_GATEWAY_MERCHANT_VPA` therefore produced valid, scannable
UPI intents pointing at the developer's personal address — no error anywhere, and the order would
still reach `paid` once someone paid it.

## 15. The public health endpoint discloses no configuration posture (F-47)

`GET /health` returns `status`, `service`, `environment` and `timestamp` only. It used to include a
`secretPosture` array naming each secret and its state (`configured` / `ephemeral` / `too-short` /
`missing-in-production`), which is a free reconnaissance oracle for any unauthenticated caller — it
announces, for example, that a deployment signs webhooks with an auto-generated key. The same posture
is still reported to operators by `verifyRuntimeSecrets()` in the boot log; `getSecretPosture()` was
deleted rather than merely unplumbed, so it cannot be re-surfaced by accident.

## 16. A payment intent can only be built from server-supplied payee data (F-48)

`src/components/PaymentModal.js` renders **nothing** payable unless the order carries both `payeeVpa`
and `payeeName`; the client keeps no payment literal. `POST /orders/create` always publishes both —
from the gateway session when the rail supplies them, otherwise from the configured merchant identity
(invariant 14). The storefront previously held `|| 'dvs2004@slc'` and a hardcoded payee name, so a
response missing those fields still produced a scannable QR to the wrong recipient.

## 17. A failing e2e step no longer hides the rest (F-44)

`tests/e2e-commerce.test.js` collects failures instead of rethrowing: every step still runs, the
summary lists each failure, and the process exits non-zero. Previously the first failing step unwound
the suite, so a regression that broke ten later steps was reported as a single assertion failure and
the remaining coverage was skipped without a trace.

---

## Deliberately NOT covered yet

- Per-request authorization / payment-rail logic — that is Phase 2 of the final pass.
- API input fuzzing and served-byte crawling — Phase 4.
- `synchronous=` tuning: WAL durability is unchanged on purpose; changing it trades crash durability
  for write throughput and needs an explicit decision.