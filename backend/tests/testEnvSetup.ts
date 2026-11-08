/**
 * VÉRRO Commerce Backend — Test environment bootstrap.
 *
 * This module MUST be imported before anything that reads `config/env.ts`, because the
 * environment is resolved exactly once at module load. It exists so the fixture-route
 * safety gates (F-1) can be exercised deterministically in-process.
 *
 * It also isolates the unit suite from the development database (dedicated, gitignored
 * `verro_commerce.test.sqlite`, deleted on every run) and from the per-IP rate limiter.
 * Rate limiting itself is still verified end-to-end against a real process by
 * `tests/e2e-commerce.test.js`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.ENABLE_TEST_ROUTES = 'true';
process.env.TEST_FIXTURE_TOKEN = 'verro_test_fixture_token_9f2c41d7a0b3';
process.env.RATE_LIMIT_TEST_BYPASS = 'true';

/**
 * F-44: a per-run temporary directory, OUTSIDE the repository.
 *
 * The previous version placed `verro_commerce.test.sqlite` in the process working directory. That
 * is inside the repository whenever the runner starts in `backend/`, and the path is shared, so two
 * suites — or two runs, or a suite and a leftover server — could collide on one file. `mkdtempSync`
 * gives each run a directory nobody else holds, and `VERRO_TEST_DB_DIR` lets a parent harness hand
 * the same directory down to child processes.
 *
 * The isolation policy in `config/databaseIsolation.ts` enforces this from the other side: a test
 * process pointing DATABASE_URL anywhere else — at the developer database, or at any path inside
 * the repository — fails closed before the driver even opens the file.
 */
const testDatabaseDir =
  process.env.VERRO_TEST_DB_DIR?.trim() || fs.mkdtempSync(path.join(os.tmpdir(), 'verro-test-'));
fs.mkdirSync(testDatabaseDir, { recursive: true });
process.env.VERRO_TEST_DB_DIR = testDatabaseDir;

/** Dedicated, throwaway database so unit runs never touch development data. */
const testDatabasePath = path.join(testDatabaseDir, 'verro_commerce.test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(`${testDatabasePath}${suffix}`, { force: true });
  } catch {
    // Non-fatal: nothing to clean up yet.
  }
}
process.env.DATABASE_URL = testDatabasePath;
console.log(`[VÉRRO test] isolated database: ${testDatabasePath}`);

/**
 * Tracked cleanup. The database now lives outside the repository, so nothing else in the project
 * will ever collect it; without this, every run would leave an orphaned sqlite file behind in the
 * temporary root.
 */
process.on('exit', () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${testDatabasePath}${suffix}`, { force: true });
    } catch {
      // Best effort: a locked file must never change the exit status.
    }
  }
  try {
    fs.rmdirSync(testDatabaseDir);
  } catch {
    // Not empty (another process still holds it) or already removed.
  }
});
