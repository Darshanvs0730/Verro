/**
 * VÉRRO Commerce Backend — Order Service
 * Orchestrates order creation, catalog pricing authority, and payment transitions.
 */

import crypto from 'node:crypto';
import { orderRepository } from '../repositories/orderRepository.js';
import { getAuthoritativeProduct } from '../config/catalog.js';
import { CreateOrderInput, OrderRecord, OrderResponseDTO } from '../models/order.js';
import { PAYMENT_REFERENCE_PATTERN, SYNTHETIC_PAYMENT_REFERENCES } from '../models/webhookIdentifiers.js';
import { DevelopmentEmailService, EmailService } from './emailService.js';

export class OrderService {
  /**
   * F-45: identical evidence bursts inside this window collapse into one audit row. Long
   * enough to absorb a scripted probe, short enough that genuinely repeated customer actions
   * (spaced by real UI interaction) still appear individually in the trail.
   */
  static readonly EVIDENCE_DEDUPE_WINDOW_MS = 60_000;

  private emailService: EmailService;

  constructor(emailService: EmailService = new DevelopmentEmailService()) {
    this.emailService = emailService;
  }

  /**
   * Create a new order with server-authoritative pricing
   */
  async createOrder(input: CreateOrderInput): Promise<OrderResponseDTO> {
    const { productId, customerEmail, idempotencyKey, requestFingerprint } = input;

    // Idempotent replay (F-3): a key may only replay the request that claimed it.
    if (idempotencyKey) {
      const existing = orderRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        this.assertIdempotencyKeyOwnership(existing, requestFingerprint);
        return this.toReplayResponse(existing);
      }
    }

    // 1. Resolve product authoritatively from catalog
    const product = getAuthoritativeProduct(productId);
    if (!product) {
      throw new Error(`Invalid or inactive product ID: "${productId}"`);
    }

    // 2. Generate cryptographically unique order ID and purchaser access token
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const orderId = `ord_verro_${Date.now()}_${randomSuffix}`;
    const timestamp = new Date().toISOString();

    const customerAccessToken = `cst_${crypto.randomBytes(24).toString('hex')}`;
    const customerTokenHash = crypto.createHash('sha256').update(customerAccessToken).digest('hex');

    // 3. Persist order in database
    const orderRecord: OrderRecord = {
      id: orderId,
      product_id: product.id,
      amount: product.pricePaise, // Authoritative price from catalog (39900 paise = ₹399)
      currency: product.currency,
      status: 'pending',
      customer_email: customerEmail || null,
      payment_reference: null,
      idempotency_key: idempotencyKey || null,
      customer_token_hash: customerTokenHash,
      request_fingerprint: requestFingerprint || null,
      created_at: timestamp,
      updated_at: timestamp,
      paid_at: null,
      fulfilled_at: null
    };

    try {
      orderRepository.create(orderRecord);
    } catch (err) {
      // Concurrent duplicate request that slipped past the replay cache: the UNIQUE
      // constraint on idempotency_key guarantees exactly one order exists. Return that
      // order (never a fresh one, never an unhandled 500).
      if (idempotencyKey) {
        const raced = orderRepository.findByIdempotencyKey(idempotencyKey);
        if (raced) {
          this.assertIdempotencyKeyOwnership(raced, requestFingerprint);
          return this.toReplayResponse(raced);
        }
      }
      throw err;
    }

    return {
      orderId: orderRecord.id,
      productId: product.id,
      collection: product.collection,
      title: product.title,
      amount: product.pricePaise,
      formattedAmount: product.formattedPrice,
      currency: product.currency,
      status: orderRecord.status,
      createdAt: orderRecord.created_at,
      customerAccessToken // Delivered ONLY to the purchasing client upon creation
    };
  }

  /**
   * Retrieve an order by unique ID
   */
  async getOrder(orderId: string): Promise<OrderRecord | null> {
    return orderRepository.findById(orderId);
  }

  /**
   * Record a NON-settling reconciliation outcome or purchaser claim as evidence.
   *
   * F-03 / F-05: evidence never mutates order state, so an unauthorized attempt or an
   * unverified UTR claim leaves a durable audit trail without ever becoming a settlement.
   *
   * F-45: the first occurrence of a distinct (order, outcome, source) triple is always kept,
   * but an identical burst inside EVIDENCE_DEDUPE_WINDOW_MS collapses into that single row.
   * Reconciliation is reachable anonymously with a forged token, so without this a scripted
   * probe could append evidence rows without bound.
   */
  recordPaymentEvidence(
    orderId: string,
    outcome: string,
    detail: string,
    options: {
      source?: 'purchaser_claim' | 'gateway_reconciliation';
      paymentSessionId?: string | null;
      paymentReference?: string | null;
    } = {}
  ): void {
    const source = options.source ?? 'gateway_reconciliation';

    // F-45: collapse identical bursts. Every DISTINCT outcome is still recorded once.
    const windowStart = new Date(Date.now() - OrderService.EVIDENCE_DEDUPE_WINDOW_MS).toISOString();
    if (orderRepository.countRecentPaymentAttempts(orderId, outcome, source, windowStart) > 0) {
      return;
    }

    const order = orderRepository.findById(orderId);
    orderRepository.recordPaymentAttempt({
      orderId,
      paymentSessionId: options.paymentSessionId ?? order?.payment_session_id ?? null,
      paymentReference: options.paymentReference ?? null,
      amount: null,
      currency: null,
      source,
      outcome,
      detail
    });
  }

  /**
   * Bind the SERVER-issued payment session id to an order (F-20).
   *
   * Reconciliation later reads this persisted value instead of anything a client sent, so
   * only session creation performed by this process can decide which gateway record an
   * order is verified against.
   */
  attachPaymentSession(orderId: string, sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      return false;
    }
    return orderRepository.attachPaymentSession(orderId, sessionId.trim());
  }

  /**
   * Replace the persisted session with a freshly issued one (F-43).
   *
   * Only `POST /orders/:id/checkout` may call this, and only after the adapter has reported the
   * CURRENT session as definitively non-payable ('unpaid' / 'failed' / 'expired' / 'cancelled').
   * A session that is merely unverifiable ('pending') is never superseded, so a refresh can
   * never orphan a payment that might still succeed.
   */
  supersedePaymentSession(orderId: string, previousSessionId: string, sessionId: string): boolean {
    if (
      !orderId ||
      !previousSessionId ||
      !sessionId ||
      typeof sessionId !== 'string' ||
      sessionId.trim() === ''
    ) {
      return false;
    }
    return orderRepository.supersedePaymentSession(orderId, previousSessionId, sessionId.trim());
  }

  /**
   * Refuse to replay an order for a caller that did not issue the request which
   * originally claimed the idempotency key (F-3). Throws a 409-mapped conflict.
   */
  private assertIdempotencyKeyOwnership(order: OrderRecord, requestFingerprint?: string): void {
    if (!requestFingerprint || order.request_fingerprint !== requestFingerprint) {
      throw new Error('Conflict: this Idempotency-Key was already used for a different request payload.');
    }
  }

  /**
   * Build the idempotent replay DTO. The purchaser access token is intentionally
   * absent: it is minted exactly once, for the client that created the order.
   */
  private toReplayResponse(order: OrderRecord): OrderResponseDTO {
    const product = getAuthoritativeProduct(order.product_id);
    return {
      orderId: order.id,
      productId: order.product_id,
      collection: product?.collection || 'VÉRRO',
      title: product?.title || 'DIGITAL EDITION',
      amount: order.amount,
      formattedAmount: product?.formattedPrice || `₹${order.amount / 100}`,
      currency: order.currency,
      status: order.status,
      createdAt: order.created_at
    };
  }

  /**
   * Authoritatively transition an order to 'paid'
   * ONLY callable by server-side verification logic!
   */
  async processVerifiedPayment(
    orderId: string, 
    paymentReference: string, 
    amountPaid: number, 
    currency: string
  ): Promise<boolean> {
    const order = orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Cannot verify payment for nonexistent order: ${orderId}`);
    }

    // Guard: Prevent double fulfillment if already paid
    if (order.status === 'paid') {
      console.info(`[OrderService]: Order ${orderId} is already paid. Ignoring duplicate verification.`);
      return true;
    }

    // F-05: settlement evidence must be a real, well-formed reference issued by the
    // gateway. Empty strings and the retired self-synthesised placeholders are refused so
    // an order can never be marked paid against a reference nobody ever issued.
    if (
      !paymentReference ||
      typeof paymentReference !== 'string' ||
      !PAYMENT_REFERENCE_PATTERN.test(paymentReference) ||
      SYNTHETIC_PAYMENT_REFERENCES.includes(paymentReference)
    ) {
      orderRepository.recordPaymentAttempt({
        orderId,
        paymentSessionId: order.payment_session_id ?? null,
        paymentReference: paymentReference || null,
        amount: Number.isInteger(amountPaid) ? amountPaid : null,
        currency: currency ?? null,
        source: 'gateway_reconciliation',
        outcome: 'rejected_invalid_reference',
        detail: 'Settlement assertion carried no usable gateway payment reference.'
      });
      throw new Error(`Unverifiable settlement for order ${orderId}: invalid payment reference.`);
    }

    // Fail closed on anything that is not a fully-identified settlement.
    //
    // A mismatch is NOT a payment failure — it is an unverifiable assertion, so the order
    // is deliberately LEFT IN ITS CURRENT STATE. The pre-remediation code wrote 'failed'
    // here, which meant one malformed, partial or forged gateway payload could permanently
    // destroy a legitimately payable order (a denial-of-sale), and it also stamped the
    // unverified reference onto the row.
    if (!Number.isInteger(amountPaid) || amountPaid <= 0) {
      orderRepository.recordPaymentAttempt({
        orderId,
        paymentSessionId: order.payment_session_id ?? null,
        paymentReference,
        amount: null,
        currency: currency ?? null,
        source: 'gateway_reconciliation',
        outcome: 'rejected_missing_amount',
        detail: `Settlement assertion carried no positive integer amount in paise (${amountPaid}).`
      });
      throw new Error(`Unverifiable settlement for order ${orderId}: missing authoritative amount.`);
    }

    if (order.amount !== amountPaid) {
      orderRepository.recordPaymentAttempt({
        orderId,
        paymentSessionId: order.payment_session_id ?? null,
        paymentReference,
        amount: amountPaid,
        currency: currency ?? null,
        source: 'gateway_reconciliation',
        outcome: 'rejected_amount_mismatch',
        detail: `Expected ${order.amount} paise, asserted ${amountPaid} paise.`
      });
      throw new Error(`Amount mismatch for order ${orderId}: Expected ${order.amount}, received ${amountPaid}`);
    }

    if (!currency || order.currency !== currency) {
      orderRepository.recordPaymentAttempt({
        orderId,
        paymentSessionId: order.payment_session_id ?? null,
        paymentReference,
        amount: amountPaid,
        currency: currency ?? null,
        source: 'gateway_reconciliation',
        outcome: 'rejected_currency_mismatch',
        detail: `Expected ${order.currency}, asserted ${currency ?? '(missing)'}.`
      });
      throw new Error(`Currency mismatch for order ${orderId}: Expected ${order.currency}, received ${currency}`);
    }

    const paidAt = new Date().toISOString();
    const updated = orderRepository.updateStatus(orderId, 'paid', paymentReference, paidAt);

    orderRepository.recordPaymentAttempt({
      orderId,
      paymentSessionId: order.payment_session_id ?? null,
      paymentReference,
      amount: amountPaid,
      currency,
      source: 'gateway_reconciliation',
      outcome: 'settled'
    });

    if (updated && order.customer_email) {
      await this.emailService.sendOrderConfirmation(order.customer_email, orderId, {
        amount: order.amount,
        currency: order.currency,
        paidAt
      });
    }

    return updated;
  }

  /**
   * Mark order as failed.
   *
   * P-1: the transition policy lives in the repository, so a paid (terminal) order is
   * never downgraded by a late, duplicated or replayed failure notification.
   */
  async failOrder(orderId: string, reason?: string): Promise<boolean> {
    if (!orderRepository.findById(orderId)) {
      return false;
    }
    return orderRepository.updateStatus(orderId, 'failed', reason);
  }

  /**
   * Mark order as cancelled
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    return orderRepository.updateStatus(orderId, 'cancelled');
  }

  /**
   * Derive the purchaser binding hash used to scope download tokens to the buyer.
   * Returns null unless the supplied access token is genuinely valid for the order,
   * so a download token can never be minted for an unverified caller.
   */
  getPurchaserBindingHash(orderId: string, customerAccessToken?: string): string | null {
    const auth = this.verifyCustomerAccess(orderId, customerAccessToken);
    if (!auth.authorized || !auth.order || !auth.order.customer_token_hash || !customerAccessToken) {
      return null;
    }
    return auth.order.customer_token_hash;
  }

  /**
   * Authenticate purchaser access token against stored hash
   * Enforces that knowing an orderId alone is NEVER sufficient to access protected operations
   */
  verifyCustomerAccess(orderId: string, customerAccessToken?: string): { authorized: boolean; order?: OrderRecord; reason?: string } {
    const order = orderRepository.findById(orderId);
    if (!order) {
      return { authorized: false, reason: `Order "${orderId}" not found.` };
    }

    if (!customerAccessToken || typeof customerAccessToken !== 'string') {
      return { authorized: false, order, reason: 'Customer authorization token is required.' };
    }

    if (!order.customer_token_hash || !/^[a-f0-9]{64}$/i.test(order.customer_token_hash)) {
      return { authorized: false, order, reason: 'Order does not have a registered customer token.' };
    }

    const providedHash = crypto.createHash('sha256').update(customerAccessToken).digest('hex');

    // Compare as equal-length buffers of hex bytes with a length guard.
    const providedBuffer = Buffer.from(providedHash, 'hex');
    const storedBuffer = Buffer.from(order.customer_token_hash, 'hex');
    const isMatch =
      providedBuffer.length === storedBuffer.length &&
      providedBuffer.length === 32 &&
      crypto.timingSafeEqual(providedBuffer, storedBuffer);

    if (!isMatch) {
      return { authorized: false, order, reason: 'Invalid or forged customer authorization token.' };
    }

    return { authorized: true, order };
  }
}
