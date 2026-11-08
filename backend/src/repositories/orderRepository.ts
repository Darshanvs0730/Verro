/**
 * VÉRRO Commerce Backend — Order Repository
 * Persistence operations for orders and audit logs
 */

import { getDatabase } from './database.js';
import { OrderRecord, OrderStatus } from '../models/order.js';
import { isOrderStatusTransitionAllowed } from '../models/orderStatusPolicy.js';

/** F-41: a single-use download authorization grant, keyed by the token's SHA-256 digest. */
export interface DownloadGrantRecord {
  token_hash: string;
  order_id: string;
  package_filename: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export const orderRepository = {
  /**
   * Persist a new order record
   */
  create(order: OrderRecord): OrderRecord {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO orders (
        id, product_id, amount, currency, status, customer_email,
        payment_reference, idempotency_key, customer_token_hash, request_fingerprint,
        payment_session_id, created_at, updated_at, paid_at, fulfilled_at
      ) VALUES (
        @id, @product_id, @amount, @currency, @status, @customer_email,
        @payment_reference, @idempotency_key, @customer_token_hash, @request_fingerprint,
        @payment_session_id, @created_at, @updated_at, @paid_at, @fulfilled_at
      )
    `);

    stmt.run({
      ...order,
      request_fingerprint: order.request_fingerprint ?? null,
      payment_session_id: order.payment_session_id ?? null
    });
    this.logAudit('ORDER', order.id, 'CREATED', { productId: order.product_id, amount: order.amount });
    return order;
  },

  /**
   * Persist the gateway session identity for an order (F-20).
   *
   * Only server-side session creation may call this, and the FIRST authoritative session
   * wins: an existing value is never overwritten, so a later request cannot re-point
   * reconciliation at a different gateway record.
   */
  attachPaymentSession(id: string, sessionId: string): boolean {
    const existing = this.findById(id);
    if (!existing) return false;
    if (existing.payment_session_id) {
      return existing.payment_session_id === sessionId;
    }

    const db = getDatabase();
    db.prepare('UPDATE orders SET payment_session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, new Date().toISOString(), id);
    this.logAudit('ORDER', id, 'PAYMENT_SESSION_ATTACHED', { paymentSessionId: sessionId });
    return true;
  },

  /**
   * Move an order's reconciliation key from a session the gateway has DEFINITIVELY reported as
   * non-payable to a freshly issued one (F-43).
   *
   * This is a compare-and-swap, not an overwrite: the update only applies while the order still
   * points at the exact session the caller reconciled. That keeps `attachPaymentSession`'s
   * first-wins guarantee intact against races, while still allowing a genuinely dead attempt
   * (`unpaid` / `failed` / `expired` / `cancelled`) to be replaced by a new attempt.
   */
  supersedePaymentSession(id: string, previousSessionId: string, sessionId: string): boolean {
    if (!sessionId || !previousSessionId) return false;

    const db = getDatabase();
    const result = db
      .prepare(
        'UPDATE orders SET payment_session_id = ?, updated_at = ? WHERE id = ? AND payment_session_id = ?'
      )
      .run(sessionId, new Date().toISOString(), id, previousSessionId);

    if (result.changes === 0) {
      return false;
    }

    this.logAudit('ORDER', id, 'PAYMENT_SESSION_SUPERSEDED', {
      previousPaymentSessionId: previousSessionId,
      paymentSessionId: sessionId
    });
    return true;
  },

  /**
   * Count recent identical evidence rows (F-45).
   *
   * Unauthenticated callers can reach the reconciliation endpoint, and every rejected probe
   * used to append a row. Counting first lets the service collapse a burst of identical
   * probes into a single audit row, so abuse cannot grow the table without bound while the
   * first probe of each distinct outcome is still recorded.
   */
  countRecentPaymentAttempts(
    orderId: string,
    outcome: string,
    source: string,
    sinceIso: string
  ): number {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) as total FROM payment_attempts
         WHERE order_id = ? AND outcome = ? AND source = ? AND created_at >= ?`
      )
      .get(orderId, outcome, source, sinceIso) as { total: number };
    return row.total;
  },

  /**
   * Record a payment assertion (gateway reconciliation result or purchaser claim).
   *
   * Evidence only — nothing here mutates order status, and an unverified purchaser claim
   * can therefore never become a settlement (F-05 / F-20).
   */
  recordPaymentAttempt(attempt: {
    orderId: string;
    paymentSessionId?: string | null;
    paymentReference?: string | null;
    amount?: number | null;
    currency?: string | null;
    source: 'gateway_reconciliation' | 'purchaser_claim' | 'gateway_webhook' | 'operator';
    outcome: string;
    detail?: string | null;
  }): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO payment_attempts (
        order_id, payment_session_id, payment_reference, amount, currency,
        source, outcome, detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.orderId,
      attempt.paymentSessionId ?? null,
      attempt.paymentReference ?? null,
      attempt.amount ?? null,
      attempt.currency ?? null,
      attempt.source,
      attempt.outcome,
      attempt.detail ?? null,
      new Date().toISOString()
    );
  },

  /** All recorded payment assertions for an order, oldest first. */
  listPaymentAttempts(orderId: string): Array<{ source: string; outcome: string }> {
    const db = getDatabase();
    return db
      .prepare('SELECT source, outcome FROM payment_attempts WHERE order_id = ? ORDER BY id ASC')
      .all(orderId) as Array<{ source: string; outcome: string }>;
  },

  /**
   * Retrieve an order by its unique ID
   */
  findById(id: string): OrderRecord | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
    const row = stmt.get(id) as OrderRecord | undefined;
    return row || null;
  },

  /**
   * Retrieve an order by idempotency key
   */
  findByIdempotencyKey(key: string): OrderRecord | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?');
    const row = stmt.get(key) as OrderRecord | undefined;
    return row || null;
  },

  

  /**
   * Update order status with optional payment reference and paid timestamp.
   *
   * P-1: this is the single write choke point for order status, so the transition
   * policy is enforced here. Illegal transitions (for example paid -> failed) are
   * refused, audited and reported as `false` so no caller can corrupt the lifecycle.
   */
  updateStatus(id: string, status: OrderStatus, paymentReference?: string, paidAt?: string): boolean {
    const db = getDatabase();
    const updatedAt = new Date().toISOString();

    const current = this.findById(id);
    if (!current) {
      return false;
    }

    // Re-applying the same status is an idempotent no-op.
    if (current.status === status) {
      return true;
    }

    if (!isOrderStatusTransitionAllowed(current.status, status)) {
      console.warn(
        `[OrderRepository]: Refused illegal order status transition "${current.status}" -> "${status}" for ${id}.`
      );
      this.logAudit('ORDER', id, 'STATUS_TRANSITION_REJECTED', {
        from: current.status,
        to: status,
        paymentReference
      });
      return false;
    }

    const stmt = db.prepare(`
      UPDATE orders 
      SET status = ?, 
          payment_reference = COALESCE(?, payment_reference), 
          paid_at = COALESCE(?, paid_at), 
          updated_at = ? 
      WHERE id = ?
    `);

    const result = stmt.run(status, paymentReference || null, paidAt || null, updatedAt, id);
    if (result.changes > 0) {
      this.logAudit('ORDER', id, 'STATUS_UPDATED', { status, paymentReference, paidAt });
      return true;
    }
    return false;
  },

  /**
   * Record digital fulfillment timestamp
   */
  markFulfilled(id: string, fulfilledAt: string): boolean {
    const db = getDatabase();
    const updatedAt = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE orders 
      SET fulfilled_at = ?, updated_at = ? 
      WHERE id = ?
    `);

    const result = stmt.run(fulfilledAt, updatedAt, id);
    if (result.changes > 0) {
      this.logAudit('ORDER', id, 'FULFILLED', { fulfilledAt });
      return true;
    }
    return false;
  },

  /**
   * F-41: register a freshly minted download token so it can be claimed exactly once.
   * The hash (never the token) is the primary key, so the value needed to replay a grant
   * is not recoverable from this table.
   */
  registerDownloadGrant(tokenHash: string, orderId: string, packageFilename: string, issuedAt: string, expiresAt: string): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO download_grants (token_hash, order_id, package_filename, issued_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `);

    stmt.run(tokenHash, orderId, packageFilename, issuedAt, expiresAt);
  },

  findDownloadGrant(tokenHash: string): DownloadGrantRecord | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT token_hash, order_id, package_filename, issued_at, expires_at, consumed_at
      FROM download_grants
      WHERE token_hash = ?
    `).get(tokenHash) as DownloadGrantRecord | undefined;

    return row || null;
  },

  /**
   * Atomically claim a grant. Returns false when the row was already consumed (replay) or
   * does not exist, which makes the caller fail closed without a read-then-write race.
   */
  consumeDownloadGrant(tokenHash: string, consumedAt: string): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE download_grants
      SET consumed_at = ?
      WHERE token_hash = ? AND consumed_at IS NULL
    `);

    const result = stmt.run(consumedAt, tokenHash);
    if (result.changes > 0) {
      this.logAudit('DOWNLOAD_GRANT', tokenHash.slice(0, 16), 'CONSUMED', { consumedAt });
      return true;
    }
    return false;
  },

  /**
   * F-41: claim a notification (one dispatch per dedupe key). Returns true only for the
   * first claimant, so retries and loops can never double-send to a customer.
   */
  claimNotificationDispatch(dispatchKey: string, orderId: string, template: string, recipient: string, dispatchedAt: string): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO notification_dispatches (dispatch_key, order_id, template, recipient, dispatched_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(dispatchKey, orderId, template, recipient, dispatchedAt);
    if (result.changes > 0) {
      this.logAudit('NOTIFICATION', orderId, 'DISPATCHED', { template, recipient });
      return true;
    }
    return false;
  },

  /**
   * Record an immutable audit log entry
   */
  logAudit(entityType: string, entityId: string, action: string, payload?: object): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO audit_logs (entity_type, entity_id, action, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      entityType,
      entityId,
      action,
      payload ? JSON.stringify(payload) : null,
      new Date().toISOString()
    );
  }
};
