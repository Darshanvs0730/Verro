/**
 * VÉRRO Phase 12 — Live Database Backup & Verification Tool
 *
 * Produces a CONSISTENT snapshot of the live SQLite database (including any content still
 * resident in the hot WAL) via `VACUUM INTO`, then verifies the snapshot by reopening it and
 * comparing row counts and schema against the live source.
 *
 * A plain byte copy of `*.sqlite` is NOT sufficient here: `database.ts` enables WAL, and the
 * live server holds a ~1.4 MB hot WAL, so the committed `-wal` sidecar contains data that is
 * not in the main database file. `VACUUM INTO` writes a single self-contained file.
 *
 * Read-only against the source. Never writes to the live database.
 * Usage:  node qa-artifacts/tools/backup-live-db.mjs
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LIVE_DB = path.join(ROOT, 'backend', 'verro_commerce.sqlite');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(ROOT, 'qa-artifacts', `db-backup-${STAMP}`);
const EXTERNAL_DIR = path.join(process.env.HOME, 'verro-db-backups', STAMP);

const REPORT = { stamp: STAMP, liveDatabase: LIVE_DB, snapshots: [], byteCopies: [], live: null, external: EXTERNAL_DIR };

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inventory(db) {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY status`).all();
  return {
    tables,
    totalOrders: db.prepare(`SELECT COUNT(*) AS n FROM orders`).get().n,
    byStatus,
    paid: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'`).get().n,
    fulfilled: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE fulfilled_at IS NOT NULL`).get().n,
    withRef: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE payment_reference IS NOT NULL`).get().n,
    newestOrder: db.prepare(`SELECT MAX(created_at) AS t FROM orders`).get().t
  };
}

function countSafe(db, table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } catch {
    return null;
  }
}

console.log('=== VÉRRO live database backup ===');
if (!fs.existsSync(LIVE_DB)) {
  console.error(`FATAL: live database not found at ${LIVE_DB}`);
  process.exit(1);
}
console.log(`Source: ${LIVE_DB} (${fs.statSync(LIVE_DB).size} bytes)`);
for (const s of ['-wal', '-shm']) {
  const p = `${LIVE_DB}${s}`;
  if (fs.existsSync(p)) console.log(`Sidecar: ${p} (${fs.statSync(p).size} bytes)`);
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(EXTERNAL_DIR, { recursive: true });

// ---- 1. Read the live database (read-only) and capture its authoritative inventory ----
const live = new Database(LIVE_DB, { readonly: true });
REPORT.live = inventory(live);
console.log('\nLive inventory:', JSON.stringify(REPORT.live, null, 2));

// ---- 2. Consistent snapshot via VACUUM INTO (includes hot WAL content) ----
const snapshotPath = path.join(ARTIFACT_DIR, `verro_commerce.live-snapshot-${STAMP}.sqlite`);
const source = new Database(LIVE_DB);
source.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
source.close();
live.close();

const snapVerify = new Database(snapshotPath, { readonly: true });
const integrity = snapVerify.pragma('integrity_check');
const snapInv = inventory(snapVerify);
const snapFk = snapVerify.pragma('foreign_key_check');
REPORT.snapshots.push({
  path: snapshotPath,
  sizeBytes: fs.statSync(snapshotPath).size,
  sha256: sha256(snapshotPath),
  integrityCheck: integrity,
  foreignKeyViolations: snapFk.length,
  inventory: snapInv
});
snapVerify.close();

console.log('\n--- Snapshot ---');
console.log(`  ${snapshotPath}`);
console.log(`  size=${REPORT.snapshots[0].sizeBytes} sha256=${REPORT.snapshots[0].sha256}`);
console.log(`  integrity_check=${JSON.stringify(integrity)} foreign_key_violations=${snapFk.length}`);
console.log(`  orders=${snapInv.totalOrders} paid=${snapInv.paid} fulfilled=${snapInv.fulfilled}`);

// ---- 3. Byte copy of the live file + WAL/SHM sidecars, into the repo and off-repo ----
for (const target of [
  { dir: path.join(ARTIFACT_DIR, 'bytecopy'), label: 'repo-artifact' },
  { dir: path.join(EXTERNAL_DIR, 'bytecopy'), label: 'external' }
]) {
  fs.mkdirSync(target.dir, { recursive: true });
  const copied = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${LIVE_DB}${suffix}`;
    if (!fs.existsSync(from)) continue;
    const to = path.join(target.dir, path.basename(from));
    fs.copyFileSync(from, to);
    copied.push({ file: path.basename(to), sizeBytes: fs.statSync(to).size, sha256: sha256(to) });
  }
  REPORT.byteCopies.push({ label: target.label, dir: target.dir, files: copied });
  console.log(`\n--- Byte copy (${target.label}) --- ${target.dir}`);
  for (const f of copied) console.log(`  ${f.file} (${f.sizeBytes} bytes)`);
}

// ---- 4. Off-repo copy of the consistent snapshot (authoritative recovery point) ----
const externalSnapshot = path.join(EXTERNAL_DIR, path.basename(snapshotPath));
fs.copyFileSync(snapshotPath, externalSnapshot);
REPORT.externalSnapshot = { path: externalSnapshot, sha256: sha256(externalSnapshot) };
console.log(`\n--- Off-repo snapshot ---\n  ${externalSnapshot}`);

// ---- 5. Full table-level parity check: snapshot vs live, every table ----
const parity = [];
for (const t of REPORT.live.tables) {
  const liveReopen = new Database(LIVE_DB, { readonly: true });
  const snapReopen = new Database(snapshotPath, { readonly: true });
  const a = countSafe(liveReopen, t);
  const b = countSafe(snapReopen, t);
  liveReopen.close();
  snapReopen.close();
  parity.push({ table: t, live: a, snapshot: b, match: a === b });
}
REPORT.parity = parity;
console.log('\n--- Table parity (live vs snapshot) ---');
for (const p of parity) console.log(`  ${p.match ? 'OK  ' : 'FAIL'} ${p.table}: live=${p.live} snapshot=${p.snapshot}`);

const parityOk = parity.every((p) => p.match);
const integrityOk = integrity.length === 1 && integrity[0]?.integrity_check === 'ok';
REPORT.verified = parityOk && integrityOk && snapFk.length === 0 && snapInv.totalOrders === REPORT.live.totalOrders;
REPORT.reportPath = path.join(ARTIFACT_DIR, 'backup-report.json');
fs.writeFileSync(REPORT.reportPath, JSON.stringify(REPORT, null, 2));
console.log(`\nVERIFIED: ${REPORT.verified ? 'YES' : 'NO'}`);
console.log(`Report: ${REPORT.reportPath}`);
process.exit(REPORT.verified ? 0 : 1);