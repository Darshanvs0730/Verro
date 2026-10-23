/**
 * VÉRRO Commerce Backend — Idempotency Repository
 * Prevents duplicate request processing (e.g. duplicate checkouts or duplicate webhooks)
 */

import { getDatabase } from './database.js';
import { env } from '../config/env.js';

export interface IdempotencyRecord {
  key: string;
  responseStatus: number;
  responseBody: string;
  /** SHA-256 of the canonical request payload that produced this record (F-3). */
  requestFingerprint: string | null;
  createdAt: string;
}

/**
 * Fields that must never be persisted in the replay cache (R3.1).
 * Bearer credentials and short-lived download URLs are cache-poisoning targets.
 */
const SENSITIVE_RESPONSE_KEYS = [
  'customerAccessToken',
  'customer_access_token',
  'token',
  'downloadUrl',
  'download_url',
  'paymentReference',
  'payment_reference',
  'customer_token_hash',
  'customerEmail',
  'customer_email'
];

function redactResponse(value: any): any {
  if (Array.isArray(value)) {
    return value.map(redactResponse);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_RESPONSE_KEYS.includes(key)) continue;
      output[key] = redactResponse(child);
    }
    return output;
  }
  return value;
}

export const idempotencyRepository = {
  get(key: string): IdempotencyRecord | null {
    const db = getDatabase();
    const stmt = db.prepare(
      'SELECT key, response_status as responseStatus, response_body as responseBody, request_fingerprint as requestFingerprint, created_at as createdAt FROM idempotency_records WHERE key = ?'
    );
    const row = stmt.get(key) as IdempotencyRecord | undefined;
    if (!row) return null;

    // TTL enforcement — stale replay records are treated as absent (never replayed).
    const ttlMinutes = env.idempotencyTtlMinutes;
    if (Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
      const ageMs = Date.now() - new Date(row.createdAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > ttlMinutes * 60 * 1000) {
        return null;
      }
    }

    return row;
  },

  save(key: string, responseStatus: number, responseBody: string, requestFingerprint?: string | null): void {
    const db = getDatabase();

    // Redact secrets before persistence so replays can never leak bearer tokens.
    let safeBody = responseBody;
    try {
      safeBody = JSON.stringify(redactResponse(JSON.parse(responseBody)));
    } catch {
      // Non-JSON bodies are stored verbatim (never contains structured secrets).
      safeBody = responseBody;
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO idempotency_records (key, response_status, response_body, request_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(key, responseStatus, safeBody, requestFingerprint || null, new Date().toISOString());
  },

  /**
   * Remove records older than the configured TTL (P-5).
   * Invoked at process boot so an indefinitely-running deployment cannot accumulate
   * unbounded replay rows (which would otherwise be a slow storage-exhaustion vector).
   */
  purgeExpired(): number {
    const db = getDatabase();
    const ttlMinutes = env.idempotencyTtlMinutes;
    if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) return 0;
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM idempotency_records WHERE created_at < ?').run(cutoff);
    return result.changes;
  }
};
