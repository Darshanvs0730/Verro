#!/usr/bin/env bash
# VÉRRO security gate — AGGREGATING runner (F-45).
#
# Why this file exists: the gate used to be a single `&&` chain in package.json. On 2026-11-01 the
# root dependency audit failed, the chain short-circuited, and the two steps AFTER it —
# scan-secrets and the live-database verification — never ran. The run could not answer the only
# questions that matter ("did a credential leak?" "is the live database intact?"), yet it looked
# like a complete gate that had merely failed on a dependency. An early-exit chain cannot report a
# full posture, and its "failed on step N" is indistinguishable from "steps N+1.. never happened".
#
# Now: EVERY step runs, results are aggregated, and the process exits non-zero if ANY step failed.
# The live-database isolation checks are the sole exception — they fail fast, because if test
# isolation is broken then nothing after them can be trusted and continuing could write to the
# developer's live database.
#
# Usage:  bash backend/scripts/security-gate.sh [fast|full]
#   fast (default): architecture guards, typecheck, backend unit tests, dependency audits,
#                   secret scan, live-DB isolation checks
#   full:           the same, plus the e2e and viewport suites (via run-suites.sh, which owns the
#                   isolated-backend + loopback-storefront orchestration)
set -u

MODE="${1:-fast}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

STEP_NAMES=()
STEP_CODES=()
STEP_SECONDS=()
FAILED_COUNT=0

banner() {
  echo
  echo "==================================================================="
  echo "$*"
  echo "==================================================================="
}

report() {
  echo
  echo "===================== SECURITY GATE SUMMARY (${MODE}) ====================="
  local index verdict failures=0
  for index in "${!STEP_NAMES[@]}"; do
    verdict='PASS'
    if [ "${STEP_CODES[$index]}" -ne 0 ]; then
      verdict='FAIL'
      failures=$((failures + 1))
    fi
    printf '%-22s exit=%-3s %-4s %ss\n' "${STEP_NAMES[$index]}" "${STEP_CODES[$index]}" "$verdict" "${STEP_SECONDS[$index]}"
  done
  # Only in full mode: in fast mode this file would be a STALE summary from an earlier full run,
  # i.e. a step that reports PASS by hand — exactly the defect class this gate exists to remove.
  if [ "$MODE" = "full" ] && [ -f qa-artifacts/security-gate/summary.txt ]; then
    echo
    echo '--- per-suite summary (qa-artifacts/security-gate/summary.txt) ---'
    cat qa-artifacts/security-gate/summary.txt
  fi
  echo
  echo "${#STEP_NAMES[@]} steps run, ${failures} failed"
  FAILED_COUNT=$failures
}

run_step() {
  local name="$1"; shift
  banner "STEP: ${name}"
  echo "### cmd: $*"
  local start end code
  start=$(date +%s)
  "$@"
  code=$?
  end=$(date +%s)
  STEP_NAMES+=("$name"); STEP_CODES+=("$code"); STEP_SECONDS+=("$((end - start))")
  echo "### ${name} exit=${code} duration=$((end - start))s"
  return 0
}

# Fail-fast steps: test isolation only. Everything else is aggregated.
run_isolation_check() {
  local name="$1"; shift
  banner "STEP (FATAL-FAIL-FAST): ${name}"
  echo "### cmd: $*"
  STEP_NAMES+=("$name"); STEP_SECONDS+=("0")
  "$@"
  local code=$?
  STEP_CODES+=("$code")
  echo "### ${name} exit=${code} duration=0s"
  if [ "$code" -ne 0 ]; then
    echo
    echo "!!! ${name} FAILED — test isolation cannot be trusted, so the remaining steps are NOT run"
    echo "!!! (continuing could open or write the developer's live database):"
    echo "!!!   ${REPO_ROOT}/backend/verro_commerce.sqlite"
    report
    exit "$code"
  fi
  return 0
}

run_isolation_check live-db-record node backend/scripts/assert-live-db-untouched.mjs record

if [ "$MODE" = "full" ]; then
  run_step test-suites bash backend/scripts/run-suites.sh security-gate
else
  run_step architecture npm test
  run_step backend-typecheck npm --prefix backend run typecheck
  run_step backend-unit npm --prefix backend run test
  run_step audit-prod-root npm audit --omit=dev
  run_step audit-prod-backend npm --prefix backend audit --omit=dev
  run_step audit-advisories node backend/scripts/audit-allowlist.mjs
fi

# Always runs, in both modes and after any earlier failure: the secret scan is the step that
# answers "did a credential end up in a tracked file?".
run_step scan-secrets node backend/scripts/scan-secrets.mjs --blocking
run_isolation_check live-db-verify node backend/scripts/assert-live-db-untouched.mjs verify

report

if [ "$FAILED_COUNT" -ne 0 ]; then
  echo "GATE_FAILED: ${FAILED_COUNT} step(s) failed"
  exit 1
fi
echo 'GATE_PASSED (every step exit=0)'
