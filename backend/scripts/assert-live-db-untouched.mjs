/**
 * VÉRRO — live database untouched assertion (Phase 1, P1-5).
 *
 * A test run that writes to the developer database is the failure mode this whole phase exists to
 * prevent. `database.ts` now refuses such a target outright (F-44), but a guard can be bypassed by
 * a script that opens the file itself, so the gate also asserts the OUTCOME: the file did not
 * change.
 *
 *   node backend/scripts/assert-live-db-untouched.mjs record [--state <file>]
 *   node backend/scripts/assert-live-db-untouched.mjs verify [--state <file>]
 *
 * Only sha256 digests and row COUNTS are recorded — never row contents, never PII — and the state
 * file defaults to the git-ignored `qa-artifacts/security-final/live-db-state.json`, so evidence
 * stays out of version control.
 *
 * STRICT vs ADVISORY
 *   strict   : `verro_commerce.sqlite` and `-wal` digests, plus every table's row count
 *   advisory : `-shm` (a transient shared-memory index; a read-only open may legitimately touch it)
 * A changed sidecar-only file is reported, but only the strict comparisons can fail the gate.
 *
 * The assertion is meaningful only while no legitimate writer (a running dev backend) is active.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LIVE_DB = path.join(ROOT, 'backend', 'verro_commerce.sqlite');
const DEFAULT_STATE = path.join(ROOT, 'qa-artifacts', 'security-final', 'live-db-state.json');
const TABLES = ['orders', 'payment_attempts', 'audit_logs', 'download_grants', 'notification_dispatches', 'idempotency_records'];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Digests for the main file and its sidecars. Missing sidecars are recorded as absent. */
function digests() {
  const out = {};
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${LIVE_DB}${suffix}`;
    out[suffix || 'main'] = fs.existsSync(file)
      ? { bytes: fs.statSync(file).size, sha256: sha256(file) }
      : { bytes: null, sha256: null };
  }
  return out;
}

/** Row counts read through a READ-ONLY handle, so the snapshot cannot itself write. */
async function rowCounts() {
  // Absent in a clean checkout and in CI: there is no developer database to protect there, and the
  // assertion then guards the absence instead (see compare()).
  if (!fs.existsSync(LIVE_DB)) return {};
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    for (const table of TABLES) {
      try {
        counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
      } catch {
        counts[table] = null;
      }
    }
  } finally {
    db.close();
  }
  return counts;
}

async function snapshot() {
  return {
    capturedAtUtc: new Date().toISOString(),
    liveDatabase: LIVE_DB,
    present: fs.existsSync(LIVE_DB),
    digests: digests(),
    rowCounts: await rowCounts()
  };
}

function parseArgs(argv) {
  const command = argv[2];
  const stateIndex = argv.indexOf('--state');
  return {
    command,
    stateFile: stateIndex !== -1 && argv[stateIndex + 1] ? path.resolve(argv[stateIndex + 1]) : DEFAULT_STATE
  };
}

function compare(before, after) {
  const failures = [];
  const advisories = [];

  if (before.present !== after.present) {
    return {
      failures: [`live database presence changed: ${before.present} -> ${after.present}`],
      advisories
    };
  }
  if (!after.present) {
    advisories.push('live database absent in this environment — absence verified, nothing to compare');
    return { failures, advisories };
  }

  for (const name of ['main', '-wal']) {
    const a = before.digests[name];
    const b = after.digests[name];
    if (a?.sha256 !== b?.sha256) {
      failures.push(`${name}: ${a?.sha256 ?? 'absent'} -> ${b?.sha256 ?? 'absent'}`);
    }
  }

  const shmBefore = before.digests['-shm']?.sha256;
  const shmAfter = after.digests['-shm']?.sha256;
  if (shmBefore !== shmAfter) {
    advisories.push(`-shm digest changed (advisory): ${shmBefore ?? 'absent'} -> ${shmAfter ?? 'absent'}`);
  }

  for (const table of TABLES) {
    const a = before.rowCounts[table];
    const b = after.rowCounts[table];
    if (a !== b) failures.push(`${table}: ${a} rows -> ${b} rows`);
  }

  return { failures, advisories };
}

const { command, stateFile } = parseArgs(process.argv);

if (command === 'record') {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const state = await snapshot();
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`recorded: ${stateFile}`);
  if (!state.present) {
    console.log('  live database absent in this environment — absence recorded');
  } else {
    console.log(`  main sha256 ${state.digests.main.sha256} (${state.digests.main.bytes} bytes)`);
    console.log(`  rows ${TABLES.map((t) => `${t}=${state.rowCounts[t]}`).join(' ')}`);
  }
  process.exit(0);
}

if (command === 'verify') {
  if (!fs.existsSync(stateFile)) {
    console.error(`FATAL: no recorded state at ${stateFile} — run the "record" command first.`);
    process.exit(2);
  }
  const before = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const after = await snapshot();
  const { failures, advisories } = compare(before, after);

  for (const note of advisories) console.warn(`  WARN ${note}`);

  if (failures.length > 0) {
    console.error('FAIL: the live database changed during the run:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('\nA test run must never write to the developer database (F-44).');
    process.exit(1);
  }

  if (!after.present) {
    console.log('PASS: live database still absent in this environment — nothing was created');
    process.exit(0);
  }
  console.log(`PASS: live database unchanged (${after.digests.main.bytes} bytes, ${after.digests.main.sha256})`);
  console.log(`  orders=${after.rowCounts.orders} payment_attempts=${after.rowCounts.payment_attempts} audit_logs=${after.rowCounts.audit_logs}`);
  process.exit(0);
}

console.error('Usage: node backend/scripts/assert-live-db-untouched.mjs <record|verify> [--state <file>]');
process.exit(2);