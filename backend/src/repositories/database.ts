/**
 * VÉRRO Commerce Backend — Database Initialization & Connection
 * Uses SQLite with PostgreSQL-compatible schema and syntax.
 */

import Database from 'better-sqlite3';
import { env } from '../config/env.js';
import { evaluateDatabaseIsolation } from '../config/databaseIsolation.js';
import type { DatabaseIsolationVerdict } from '../config/databaseIsolation.js';

let dbInstance: Database.Database | null = null;

/**
 * F-44 (fail-closed): decide whether the configured database is ALLOWED for this environment
 * BEFORE the driver is constructed. Exported so a regression test can assert the verdict without
 * having to terminate the whole test process.
 */
export function checkDatabaseTarget(): DatabaseIsolationVerdict {
  return evaluateDatabaseIsolation({
    databasePath: env.databaseUrl,
    nodeEnv: env.nodeEnv,
    repoRoot: env.repoRoot,
    liveDatabasePath: env.liveDatabasePath,
    testDatabaseDir: env.testDatabaseDir
  });
}

/**
 * Terminates the process when the configured database is not allowed.
 * There is deliberately no warning-only mode: a mis-pointed run would otherwise corrupt the
 * developer database silently, which is exactly the defect this guard exists to prevent.
 */
function assertDatabaseTarget(): void {
  const verdict = checkDatabaseTarget();
  if (verdict.ok) return;

  console.error('==================================================');
  console.error('[VÉRRO db-guard] FATAL: refusing to open the database.');
  console.error(`  target  : ${env.databaseUrl}`);
  console.error(`  NODE_ENV: ${env.nodeEnv}`);
  console.error(`  reason  : ${verdict.code}`);
  console.error(`  detail  : ${verdict.message}`);
  console.error('==================================================');
  process.exit(1);
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    // F-44: must run before `new Database(...)` — opening the file is the write.
    assertDatabaseTarget();

    dbInstance = new Database(env.databaseUrl);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    // Concurrency: WAL permits one writer alongside many readers, but a writer that finds the
    // write lock already held used to fail instantly (SQLITE_BUSY). Two webhook deliveries for
    // the same order could therefore drop a state transition. Wait for the lock instead.
    dbInstance.pragma('busy_timeout = 5000');
    initSchema(dbInstance);
  }
  return dbInstance;
}

/**
 * Initialize PostgreSQL-compatible database schema
 * @param db 
 */
function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      customer_email TEXT,
      payment_reference TEXT,
      idempotency_key TEXT UNIQUE,
      customer_token_hash TEXT,
      request_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT,
      fulfilled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_reference ON orders(payment_reference);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  `);

  // Safe progressive migration for existing sqlite databases.
  // Each statement is isolated so one pre-existing column never blocks the others.
  for (const migration of [
    `ALTER TABLE orders ADD COLUMN customer_token_hash TEXT;`,
    // F-3: binds an idempotency key to the exact request payload that created it.
    `ALTER TABLE orders ADD COLUMN request_fingerprint TEXT;`,
    // F-20: server-persisted gateway session identity. Reconciliation reads this column
    // instead of any client-supplied reference, so live rows created before this
    // migration simply keep it NULL and are reconciled by gateway webhook only.
    `ALTER TABLE orders ADD COLUMN payment_session_id TEXT;`
  ]) {
    try {
      db.exec(migration);
    } catch {
      // Column already exists
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_token_hash ON orders(customer_token_hash);

    CREATE INDEX IF NOT EXISTS idx_orders_payment_session ON orders(payment_session_id);

    -- F-41: single-use download authorization grants. A minted download token is recorded
    -- here by SHA-256 digest and may be claimed exactly once, so a leaked URL is not a
    -- permanent, replayable capability for the duration of its TTL.
    CREATE TABLE IF NOT EXISTS download_grants (
      token_hash TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      package_filename TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_download_grants_order ON download_grants(order_id);

    -- F-41: idempotent notification ledger. One row per (template, order) dispatch decision,
    -- so a retry or a scripted loop can never double-send customer email.
    CREATE TABLE IF NOT EXISTS notification_dispatches (
      dispatch_key TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      template TEXT NOT NULL,
      recipient TEXT NOT NULL,
      dispatched_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_dispatches_order ON notification_dispatches(order_id);

    CREATE TABLE IF NOT EXISTS idempotency_records (
      key TEXT PRIMARY KEY,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      request_fingerprint TEXT,
      created_at TEXT NOT NULL
    );

    -- F-05 / F-20: every reconciliation claim is recorded, never trusted.
    -- A purchaser-supplied UTR lands here as an UNVERIFIED claim; the order state machine
    -- is only ever advanced by a gateway-authenticated or operator-authorized signal.
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      payment_session_id TEXT,
      payment_reference TEXT,
      amount INTEGER,
      currency TEXT,
      source TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON payment_attempts(order_id);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_reference ON payment_attempts(payment_reference);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Safe progressive migration for pre-existing replay caches (F-3).
  try {
    db.exec(`ALTER TABLE idempotency_records ADD COLUMN request_fingerprint TEXT;`);
  } catch {
    // Column already exists
  }
}

/**
 * Close database connection (used during teardown/testing)
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
