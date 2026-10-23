/**
 * VÉRRO Commerce Backend — Order Domain Models & Types
 */

export type OrderStatus = 
  | 'pending'
  | 'payment_pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface OrderRecord {
  id: string; // Cryptographic unique identifier (e.g., ord_verro_...)
  product_id: string;
  amount: number; // In smallest currency unit (paise)
  currency: string;
  status: OrderStatus;
  customer_email: string | null;
  payment_reference: string | null;
  idempotency_key: string | null;
  customer_token_hash: string | null;
  /**
   * SHA-256 of the canonical request that created this order (F-3).
   * Binds an idempotency key to the payload that claimed it so a squatter can never
   * make another party's request replay a foreign order.
   */
  request_fingerprint?: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
}

export interface CreateOrderInput {
  productId: string;
  customerEmail?: string;
  idempotencyKey?: string;
  requestFingerprint?: string;
}

export interface OrderResponseDTO {
  orderId: string;
  productId: string;
  collection: string;
  title: string;
  amount: number;
  formattedAmount: string;
  currency: string;
  status: OrderStatus;
  createdAt: string;
  customerAccessToken?: string;
  checkoutUrl?: string;
  upiUri?: string;
  payeeVpa?: string;
  paymentSession?: {
    sessionId: string;
    checkoutUrl?: string;
    upiUri?: string;
    payeeVpa?: string;
    amount: number;
    currency: string;
    mode: 'production' | 'development_mock';
  };
}
