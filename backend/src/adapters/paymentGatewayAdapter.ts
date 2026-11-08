/**
 * VÉRRO Commerce Backend — Payment Gateway Adapter Abstraction
 * Decouples commerce and order lifecycle from specific payment infrastructure.
 */

import { OrderRecord } from '../models/order.js';

export interface PaymentSessionResult {
  sessionId: string;
  checkoutUrl?: string;
  upiUri?: string;
  payeeVpa?: string;
  /**
   * F-48: the payee display name published alongside the VPA. The storefront used to hardcode
   * this string, so a deployment that changed merchant could publish a UPI intent whose payee
   * NAME disagreed with its VPA. Optional here because not every rail carries one; the storefront
   * refuses to render a payment intent without it.
   */
  payeeName?: string;
  amount: number;
  currency: string;
  mode: 'production' | 'development_mock';
}

export interface PaymentVerificationResult {
  isPaid: boolean;
  paymentReference?: string;
  amount: number;
  currency: string;
  /**
   * Distinct reconciliation outcomes (F-25).
   *
   * 'pending' means UNVERIFIABLE — a transient transport problem or an incomplete gateway
   * response. It is deliberately distinct from 'failed' (the gateway said the payment
   * declined) so a network blip can never drive an order into a terminal failure state.
   * 'expired' and 'cancelled' are their own gateway-reported terminal states.
   */
  status: 'paid' | 'unpaid' | 'pending' | 'failed' | 'expired' | 'cancelled';
}

export interface WebhookEventResult {
  isValid: boolean;
  eventId: string;
  orderId: string;
  /**
   * Distinct gateway outcomes (F-25).
   *
   * 'failed' is a genuine gateway decline; 'expired' and 'cancelled' are separate
   * terminal-but-rescuable states. Collapsing every non-paid outcome into 'failed' threw
   * away the only signal that distinguishes "the customer's payment declined" from
   * "the session timed out", and made every non-paid event indistinguishable in the
   * audit trail.
   */
  status: 'paid' | 'failed' | 'expired' | 'cancelled';
  paymentReference: string;
  amount: number;
  currency: string;
  timestamp: string;
}

export interface PaymentGatewayAdapter {
  readonly adapterName: string;
  readonly isProductionReady: boolean;

  createPaymentSession(order: OrderRecord): Promise<PaymentSessionResult>;
  verifyPayment(orderId: string, paymentReference: string): Promise<PaymentVerificationResult>;
  handleWebhook(rawPayload: string, signatureHeader?: string): Promise<WebhookEventResult>;
}
