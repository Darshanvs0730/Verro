/**
 * VÉRRO Commerce Backend — Development Payment Adapter
 * STRICT SAFETY NOTICE:
 * This adapter is solely for local architecture validation and cannot process real money.
 * It will NEVER claim real settlement and explicitly marks all verification attempts as mock.
 */

import crypto from 'node:crypto';
import { OrderRecord } from '../models/order.js';
import { WEBHOOK_EVENT_ID_PATTERN } from '../models/webhookIdentifiers.js';
import { env, LEGACY_DEV_WEBHOOK_SIGNATURE } from '../config/env.js';
import { 
  PaymentGatewayAdapter, 
  PaymentSessionResult, 
  PaymentVerificationResult, 
  WebhookEventResult 
} from './paymentGatewayAdapter.js';

export class DevelopmentPaymentAdapter implements PaymentGatewayAdapter {
  readonly adapterName = 'DevelopmentPaymentAdapter (Inactive/Mock Only)';
  readonly isProductionReady = false;

  async createPaymentSession(order: OrderRecord): Promise<PaymentSessionResult> {
    console.info(`[DevPaymentAdapter]: Generating development test session for order ${order.id}`);
    return {
      sessionId: `dev_sess_${order.id}`,
      checkoutUrl: undefined, // Explicitly no live payment redirect
      amount: order.amount,
      currency: order.currency,
      mode: 'development_mock'
    };
  }

  async verifyPayment(orderId: string, paymentReference: string): Promise<PaymentVerificationResult> {
    console.warn(`[DevPaymentAdapter]: verifyPayment called on development adapter for order ${orderId}. Cannot verify real money.`);
    
    // Explicit safety: Only allow test validation if an explicit internal dev token is passed
    if (paymentReference === 'TEST_SIMULATED_DEV_TOKEN') {
      return {
        isPaid: false,
        paymentReference,
        amount: 39900,
        currency: 'INR',
        status: 'unpaid'
      };
    }

    return {
      isPaid: false,
      status: 'unpaid',
      amount: 0,
      currency: 'INR'
    };
  }

  async handleWebhook(rawPayload: string, signatureHeader?: string): Promise<WebhookEventResult> {
    const invalid = (eventId: string, orderId: string): WebhookEventResult => ({
      isValid: false,
      eventId,
      orderId,
      status: 'failed',
      paymentReference: '',
      amount: 0,
      currency: 'INR',
      timestamp: new Date().toISOString()
    });

    let data: any;
    try {
      data = JSON.parse(rawPayload);
    } catch {
      return invalid('malformed_payload', '');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return invalid('malformed_payload', '');
    }

    const eventId = typeof data.eventId === 'string' ? data.eventId : '';
    const orderId = typeof data.orderId === 'string' ? data.orderId : '';

    // 1. Cryptographic signature verification (HMAC-SHA256 over the exact raw body).
    //    A publicly known literal is NEVER accepted as a valid signature.
    if (!signatureHeader || typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
      console.warn('[DevPaymentAdapter]: Rejected webhook with missing signature header.');
      return invalid(eventId, orderId);
    }

    if (signatureHeader === LEGACY_DEV_WEBHOOK_SIGNATURE) {
      console.warn('[DevPaymentAdapter]: Rejected webhook using the publicly documented development signature literal.');
      return invalid(eventId, orderId);
    }

    const expectedSignature = crypto
      .createHmac('sha256', env.webhookSecret)
      .update(rawPayload, 'utf8')
      .digest('hex');

    const received = Buffer.from(signatureHeader.trim(), 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');
    const signatureValid =
      received.length === expected.length &&
      received.length === 32 &&
      crypto.timingSafeEqual(received, expected);

    if (!signatureValid) {
      console.warn('[DevPaymentAdapter]: Rejected webhook with invalid cryptographic signature.');
      return invalid(eventId, orderId);
    }

    // 2. Structural validation of the verified event.
    //    F-2: the event identifier is REQUIRED and must satisfy the shared grammar. It is
    //    never fabricated from server time and never coerced to a constant, because either
    //    behaviour would let two distinct events share one idempotency bucket.
    if (
      !orderId ||
      !eventId ||
      !WEBHOOK_EVENT_ID_PATTERN.test(eventId) ||
      (data.status !== 'paid' && data.status !== 'failed')
    ) {
      return invalid(eventId, orderId);
    }

    const amount = typeof data.amount === 'number' && Number.isInteger(data.amount) ? data.amount : 0;
    const currency = typeof data.currency === 'string' && data.currency.length > 0 ? data.currency : 'INR';
    const paymentReference =
      typeof data.paymentReference === 'string' && data.paymentReference.length > 0 ? data.paymentReference : 'dev_ref';

    return {
      isValid: true,
      eventId,
      orderId,
      status: data.status === 'paid' ? 'paid' : 'failed',
      paymentReference,
      amount,
      currency,
      timestamp: new Date().toISOString()
    };
  }
}
