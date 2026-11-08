// Read-only parity check: live developer database vs the pre-remediation snapshot.
import Database from 'better-sqlite3';

const live = new Database('verro_commerce.sqlite', { readonly: true });
const snap = new Database(
  '../qa-artifacts/db-backup-2026-10-23T07-13-01-013Z/verro_commerce.live-snapshot-2026-10-23T07-13-01-013Z.sqlite',
  { readonly: true }
);

const tables = ['orders', 'payment_attempts', 'audit_logs', 'download_grants', 'notification_dispatches', 'idempotency_records'];
for (const table of tables) {
  let liveCount = 'n/a';
  let snapCount = 'n/a';
  try {
    liveCount = live.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  } catch {}
  try {
    snapCount = snap.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  } catch {}
  console.log(`${table}: live=${liveCount} snapshot=${snapCount}`);
}

const liveRows = live.prepare('SELECT * FROM orders ORDER BY id').all();
const snapRows = snap.prepare('SELECT * FROM orders ORDER BY id').all();

// Compare on the columns BOTH schemas share. F-40 explicitly permits additive migrations (the
// snapshot predates the `payment_session_id` column), so a new column must not be reported as a
// rewritten developer row, and a rewritten value must not be hidden behind one.
const liveColumns = Object.keys(liveRows[0] || {});
const snapshotColumns = Object.keys(snapRows[0] || {});
const sharedColumns = snapshotColumns.filter((column) => liveColumns.includes(column));
const columnsAddedByMigration = liveColumns.filter((column) => !snapshotColumns.includes(column));
const fingerprint = (row) => JSON.stringify(sharedColumns.map((column) => row[column]));

// Two indexes: the "added" and "modified" counts must each be resolved against the SNAPSHOT,
// never against the live set. Resolving `added` against the live map made it structurally
// unreachable (a live row is always present in the live map), so the check reported
// `added-by-test-runs=0` no matter how much fixture data leaked into the developer database.
const liveById = new Map(liveRows.map((row) => [row.id, row]));
const snapshotById = new Map(snapRows.map((row) => [row.id, row]));

const missing = snapRows.filter((row) => !liveById.has(row.id)).length;
const added = liveRows.filter((row) => !snapshotById.has(row.id)).length;
const modified = snapRows.filter((row) => {
  const current = liveById.get(row.id);
  return current !== undefined && fingerprint(current) !== fingerprint(row);
}).length;

console.log(
  `orders parity: pre-existing rows missing=${missing}, modified=${modified}, added-by-test-runs=${added} (snapshot=${snapRows.length}, live=${liveRows.length})`
);
if (columnsAddedByMigration.length > 0) {
  console.log(
    `orders columns added by migration (not counted as changes): ${columnsAddedByMigration.join(', ')}`
  );
}
if (added > 0) {
  const byEmail = new Map();
  for (const row of liveRows) {
    if (!snapshotById.has(row.id)) {
      byEmail.set(row.customer_email, (byEmail.get(row.customer_email) || 0) + 1);
    }
  }
  const breakdown = [...byEmail.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([email, count]) => `${email}=${count}`)
    .join(', ');
  console.log(`added rows by customer_email: ${breakdown}`);
}

live.close();
snap.close();

// Pre-existing developer rows may never be removed or rewritten. Rows ADDED by test runs are
// reported (above) but do not fail the check: the fix is that no new ones can appear.
if (missing > 0 || modified > 0) {
  console.error('FAIL: pre-existing developer rows were removed or rewritten');
  process.exit(1);
}
