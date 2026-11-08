/**
 * VÉRRO Commerce Backend — Database isolation policy (F-44).
 *
 * WHY THIS EXISTS
 * A routine test run once appended 65 fixture rows to the developer database. The mechanism was
 * not a missing test fixture but an ambiguous configuration: `backend/.env` ships a RELATIVE
 * `DATABASE_URL`, and a relative value was passed to better-sqlite3 verbatim, so SQLite resolved
 * it against `process.cwd()`. Anything started with cwd=`backend/` opened the developer
 * database; the same code started one directory higher opened an unrelated, empty file.
 *
 * `resolveDatabaseTarget()` in `config/env.ts` removes the ambiguity for DEVELOPMENT. This module
 * answers the separate, more important question — is the resolved target ALLOWED for the
 * environment we are running in? — and it answers it as a PURE function so the rule can be
 * unit tested without touching a database or spawning a process.
 *
 * THE INVARIANT
 *   1. A test process may NEVER open the developer/production database.
 *   2. A test process may NEVER write a database inside the repository tree.
 *   3. A test database lives in the temporary root (or an explicitly configured directory
 *      outside the repository).
 *   4. A non-test process may NEVER open a database that lives in the temporary root, because
 *      that is a test artifact that leaked into development or production configuration.
 *
 * FAIL-CLOSED: `repositories/database.ts` calls the function below BEFORE constructing the
 * driver and terminates the process when the verdict is not ok. There is no warning-only mode.
 */

import os from 'node:os';
import path from 'node:path';

import { canonicalPath, isPathInside } from './paths.js';

export type DatabaseIsolationCode =
  | 'TEST_DB_IS_LIVE_DATABASE'
  | 'TEST_DB_INSIDE_REPOSITORY'
  | 'TEST_DB_OUTSIDE_TEMPORARY_ROOT'
  | 'NON_TEST_DB_IS_TEMPORARY';

export interface DatabaseIsolationTarget {
  /** Absolute path that the driver is about to open. */
  databasePath: string;
  /** Effective `NODE_ENV`. Only the exact string "test" enables test-mode rules. */
  nodeEnv: string;
  /** Absolute repository root. Test writes are never allowed inside this tree. */
  repoRoot: string;
  /** The developer/production database file. */
  liveDatabasePath: string;
  /** Temporary root. Defaults to `os.tmpdir()`. */
  temporaryRoot?: string;
  /** Explicit override supplied by a harness through `VERRO_TEST_DB_DIR`. */
  testDatabaseDir?: string;
}

export interface DatabaseIsolationVerdict {
  ok: boolean;
  code?: DatabaseIsolationCode;
  message?: string;
}

export function evaluateDatabaseIsolation(target: DatabaseIsolationTarget): DatabaseIsolationVerdict {
  const temporaryRoot = target.temporaryRoot?.trim() || os.tmpdir();
  const isTestMode = target.nodeEnv === 'test';

  if (isTestMode) {
    if (canonicalPath(target.databasePath) === canonicalPath(target.liveDatabasePath)) {
      return {
        ok: false,
        code: 'TEST_DB_IS_LIVE_DATABASE',
        message:
          `a test run must never open the developer database (${target.liveDatabasePath}). ` +
          'Point DATABASE_URL at a throwaway file inside the temporary directory, or import ' +
          'tests/testEnvSetup.ts before anything that reads config/env.ts.'
      };
    }

    if (isPathInside(target.databasePath, target.repoRoot)) {
      return {
        ok: false,
        code: 'TEST_DB_INSIDE_REPOSITORY',
        message:
          `a test database must not live inside the repository (${target.repoRoot}); ` +
          `refusing ${target.databasePath}. Use fs.mkdtempSync(path.join(os.tmpdir(), ...)).`
      };
    }

    const allowedRoot = target.testDatabaseDir?.trim() || temporaryRoot;
    if (!isPathInside(target.databasePath, allowedRoot)) {
      return {
        ok: false,
        code: 'TEST_DB_OUTSIDE_TEMPORARY_ROOT',
        message:
          `a test database must live under the temporary root (${path.resolve(temporaryRoot)}) ` +
          `or under VERRO_TEST_DB_DIR; refusing ${target.databasePath}.`
      };
    }

    return { ok: true };
  }

  if (isPathInside(target.databasePath, temporaryRoot)) {
    return {
      ok: false,
      code: 'NON_TEST_DB_IS_TEMPORARY',
      message:
        `a ${target.nodeEnv} process must not use a database inside the temporary root ` +
        `(${path.resolve(temporaryRoot)}); refusing ${target.databasePath}. ` +
        'A test artifact has leaked into this configuration — fix DATABASE_URL.'
    };
  }

  return { ok: true };
}