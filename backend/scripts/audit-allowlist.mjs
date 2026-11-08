/**
 * VÉRRO — dependency advisory allowlist gate (F-45).
 *
 * Before this, "accept the risk and document it" was the only alternative to a permanently red
 * gate, and the acceptance lived in prose — so the NEXT advisory in the same tree would have been
 * silently accepted too. This makes the acceptance mechanical and self-expiring:
 *
 *   - `npm audit --omit=dev` (the PRODUCTION surface) must be clean. No allowlist is involved.
 *   - the FULL audit (devDependencies included) may only contain advisories named in
 *     backend/scripts/audit-allowlist.json, matched on the GHSA id AND the package.
 *
 * Failure conditions: an advisory is not listed; the reported package SET differs from the
 * reviewed set; an entry has passed its expiry (so the decision is re-reviewed rather than rotting
 * in the tree); or the audit output cannot be parsed — an unverifiable result is a failure, never
 * a pass.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const ALLOWLIST_PATH = path.join(HERE, 'audit-allowlist.json');

function readAuditJson() {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    // `npm audit` exits 1 whenever advisories exist, so a non-zero status is expected and the
    // JSON is still on stdout. Anything else (network failure, missing lockfile) must NEVER be
    // mistaken for "no vulnerabilities".
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    if (stdout.trim().startsWith('{')) return stdout;
    throw new Error(`npm audit --json produced no parseable output (${error.message})`);
  }
}

const today = new Date().toISOString().slice(0, 10);
const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
const entries = Array.isArray(allowlist.entries) ? allowlist.entries : [];
const entryById = new Map(entries.map((entry) => [entry.advisoryId, entry]));

let audit;
try {
  audit = JSON.parse(readAuditJson());
} catch (error) {
  console.error(`ALLOWLIST-CHECK: FAIL — ${error.message}`);
  process.exit(1);
}

const vulnerabilities = audit.vulnerabilities || {};

// Group the report by ADVISORY. npm reports a vulnerability per PACKAGE: `serve` and
// `serve-handler` appear because they DEPEND on a vulnerable package, not because any advisory
// names them. Keying on the advisory id is what makes an allowlist meaningful — the advisory id is
// what carries a fixed version.
const advisories = new Map();
for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
  for (const via of vulnerability.via || []) {
    if (typeof via === 'string') continue;
    const advisoryId = (via.url || '').split('/').filter(Boolean).pop();
    if (!advisoryId) continue;
    const record = advisories.get(advisoryId) || {
      advisoryId,
      packageName: via.name,
      severity: via.severity,
      range: via.range,
      reportedUnder: []
    };
    if (!record.reportedUnder.includes(packageName)) record.reportedUnder.push(packageName);
    advisories.set(advisoryId, record);
  }
}

// ---- verdict ----
const problems = [];
const warnings = [];

if (audit.error) {
  problems.push(`npm audit reported an error, so the result cannot be trusted: ${JSON.stringify(audit.error)}`);
}

for (const record of advisories.values()) {
  const entry = entryById.get(record.advisoryId);
  if (!entry) {
    problems.push(
      `UNLISTED advisory ${record.advisoryId} (${record.packageName} ${record.range}, ${record.severity}) reported under: ${record.reportedUnder.join(', ')}`
    );
    continue;
  }
  if (entry.package !== record.packageName) {
    problems.push(
      `Advisory ${record.advisoryId} is now reported against package "${record.packageName}" but the allowlist describes "${entry.package}"`
    );
  }
}

// Expiry is checked for EVERY entry, used or not: an entry that no longer matches anything is a
// warning, but an EXPIRED entry fails the gate even when nothing is currently vulnerable, so an
// acceptance can never outlive its review.
for (const entry of entries) {
  if (entry.expiresOn < today) {
    problems.push(`EXPIRED allowlist entry ${entry.advisoryId} (${entry.package}) expired on ${entry.expiresOn}`);
  }
  if (!advisories.has(entry.advisoryId)) {
    warnings.push(`STALE allowlist entry ${entry.advisoryId} (${entry.package}) — not currently reported; remove it`);
  }
}

const reportedPackages = Object.keys(vulnerabilities).sort();
const expectedPackages = Array.isArray(allowlist.expectedReportedPackages)
  ? [...allowlist.expectedReportedPackages].sort()
  : [];
if (expectedPackages.length > 0 && JSON.stringify(expectedPackages) !== JSON.stringify(reportedPackages)) {
  problems.push(
    `Reported package set changed — expected [${expectedPackages.join(', ')}] but npm reported [${reportedPackages.join(', ')}]`
  );
}

console.log('ALLOWLIST-CHECK: root package, full audit (devDependencies included)');
console.log(`  date: ${today}`);
console.log(`  allowlist: ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
if (advisories.size === 0) {
  console.log('  no advisories reported — nothing to allow');
}
for (const record of advisories.values()) {
  const entry = entryById.get(record.advisoryId);
  const status = !entry
    ? 'UNLISTED -> FAIL'
    : entry.expiresOn < today
      ? `EXPIRED ${entry.expiresOn} -> FAIL`
      : `allowed until ${entry.expiresOn}`;
  console.log(`  [${record.severity}] ${record.advisoryId} ${record.packageName} ${record.range} — ${status}`);
  console.log(`      reported under: ${record.reportedUnder.join(', ')}`);
}
for (const warning of warnings) {
  console.log(`  WARN: ${warning}`);
}

if (problems.length > 0) {
  console.error('ALLOWLIST-CHECK: FAIL');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error('  Either fix/remove the dependency, or add the advisory to the allowlist with a reason and an expiry (<= 60 days).');
  process.exit(1);
}

console.log(`ALLOWLIST-CHECK: PASS (${advisories.size} advisory/advisories, all reviewed)`);

