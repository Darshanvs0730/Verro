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
  amount: number;
  currency: string;
  mode: 'production' | 'development_mock';
}

export interface PaymentVerificationResult {
  isPaid: boolean;
  paymentReference?: string;
  amount: number;
  currency: string;
  status: 'paid' | 'unpaid' | 'failed' | 'pending';
}

export interface WebhookEventResult {
  isValid: boolean;
  eventId: string;
  orderId: string;
  status: 'paid' | 'failed';
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
