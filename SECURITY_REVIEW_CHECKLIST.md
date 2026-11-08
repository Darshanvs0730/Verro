# VÉRRO — Security Review Checklist

Use this before approving a change to authentication, authorization, payments, the paywall,
database access, or the CI gate. Each line is a question with a concrete check. `npm run
security:gate` must be green before review starts.

---

## 1. Database isolation (F-44)

- [ ] Does the change open a SQLite file? If so, does it go through `getDatabase()` (which calls
      the isolation guard) rather than `new Database(...)` directly?
- [ ] If a test or script points `DATABASE_URL` somewhere new, is that path under `os.tmpdir()`
      and **outside** the repository? `node backend/scripts/assert-live-db-untouched.mjs verify`
      must still pass after a run.
- [ ] Does anything still read `process.cwd()` to locate a database or the repository root?
      (`grep -rn "process.cwd()" backend/src backend/tests`)
- [ ] After running the change's tests, is `git status` free of new `*.sqlite` files, and is
      `backend/verro_commerce.sqlite` unchanged (`shasum -a 256` before/after)?

## 2. Test fidelity

- [ ] Does every new assertion actually fail when the fix is reverted? (Mutate, run, confirm red,
      restore. A test that cannot go red is decoration.)
- [ ] Does a failing suite make the runner exit non-zero? No step may print PASS by hand.
- [ ] Does a suite refuse to attach to a server it did not start, unless the operator opted in
      (`VERRO_ALLOW_EXTERNAL_BACKEND=1`)?

## 3. Authorization and payment trust boundaries

- [ ] Is every new endpoint authenticated, and does it authorize the *specific* resource
      (ownership check), not merely "some valid token"?
- [ ] Can any client-supplied value (amount, currency, reference, session id, status) change
      server state without a gateway-authenticated or operator-authorized signal?
- [ ] Does a webhook verify an HMAC over the exact raw bytes, compare in constant time, and reject
      replays through an idempotency record?
- [ ] Are prices, product ids and fulfilment decisions read from the server, never the request?

## 4. Injection and browser surface

- [ ] Does any new code interpolate untrusted data into `innerHTML`, a template literal that becomes
      markup, `eval`, `new Function`, or a URL attribute (`href`, `src`, `srcdoc`)?
- [ ] If markup must be built from data, is it escaped by a single shared helper (not ad-hoc
      `.replace()` chains)?
- [ ] Does a new external script/style/connect target require a CSP change? Widen the CSP
      deliberately, never with `unsafe-eval` or a bare `*`.

## 5. Secrets and configuration

- [ ] Is a new secret read from the environment with a fail-closed check, and is no literal default
      committed? (`node backend/scripts/scan-secrets.mjs --blocking`)
- [ ] Does any new log line, error message or `/health` field disclose a secret, a token, a full
      stack trace, or another tenant's identifier?
- [ ] Is `NODE_ENV=production` still fail-closed — does startup abort rather than degrade?

## 6. Supply chain

- [ ] Is the dependency pinned (exact or caret-with-lockfile), and does the lockfile change appear
      in the diff?
- [ ] Did you check the package's `scripts` (install hooks) before adding it?
- [ ] Is `npx -y <pkg>` used anywhere new? `-y` downloads and executes an unpinned package —
      prefer a pinned devDependency.

## 7. Evidence and reporting

- [ ] Does new evidence under `qa-artifacts/` contain PII, a database copy, a token, or a secret?
      Digests, counts and verdicts only.
- [ ] Does the report label each result honestly — `reproduced`, `not-reproduced`,
      `blocked-by-preexisting-control`, or `inconclusive`?
- [ ] Are claims tied to a command and its exact output, rather than to an assumption?

---

## The two questions that catch most of it

1. **Who can reach this, and what do they control?** Name the attacker, the input and the state
   change. If the answer is "a client-controlled value reaches a state transition", stop.
2. **How would I prove this is broken?** If you cannot write the failing command, the fix is not yet
   understood.