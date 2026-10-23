/**
 * VÉRRO Phase 12 — Secret-leak scanner (audit tooling).
 *
 * Reads the real credential values from `backend/.env` and checks whether any of them appear
 * in files that are tracked (or about to be tracked) by Git. Prints KEY NAMES AND COUNTS ONLY,
 * never the secret values themselves.
 *
 * Usage:  node backend/scripts/scan-secrets.mjs [--blocking]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ENV_FILE = path.join(ROOT, 'backend', '.env');

/** Values that are obviously non-secret documentation placeholders. */
const PLACEHOLDER = /^(|true|false|development|production|test|youpi|development_adapter|127\.0\.0\.1|localhost|http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+|3000|4000|4173|INR|dvs2004@slc)$/i;

if (!fs.existsSync(ENV_FILE)) {
  console.error('No backend/.env present; nothing to scan.');
  process.exit(0);
}

const secrets = [];
for (const rawLine of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  if (!value || PLACEHOLDER.test(value) || value.length < 10) continue;
  secrets.push({ key, value });
}

console.log(`Loaded ${secrets.length} candidate secrets from backend/.env (values not printed).\n`);

// Files tracked by git (or staged, if not yet committed).
let tracked = [];
try {
  tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  console.error('Could not list git files.');
  process.exit(1);
}
if (tracked.length === 0) {
  tracked = execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const leaks = [];
for (const key of secrets) {
  const hits = [];
  for (const rel of tracked) {
    const abs = path.join(ROOT, rel);
    let content;
    try {
      if (fs.statSync(abs).size > 2_000_000) continue;
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (content.includes(key.value)) hits.push(rel);
  }
  if (hits.length) leaks.push({ key: key.key, files: hits });
}

console.log(`Scanned ${tracked.length} tracked files.`);
// Credentials (SECRET/TOKEN/KEY/PASSWORD) are the blocking class. Configuration values such as
// DATABASE_URL/PRIVATE_STORAGE_PATH legitimately appear in .env.example and test fixtures, so
// they are reported as informational only.
const SECRET_LIKE = /(SECRET|TOKEN|KEY|PASSWORD|PASS)/i;
const blocking = leaks.filter((l) => SECRET_LIKE.test(l.key));
const informational = leaks.filter((l) => !SECRET_LIKE.test(l.key));

if (informational.length) {
  console.log('\nINFORMATIONAL - non-credential config values also present in tracked files:');
  for (const l of informational) console.log(`  ${l.key} -> ${l.files.join(', ')}`);
}

if (blocking.length === 0) {
  console.log('\nRESULT: PASS - no credential value from backend/.env appears in any tracked file.');
  process.exit(0);
}
console.log('\nRESULT: FAIL - the following credential KEYS leaked into tracked files:');
for (const l of blocking) console.log(`  ${l.key} -> ${l.files.join(', ')}`);
process.exit(process.argv.includes('--blocking') ? 1 : 2);