/**
 * VÉRRO Commerce Backend — Order Status Transition Policy (P-1)
 *
 * The order lifecycle is a server-authoritative state machine. Client input and
 * asynchronous gateway events may only move an order along explicitly permitted edges;
 * anything else is refused and audited instead of being silently applied.
 *
 * Invariants:
 *  - 'paid' is a terminal settlement state. Nothing may move an order out of 'paid',
 *    so a late or duplicated 'failed'/'cancelled' signal can never revoke a paid
 *    entitlement or block delivery.
 *  - 'pending' / 'payment_pending' may settle, fail, expire or be cancelled.
 *  - A settlement signal may rescue 'failed' / 'expired' / 'cancelled' orders, because
 *    real money can be captured after a timeout, soft decline or cancellation and must
 *    then be honoured.
 */

import { OrderStatus } from './order.js';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['payment_pending', 'paid', 'failed', 'cancelled', 'expired'],
  payment_pending: ['paid', 'failed', 'cancelled', 'expired'],
  failed: ['paid'],
  expired: ['paid'],
  cancelled: ['paid'],
  // Terminal: a settled order is never downgraded automatically.
  paid: []
};

/** True when the requested transition is permitted by the server-side policy. */
export function isOrderStatusTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return (ORDER_STATUS_TRANSITIONS[from] || []).includes(to);
}
