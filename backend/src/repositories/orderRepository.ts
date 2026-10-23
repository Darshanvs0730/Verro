/**
 * VÉRRO Commerce Backend — Order Repository
 * Persistence operations for orders and audit logs
 */

import { getDatabase } from './database.js';
import { OrderRecord, OrderStatus } from '../models/order.js';
import { isOrderStatusTransitionAllowed } from '../models/orderStatusPolicy.js';

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
        created_at, updated_at, paid_at, fulfilled_at
      ) VALUES (
        @id, @product_id, @amount, @currency, @status, @customer_email,
        @payment_reference, @idempotency_key, @customer_token_hash, @request_fingerprint,
        @created_at, @updated_at, @paid_at, @fulfilled_at
      )
    `);

    stmt.run({ ...order, request_fingerprint: order.request_fingerprint ?? null });
    this.logAudit('ORDER', order.id, 'CREATED', { productId: order.product_id, amount: order.amount });
    return order;
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
   * Find the most recent pending order, optionally matching an authoritative amount
   */
  findRecentPending(amount?: number): OrderRecord | null {
    const db = getDatabase();
    if (amount !== undefined) {
      const stmt = db.prepare("SELECT * FROM orders WHERE status IN ('pending', 'payment_pending') AND amount = ? ORDER BY created_at DESC LIMIT 1");
      return (stmt.get(amount) as OrderRecord) || null;
    }
    const stmt = db.prepare("SELECT * FROM orders WHERE status IN ('pending', 'payment_pending') ORDER BY created_at DESC LIMIT 1");
    return (stmt.get() as OrderRecord) || null;
  },

  /**
   * Find order by partial or full ID match (e.g. from SMS reference suffix)
   */
  findByReferenceSuffix(suffix: string): OrderRecord | null {
    const db = getDatabase();
    const clean = suffix.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!clean) return null;
    const stmt = db.prepare("SELECT * FROM orders WHERE status IN ('pending', 'payment_pending') AND LOWER(REPLACE(REPLACE(id, '_', ''), '-', '')) LIKE ? ORDER BY created_at DESC LIMIT 1");
    return (stmt.get(`%${clean}%`) as OrderRecord) || null;
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
