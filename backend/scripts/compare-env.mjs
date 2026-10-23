/**
 * VÉRRO Phase 12 — Environment comparison (audit tooling).
 *
 * Compares `backend/.env` against the committed `backend/.env.example` to establish whether any
 * real credential value is duplicated into version control. Prints KEY NAMES, LENGTHS and
 * IDENTICAL/DIFFERENT FLAGS ONLY — never the values themselves.
 *
 * Usage:  node backend/scripts/compare-env.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');

function parseEnv(file) {
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key.length === 0) continue;
    out[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const real = parseEnv(path.join(BACKEND, '.env'));
const example = parseEnv(path.join(BACKEND, '.env.example'));

const SECRET_LIKE = /(SECRET|TOKEN|KEY|PASSWORD|PASS)/i;

console.log('--- secret-like keys in backend/.env (names/lengths only) ---');
for (const key of Object.keys(real)) {
  if (SECRET_LIKE.test(key)) console.log(`  ${key}  len=${String(real[key]).length}`);
}

const identical = Object.keys(real).filter((k) => k in example && real[k] === example[k]);
const different = Object.keys(real).filter((k) => k in example && real[k] !== example[k]);

console.log('\n--- keys in BOTH .env and .env.example with IDENTICAL value ---');
for (const k of identical) {
  console.log(`  ${k}  len=${String(real[k]).length}${SECRET_LIKE.test(k) ? '   <== SECRET-LIKE' : ''}`);
}

console.log('\n--- keys in BOTH with DIFFERENT value ---');
for (const k of different) console.log(`  ${k}`);

const leakingSecrets = identical.filter((k) => SECRET_LIKE.test(k));
console.log(`\nSecret-like values duplicated from .env into the committed .env.example: ${leakingSecrets.length}`);
process.exit(leakingSecrets.length === 0 ? 0 : 2);