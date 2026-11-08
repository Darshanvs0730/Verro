#!/usr/bin/env bash
# VÉRRO Phase 12 — baseline / post-fix test execution harness.
#
# Runs every project suite plus typecheck and dependency audit, writing an individual log per
# suite and a machine-readable summary line per suite. Used to capture the PRE-fix baseline and,
# later, the POST-fix result with the identical harness so the two are directly comparable.
#
# Usage:  bash backend/scripts/run-suites.sh [label]
set -u

LABEL="${1:-baseline}"
FAILED_SUITES=()
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
OUT="qa-artifacts/${LABEL}"
mkdir -p "$OUT"
: > "$OUT/summary.txt"

run() {
  local name="$1"; shift
  echo "=============================================================="
  echo "### ${name}"
  echo "### cmd: $*"
  local start end code
  start=$(date +%s)
  "$@" > "$OUT/${name}.log" 2>&1
  code=$?
  end=$(date +%s)
  echo "### exit=${code} duration=$((end - start))s"
  tail -n 14 "$OUT/${name}.log"
  echo "${name} exit=${code} duration=$((end - start))s" >> "$OUT/summary.txt"
  [ "$code" -ne 0 ] && FAILED_SUITES+=("$name")
  return 0
}

# ---------------------------------------------------------------------------------------------
# F-44: the Phase 6 viewport suite asserts the commerce lifecycle (payment_pending), which needs a
# live backend on :4000. It used to be reported as "PASS" by hand regardless of what happened, and
# its QA 8 check printed "FAIL" — silently — whenever no backend was running. The step below now
# starts its own ISOLATED backend (throwaway sqlite, never the live database) plus the static
# storefront, records the real exit code, and tears both down afterwards.
# ---------------------------------------------------------------------------------------------
VIEWPORT_BACKEND_PID=""
VIEWPORT_STORE_PID=""
VIEWPORT_BACKEND_LISTENER=""
VIEWPORT_STORE_LISTENER=""
# F-44: the suite database is a per-run temporary directory OUTSIDE the repository, created with
# mktemp and removed on teardown. It used to be backend/verro_commerce.suite.sqlite — a fixed path
# inside the working tree that a concurrent or leftover run could collide with.
VIEWPORT_DB_DIR=""
VIEWPORT_DB=""
# Supply chain: `serve` is an EXACT-pinned devDependency (14.2.6). It is resolved from the local
# install so the harness never downloads and executes an unpinned registry version at run time.
STOREFRONT_SERVE_BIN="$REPO_ROOT/node_modules/.bin/serve"

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

# F-44: create the throwaway database directory for the viewport step. Idempotent, because the
# teardown trap may run before it was ever called.
prepare_viewport_db_dir() {
  [ -n "$VIEWPORT_DB_DIR" ] && return 0
  VIEWPORT_DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verro-suite-XXXXXX")" || return 1
  VIEWPORT_DB="$VIEWPORT_DB_DIR/verro_commerce.suite.sqlite"
  export VERRO_TEST_DB_DIR="$VIEWPORT_DB_DIR"
  return 0
}

# Kill a process and its children (tsx spawns an inner server child that otherwise survives and
# keeps the port bound, which would break the next run).
stop_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  kill -TERM "$pid" 2>/dev/null
  pkill -TERM -P "$pid" 2>/dev/null
  sleep 1
  pkill -KILL -P "$pid" 2>/dev/null
  kill -KILL "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  return 0
}

# Only processes THIS script started are stopped — a backend/storefront the operator launched
# themselves is left running (their PIDs never enter VIEWPORT_*_PID).
#
# `serve` and `tsx` both spawn a grandchild that actually holds the port, so the PID we
# launched is complemented by the listener PID observed while the port was OURS (captured right
# after readiness below). Without this, an orphaned `serve` kept :4173 bound after teardown.
teardown_viewport_servers() {
  for pid in "$VIEWPORT_BACKEND_LISTENER" "$VIEWPORT_STORE_LISTENER"; do
    [ -n "$pid" ] || continue
    kill -TERM "$pid" 2>/dev/null
    sleep 1
    kill -KILL "$pid" 2>/dev/null
  done
  stop_tree "$VIEWPORT_BACKEND_PID"
  stop_tree "$VIEWPORT_STORE_PID"
  # F-44: remove the per-run temporary database directory. Nothing inside the repository is deleted.
  if [ -n "$VIEWPORT_DB_DIR" ] && [ -d "$VIEWPORT_DB_DIR" ]; then
    rm -rf "$VIEWPORT_DB_DIR"
    VIEWPORT_DB_DIR=""
    VIEWPORT_DB=""
  fi
  VIEWPORT_BACKEND_PID=""
  VIEWPORT_STORE_PID=""
  VIEWPORT_BACKEND_LISTENER=""
  VIEWPORT_STORE_LISTENER=""
}
trap teardown_viewport_servers EXIT

# First PID listening on a port, used to reclaim a port this script owns.
listener_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1
}

wait_for_http() {
  local url="$1" attempts="$2" i=0
  while [ "$i" -lt "$attempts" ]; do
    if curl -fsS -o /dev/null --max-time 2 "$url"; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

run_viewport() {
  local name="viewport" start end code backend_ready storefront_ready
  echo "=============================================================="
  echo "### ${name}"
  start=$(date +%s)

  if port_in_use 4000; then
    # F-44: this step used to REUSE whatever was listening on :4000 and assert QA 8 against it.
    # If that listener is the operator's development backend it is bound to the developer
    # database, and this step drives a real order lifecycle through it. A gate must never write
    # to real data, so a port this script did not claim is now a hard failure.
    echo "### :4000 is already in use — refusing to drive QA 8 against a backend this harness did not start"
    echo "### stop that process (or free the port) and re-run"
    backend_ready=0
  elif ! prepare_viewport_db_dir; then
    echo "### could not create a temporary database directory under ${TMPDIR:-/tmp}"
    backend_ready=0
  else
    NODE_ENV=test \
      PORT=4000 \
      HOST=127.0.0.1 \
      DATABASE_URL="$VIEWPORT_DB" \
      ENABLE_TEST_ROUTES=true \
      TEST_FIXTURE_TOKEN="suite_$(date +%s)_viewport_fixture_token" \
      WEBHOOK_SECRET="suite_$(date +%s)_viewport_webhook_secret_value" \
      RATE_LIMIT_TEST_BYPASS=true \
      "$REPO_ROOT/backend/node_modules/.bin/tsx" "$REPO_ROOT/backend/src/app/server.ts" \
      > "$OUT/viewport-backend.log" 2>&1 &
    VIEWPORT_BACKEND_PID=$!
    if wait_for_http "http://127.0.0.1:4000/health" 45; then
      backend_ready=1
      VIEWPORT_BACKEND_LISTENER="$(listener_pid 4000)"
      echo "### isolated backend ready (db: ${VIEWPORT_DB})"
    else
      backend_ready=0
      echo "### isolated backend FAILED to start — see ${OUT}/viewport-backend.log"
      tail -n 20 "$OUT/viewport-backend.log"
    fi
  fi

  if port_in_use 4173; then
    echo "### :4173 already in use — reusing the running storefront (verify it serves THIS working tree)"
    echo "###   its bind address: $(lsof -nP -iTCP:4173 -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $9}')"
    storefront_ready=1
  elif [ ! -x "$STOREFRONT_SERVE_BIN" ]; then
    echo "### storefront NOT started: $STOREFRONT_SERVE_BIN is missing."
    echo "### serve is an exact-pinned devDependency — run 'npm ci' at $REPO_ROOT."
    echo "### This harness never downloads packages at test time."
    storefront_ready=0
  else
    # Loopback-only bind (F-44 hardening): the storefront serves the whole working tree by design,
    # so it must never be reachable from the LAN.
    ( cd "$REPO_ROOT" && "$STOREFRONT_SERVE_BIN" . -l tcp://127.0.0.1:4173 > "$OUT/viewport-storefront.log" 2>&1 ) &
    VIEWPORT_STORE_PID=$!
    if wait_for_http "http://127.0.0.1:4173/" 90; then
      storefront_ready=1
      VIEWPORT_STORE_LISTENER="$(listener_pid 4173)"
      echo "### storefront ready on :4173"
    else
      storefront_ready=0
      echo "### storefront FAILED to start — see ${OUT}/viewport-storefront.log"
      tail -n 20 "$OUT/viewport-storefront.log"
    fi
  fi

  if [ "$storefront_ready" -eq 1 ]; then
    npm run test:viewport > "$OUT/${name}.log" 2>&1
    code=$?
  else
    echo "viewport exit=1 duration=0s (storefront unreachable; suite could not run)" > "$OUT/${name}.log"
    code=1
  fi

  end=$(date +%s)
  echo "### exit=${code} duration=$((end - start))s (backend reachable for QA 8: $([ "$backend_ready" -eq 1 ] && echo yes || echo no))"
  tail -n 14 "$OUT/${name}.log"
  echo "${name} exit=${code} duration=$((end - start))s" >> "$OUT/summary.txt"
  [ "$code" -ne 0 ] && FAILED_SUITES+=("$name")

  teardown_viewport_servers
}

run architecture        npm test
run backend-unit        npm --prefix backend run test
run backend-typecheck   npm --prefix backend run typecheck
run e2e                 npm run test:e2e
run_viewport
# F-45 (supply chain): the PRODUCTION surface must audit completely clean — no allowlist is
# consulted, so any production-tree advisory fails the gate outright. The FULL audit may contain
# only advisories explicitly reviewed in backend/scripts/audit-allowlist.json, each with a reason
# and an expiry; an unlisted, newly-affected or expired one fails the gate.
run audit-prod-root     npm audit --omit=dev
run audit-prod-backend  npm --prefix backend audit --omit=dev
run audit-advisories    node backend/scripts/audit-allowlist.mjs

teardown_viewport_servers

echo
echo "===================== SUMMARY (${LABEL}) ====================="
cat "$OUT/summary.txt"

# F-44 (harness half): a suite that failed must make the HARNESS fail. Recording the per-suite
# exit codes is not enough if the harness itself always exits 0, because automation that reads
# only the harness status would treat a red run as green. This is the same defect class as the
# viewport step reporting PASS by hand.
if [ "${#FAILED_SUITES[@]}" -gt 0 ]; then
  echo "SUITES-FAILED: ${FAILED_SUITES[*]}" | tee -a "$OUT/summary.txt"
  exit 1
fi
echo "SUITES-FINISHED (all suites exit=0)"