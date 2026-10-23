/**
 * VÉRRO Commerce Backend — Order Service
 * Orchestrates order creation, catalog pricing authority, and payment transitions.
 */

import crypto from 'node:crypto';
import { orderRepository } from '../repositories/orderRepository.js';
import { getAuthoritativeProduct } from '../config/catalog.js';
import { CreateOrderInput, OrderRecord, OrderResponseDTO } from '../models/order.js';
import { DevelopmentEmailService, EmailService } from './emailService.js';

export class OrderService {
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

    // Validate authoritative amount and currency
    if (order.amount !== amountPaid) {
      orderRepository.updateStatus(orderId, 'failed', paymentReference);
      throw new Error(`Amount mismatch for order ${orderId}: Expected ${order.amount}, received ${amountPaid}`);
    }

    if (order.currency !== currency) {
      orderRepository.updateStatus(orderId, 'failed', paymentReference);
      throw new Error(`Currency mismatch for order ${orderId}: Expected ${order.currency}, received ${currency}`);
    }

    const paidAt = new Date().toISOString();
    const updated = orderRepository.updateStatus(orderId, 'paid', paymentReference, paidAt);

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
