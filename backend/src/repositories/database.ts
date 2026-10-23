/**
 * VÉRRO Commerce Backend — Database Initialization & Connection
 * Uses SQLite with PostgreSQL-compatible schema and syntax.
 */

import Database from 'better-sqlite3';
import { env } from '../config/env.js';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(env.databaseUrl);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
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
    `ALTER TABLE orders ADD COLUMN request_fingerprint TEXT;`
  ]) {
    try {
      db.exec(migration);
    } catch {
      // Column already exists
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_token_hash ON orders(customer_token_hash);

    CREATE TABLE IF NOT EXISTS idempotency_records (
      key TEXT PRIMARY KEY,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      request_fingerprint TEXT,
      created_at TEXT NOT NULL
    );

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
