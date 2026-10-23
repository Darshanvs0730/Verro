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
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.ENABLE_TEST_ROUTES = 'true';
process.env.TEST_FIXTURE_TOKEN = 'verro_test_fixture_token_9f2c41d7a0b3';
process.env.RATE_LIMIT_TEST_BYPASS = 'true';

/** Dedicated, throwaway database so unit runs never touch development data. */
const testDatabasePath = path.resolve(process.cwd(), 'verro_commerce.test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(`${testDatabasePath}${suffix}`, { force: true });
  } catch {
    // Non-fatal: nothing to clean up yet.
  }
}
process.env.DATABASE_URL = testDatabasePath;
