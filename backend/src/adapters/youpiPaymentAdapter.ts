/**
 * VÉRRO Commerce Backend — YouPI-PG Sovereign Payment Gateway Adapter
 *
 * Implements the PaymentGatewayAdapter interface for YouPI-PG:
 * https://github.com/youpi-pg/YouPI-PG
 *
 * Capabilities:
 * 1. Sovereign UPI session creation via POST /api/v1/payments (with X-Merchant-Id, Idempotency-Key)
 * 2. Cryptographic HMAC-SHA256 webhook signature verification over exact raw request bytes
 * 3. Constant-time comparison preventing timing attacks (X-Gateway-Signature header support)
 * 4. Server-to-server authoritative payment verification via GET /api/v1/payments/:id
 * 5. Full mapping to YouPI-PG public lifecycle outcomes: SUCCESS, FAILED, EXPIRED, CANCELLED
 */

import crypto from 'node:crypto';
import { OrderRecord } from '../models/order.js';
import { WEBHOOK_EVENT_ID_PATTERN } from '../models/webhookIdentifiers.js';
import { LEGACY_DEV_WEBHOOK_SIGNATURE } from '../config/env.js';
import {
  PaymentGatewayAdapter,
  PaymentSessionResult,
  PaymentVerificationResult,
  WebhookEventResult
} from './paymentGatewayAdapter.js';

export interface YouPiAdapterConfig {
  apiUrl: string;
  portalUrl: string;
  merchantId?: string;
  /**
   * F-46/F-48: REQUIRED. The adapter no longer invents a payee: it used to fall back to a
   * hardcoded developer VPA, which meant a production deployment missing
   * PAYMENT_GATEWAY_MERCHANT_VPA still produced valid, scannable payment intents pointing at the
   * wrong person.
   */
  payeeVpa: string;
  /** F-46/F-48: REQUIRED. Payee display name published in the UPI intent. */
  payeeName: string;
  /** Inbound webhook signing key (HMAC-SHA256 over the raw request bytes). */
  webhookSecret: string;
  /**
   * F-32: outbound merchant credential, deliberately separate from `webhookSecret`.
   * Never send the inbound signing key on an outbound request.
   */
  merchantKey?: string;
  returnUrl?: string;
  timeoutMs?: number;
}

/**
 * Deterministically convert a gateway amount into integer paise (F-24).
 *
 * `amountPaise` is authoritative when present. `amount` is ALWAYS a decimal currency
 * amount (the YouPI-PG contract sends "399.00"), never an ambiguous bare integer — the
 * previous implementation guessed with `amount > 1000 ? amount : amount * 100`, which read
 * "500" as 500 paise but "1500" as 1500 paise instead of 150000. The same payload shape was
 * therefore misread by 100x in one direction or the other, and the guess decided whether a
 * settlement was accepted.
 *
 * Anything unparseable, non-positive or over-precise returns null so every caller fails
 * closed instead of settling on a guessed number.
 */
export function toAmountPaise(explicitPaise: unknown, decimalAmount: unknown): number | null {
  if (typeof explicitPaise === 'number' && Number.isInteger(explicitPaise) && explicitPaise > 0) {
    return explicitPaise;
  }
  if (typeof explicitPaise === 'string' && /^\d+$/.test(explicitPaise.trim())) {
    const parsed = Number.parseInt(explicitPaise.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }

  if (typeof decimalAmount === 'number' || typeof decimalAmount === 'string') {
    const raw = String(decimalAmount).replace(/,/g, '').trim();
    // Up to two decimal places only: "399", "399.00", "399.5" parse; "399.999" does not.
    if (/^\d+(\.\d{1,2})?$/.test(raw)) {
      const paise = Math.round(Number.parseFloat(raw) * 100);
      if (Number.isSafeInteger(paise) && paise > 0) return paise;
    }
  }

  return null;
}

/** Event freshness window for inbound webhook events (F-25). */
export const WEBHOOK_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Map a gateway lifecycle outcome onto the order state machine's vocabulary (F-25). */
export function mapGatewayEventStatus(raw: string): 'paid' | 'failed' | 'expired' | 'cancelled' | null {
  switch (raw.toUpperCase()) {
    case 'SUCCESS':
    case 'PAID':
    case 'COMPLETED':
    case 'CAPTURED':
      return 'paid';
    case 'FAILED':
    case 'FAILURE':
    case 'DECLINED':
      return 'failed';
    case 'EXPIRED':
    case 'TIMEOUT':
    case 'TIMED_OUT':
      return 'expired';
    case 'CANCELLED':
    case 'CANCELED':
    case 'VOIDED':
      return 'cancelled';
    default:
      return null;
  }
}

export class YouPiPaymentAdapter implements PaymentGatewayAdapter {
  readonly adapterName = 'YouPI-PG Sovereign Payment Gateway';
  readonly isProductionReady = true;

  private apiUrl: string;
  private portalUrl: string;
  private merchantId?: string;
  private payeeVpa: string;
  private payeeName: string;
  private webhookSecret: string;
  private merchantKey?: string;
  private returnUrl: string;
  private timeoutMs: number;

  constructor(config: YouPiAdapterConfig) {
    this.apiUrl = (config.apiUrl || 'http://localhost:6100').replace(/\/+$/, '');
    this.portalUrl = (config.portalUrl || 'http://localhost:7000').replace(/\/+$/, '');
    this.merchantId = config.merchantId;
    this.payeeVpa = config.payeeVpa;
    this.payeeName = config.payeeName;
    this.webhookSecret = config.webhookSecret;
    this.merchantKey = config.merchantKey;
    this.returnUrl = config.returnUrl || 'http://localhost:4173/#order-success';
    this.timeoutMs = config.timeoutMs || 10000;
  }

  /**
   * Initializes a new payment session on YouPI-PG Core API
   * POST /api/v1/payments
   */
  async createPaymentSession(order: OrderRecord): Promise<PaymentSessionResult> {
    const amountInr = (order.amount / 100).toFixed(2);
    const url = `${this.apiUrl}/api/v1/payments`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.merchantId) {
      headers['X-Merchant-Id'] = this.merchantId;
    }
    if (order.idempotency_key) {
      headers['Idempotency-Key'] = order.idempotency_key;
    }

    const payload = {
      orderId: order.id,
      amount: amountInr,
      currency: order.currency || 'INR',
      returnUrl: this.returnUrl,
      customer: order.customer_email ? { email: order.customer_email } : undefined,
      description: `VÉRRO Monograph — Order #${order.id}`,
      metadata: {
        orderId: order.id,
        productId: order.product_id
      }
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`YouPI Gateway session creation failed [HTTP ${response.status}]: ${errorText}`);
      }

      const data = (await response.json().catch(() => null)) as any;

      // The session identity MUST come from the gateway. Synthesising `youpi_<orderId>`
      // produced a session that no gateway ever issued, yet it was labelled
      // mode: 'production' and could be persisted as the order's reconciliation key
      // (F-20 / F-23).
      const paymentId =
        typeof data?.paymentId === 'string' && data.paymentId.trim() ? data.paymentId.trim() : '';
      if (!paymentId) {
        throw new Error('YouPI Gateway returned a session without a paymentId.');
      }

      const checkoutUrl =
        typeof data?.checkoutUrl === 'string' && data.checkoutUrl.trim()
          ? data.checkoutUrl.trim()
          : `${this.portalUrl}/checkout/${encodeURIComponent(paymentId)}`;
      const cleanRef = order.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
      const upiUri = `upi://pay?pa=${encodeURIComponent(this.payeeVpa)}&pn=${encodeURIComponent(this.payeeName)}&am=${amountInr}&cu=INR&tn=VERRO${cleanRef}`;

      return {
        sessionId: paymentId,
        checkoutUrl,
        upiUri,
        payeeVpa: this.payeeVpa,
        payeeName: this.payeeName,
        amount: order.amount,
        currency: order.currency,
        mode: 'production'
      };
    } catch (err: any) {
      // FAIL LOUDLY (F-23). There is deliberately NO fallback session: an unreachable or
      // misbehaving gateway must surface as an error for that order, never as an invented
      // payment session that looks production-ready but corresponds to nothing.
      console.error(
        `[YouPiPaymentAdapter] Payment session creation FAILED for ${order.id}: ${err.message}`
      );
      throw new Error(`Payment session could not be created for order ${order.id}: ${err.message}`);
    }
  }

  /**
   * Authoritatively queries YouPI-PG for settlement status
   * GET /api/v1/payments/:id
   */
  async verifyPayment(orderId: string, paymentReference: string): Promise<PaymentVerificationResult> {
    // F-20: query ONLY the server-persisted session id. The previous `paymentReference ||
    // orderId` fallback meant a caller who merely knew (or guessed) an order id steered the
    // verification query, probing gateway records that were never issued for that order.
    const paymentId = typeof paymentReference === 'string' ? paymentReference.trim() : '';
    if (!paymentId) {
      console.warn(`[YouPiPaymentAdapter] verifyPayment refused for ${orderId}: no persisted session id.`);
      return { isPaid: false, amount: 0, currency: 'INR', status: 'pending' };
    }

    const url = `${this.apiUrl}/api/v1/payments/${encodeURIComponent(paymentId)}`;

    // F-32: outbound requests authenticate with the merchant credential — never with the
    // inbound webhook signing key.
    const headers: Record<string, string> = {};
    if (this.merchantKey) {
      headers['X-Merchant-Key'] = this.merchantKey;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        // A definite "no such payment" is 'unpaid'. Every other failure is UNVERIFIABLE
        // ('pending') and never 'failed': a transport or 5xx problem must not be allowed to
        // drive an order's terminal state.
        const status: PaymentVerificationResult['status'] = response.status === 404 ? 'unpaid' : 'pending';
        console.warn(`[YouPiPaymentAdapter] verifyPayment ${paymentId} returned HTTP ${response.status} -> ${status}`);
        return { isPaid: false, amount: 0, currency: 'INR', status };
      }

      const data = (await response.json().catch(() => null)) as any;
      const statusRaw = String(data?.status || '').toUpperCase();
      const amountPaise = toAmountPaise(data?.amountPaise, data?.amount);
      const currency =
        typeof data?.currency === 'string' && data.currency.trim()
          ? data.currency.trim().toUpperCase()
          : 'INR';

      const mapped = mapGatewayEventStatus(statusRaw);
      if (mapped !== 'paid') {
        // 'pending' when the gateway said something we do not recognise (unverifiable).
        return {
          isPaid: false,
          amount: amountPaise ?? 0,
          currency,
          status: mapped === null ? 'pending' : mapped
        };
      }

      // A paid outcome is only usable when it is FULLY identified: an authoritative positive
      // amount in paise AND a real gateway-issued reference. Anything less is reported as
      // unverifiable so callers fail closed instead of settling on a guess.
      const reference = this.extractReference(data);
      if (amountPaise === null || !reference) {
        console.warn(
          `[YouPiPaymentAdapter] verifyPayment ${paymentId}: paid outcome without ${
            amountPaise === null ? 'an authoritative amount' : 'a gateway reference'
          }; reporting pending.`
        );
        return { isPaid: false, amount: amountPaise ?? 0, currency, status: 'pending' };
      }

      return { isPaid: true, paymentReference: reference, amount: amountPaise, currency, status: 'paid' };
    } catch (err: any) {
      // Transient transport failure: UNVERIFIABLE. Never 'failed', never 'paid'.
      console.warn(`[YouPiPaymentAdapter] verifyPayment query failed for ${paymentId}: ${err.message}`);
      return { isPaid: false, amount: 0, currency: 'INR', status: 'pending' };
    }
  }

  /** First gateway-issued reference present on a payload, or '' when none exists. */
  private extractReference(data: any): string {
    for (const candidate of [data?.utr, data?.paymentReference, data?.paymentId]) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return candidate.trim();
      }
    }
    return '';
  }

  /**
   * Cryptographically verifies inbound server-to-server webhook event.
   * Supports:
   * - X-Gateway-Signature header (sha256=<hex>) or X-VERRO-Signature (<hex>)
   * - Constant-time comparison
   * - Replay-resistant eventId and orderId validation
   */
  async handleWebhook(rawPayload: string, signatureHeader?: string): Promise<WebhookEventResult> {
    const invalid = (eventId: string, orderId: string, reason: string): WebhookEventResult => {
      console.warn(`[YouPiPaymentAdapter]: Rejected webhook: ${reason}`);
      return {
        isValid: false,
        eventId,
        orderId,
        status: 'failed',
        paymentReference: '',
        amount: 0,
        currency: 'INR',
        timestamp: new Date().toISOString()
      };
    };

    if (!rawPayload || typeof rawPayload !== 'string' || rawPayload.trim() === '') {
      return invalid('', '', 'Empty raw payload');
    }

    let data: any;
    try {
      data = JSON.parse(rawPayload);
    } catch {
      return invalid('malformed_payload', '', 'Malformed JSON payload');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return invalid('malformed_payload', '', 'Invalid payload root type');
    }

    // Extract identifiers
    const orderId = typeof data.orderId === 'string'
      ? data.orderId
      : (data.data && typeof data.data.orderId === 'string' ? data.data.orderId : '');
    const eventId = typeof data.eventId === 'string'
      ? data.eventId
      : (typeof data.paymentId === 'string'
          ? data.paymentId
          : (data.data && typeof data.data.paymentId === 'string' ? data.data.paymentId : ''));

    // Cryptographic signature check
    if (!signatureHeader || typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
      return invalid(eventId, orderId, 'Missing signature header');
    }

    let cleanSig = signatureHeader.trim();
    if (cleanSig.toLowerCase().startsWith('sha256=')) {
      cleanSig = cleanSig.substring(7).trim();
    }

    if (cleanSig === LEGACY_DEV_WEBHOOK_SIGNATURE) {
      return invalid(eventId, orderId, 'Legacy dev signature rejected');
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawPayload, 'utf8')
      .digest('hex');

    const received = Buffer.from(cleanSig, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');

    const signatureValid =
      received.length === expected.length &&
      received.length === 32 &&
      crypto.timingSafeEqual(received, expected);

    if (!signatureValid) {
      return invalid(eventId, orderId, 'Cryptographic HMAC signature mismatch');
    }

    // Structural grammar verification
    if (!orderId || !eventId || !WEBHOOK_EVENT_ID_PATTERN.test(eventId)) {
      return invalid(eventId, orderId, 'Failed identifier grammar check');
    }

    const eventRaw = String(
      data.event || data.status || (data.data && (data.data.event || data.data.status)) || ''
    );

    // F-25: four DISTINCT outcomes. An unrecognised status is rejected outright rather than
    // being coerced into 'failed', so a future gateway status can never be silently treated
    // as a decline (nor, worse, as a settlement).
    const mappedStatus = mapGatewayEventStatus(eventRaw);
    if (!mappedStatus) {
      return invalid(eventId, orderId, `Unmapped gateway event status "${eventRaw}"`);
    }

    // F-25: bounded freshness. A signed event whose own timestamp is implausibly old or in
    // the future is refused instead of being replayed indefinitely. An event carrying no
    // timestamp at all is still accepted, because some gateway deliveries omit it.
    const rawTimestamp = data.completedAt || data.timestamp || data.createdAt;
    let timestamp = new Date().toISOString();
    if (typeof rawTimestamp === 'string' && rawTimestamp.trim() !== '') {
      const parsedTimestamp = Date.parse(rawTimestamp);
      if (!Number.isFinite(parsedTimestamp)) {
        return invalid(eventId, orderId, 'Unparseable event timestamp');
      }
      if (Math.abs(Date.now() - parsedTimestamp) > WEBHOOK_FRESHNESS_WINDOW_MS) {
        return invalid(eventId, orderId, 'Event timestamp outside the accepted freshness window');
      }
      timestamp = new Date(parsedTimestamp).toISOString();
    }

    // Amount extraction (paise) — deterministic, never guessed (F-24).
    const amountPaise = toAmountPaise(data.amountPaise, data.amount);
    if (amountPaise === null) {
      return invalid(eventId, orderId, 'Missing or unparseable event amount');
    }

    const currency =
      typeof data.currency === 'string' && data.currency.trim() !== ''
        ? data.currency.trim().toUpperCase()
        : 'INR';

    // A PAID event must name the payment it asserts; non-paid outcomes need not carry one.
    // The previous `'youpi_settlement'` default minted a reference no gateway ever issued,
    // which then became the order's permanent payment_reference (F-05).
    const paymentReference = this.extractReference(data);
    if (mappedStatus === 'paid' && !paymentReference) {
      return invalid(eventId, orderId, 'Missing gateway payment reference');
    }

    return {
      isValid: true,
      eventId,
      orderId,
      status: mappedStatus,
      paymentReference,
      amount: amountPaise,
      currency,
      timestamp
    };
  }
}
