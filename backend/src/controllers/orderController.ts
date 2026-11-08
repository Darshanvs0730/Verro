/**
 * VÉRRO Commerce Backend — Order Controller
 * Handles order creation, retrieval, payment initiation, and digital fulfillment requests.
 */

import { Request, Response, NextFunction } from 'express';
import { OrderService } from '../services/orderService.js';
import { FulfillmentService } from '../services/fulfillmentService.js';
import { getPaymentAdapter } from '../adapters/paymentAdapterFactory.js';
import { PaymentGatewayAdapter } from '../adapters/paymentGatewayAdapter.js';
import { OrderRecord } from '../models/order.js';
import { env } from '../config/env.js';

const orderService = new OrderService();
const fulfillmentService = new FulfillmentService();

/** Apply no-store to every order/payment response (they carry tokens or PII). */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Extract the purchaser access token from either accepted header form.
 *
 * Centralised so every purchaser-scoped endpoint (reconciliation, checkout, download) uses
 * exactly the same rule — three divergent copies of this logic is how endpoints drift apart
 * and one of them ends up optional.
 */
function extractCustomerToken(req: Request): string | undefined {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer) return bearer;
  }

  const headerToken = req.headers['x-customer-token'];
  const normalized = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return typeof normalized === 'string' && normalized.trim() !== '' ? normalized.trim() : undefined;
}

/**
 * First usable payment reference a purchaser may have typed from their bank app.
 *
 * This value is EVIDENCE ONLY — it is capped, recorded as an unverified claim and can never
 * settle an order on its own (F-05).
 */
function extractClaimedReference(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  for (const key of ['paymentReference', 'utr', 'transactionReference', 'reference']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().slice(0, 128);
    }
  }
  return '';
}
/**
 * Gateway outcomes that mean the session can NEVER be paid (F-43).
 *
 * 'unpaid' is emitted by the adapter only for a definite gateway 404 ("no such payment"), and
 * 'failed' / 'expired' / 'cancelled' are gateway-reported terminal states. Everything else —
 * notably 'pending', which covers transport failures, 5xx responses and unrecognised statuses —
 * means the attempt is still resolvable and must never be replaced.
 */
const TERMINALLY_DEAD_PAYMENT_STATUSES = new Set(['unpaid', 'failed', 'expired', 'cancelled']);

type ExistingSessionResolution =
  | { outcome: 'settled' | 'reuse'; payload: Record<string, unknown> }
  | { outcome: 'superseded' };

/**
 * Reconcile the session already persisted for an order BEFORE any new one may be issued (F-43).
 */
async function reconcilePersistedSession(
  order: OrderRecord,
  sessionId: string,
  adapter: PaymentGatewayAdapter
): Promise<ExistingSessionResolution> {
  const verification = await adapter.verifyPayment(order.id, sessionId);
  const evidenceOptions = {
    source: 'gateway_reconciliation' as const,
    paymentSessionId: sessionId,
    paymentReference: verification.paymentReference || null
  };
  // 1. The previous attempt already SUCCEEDED: settle it through the single settlement choke
  //    point and never create a second payable session.
  if (verification.isPaid && verification.status === 'paid') {
    try {
      // Re-validates the amount, currency and reference; leaves the order untouched and throws
      // on any mismatch.
      await orderService.processVerifiedPayment(
        order.id,
        verification.paymentReference || '',
        verification.amount,
        verification.currency
      );

      orderService.recordPaymentEvidence(
        order.id,
        'settled_on_reused_session',
        'The session already persisted for this order reported a settled payment; the order was settled without creating another payable session.',
        evidenceOptions
      );

      const settledOrder = await orderService.getOrder(order.id);
      return {
        outcome: 'settled',
        payload: {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          status: settledOrder?.status ?? 'paid',
          sessionId,
          reusedSession: true,
          settled: true,
          reconciliation: 'settled_on_reused_session',
          message: 'Payment verified and confirmed. No new payment session was created.'
        }
      };
    } catch (settlementErr: any) {
      // FAIL CLOSED: an assertion we cannot apply (amount/currency mismatch) is NOT a licence to
      // open a second payable session — the money question is unresolved, so the order stays as
      // it is and the client is told the state is uncertain.
      console.warn(
        `[OrderController]: reused-session settlement assertion not applied for ${order.id}: ${settlementErr.message}`
      );
      orderService.recordPaymentEvidence(
        order.id,
        'reused_session_assertion_rejected',
        'A settled assertion on the persisted session was rejected by settlement validation; no new payment session was created.',
        evidenceOptions
      );

      return {
        outcome: 'reuse',
        payload: {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          status: order.status,
          sessionId,
          reusedSession: true,
          settled: false,
          paymentStatusUncertain: true,
          reconciliation: 'assertion_rejected',
          message:
            'A previous payment attempt for this order could not be confirmed and was not replaced. No new payment session was created.'
        }
      };
    }
  }

  // 2. A definitively dead attempt (gateway 404 / declined / expired / cancelled) may be
  //    replaced — that is the only case in which a new payable session is justified.
  if (TERMINALLY_DEAD_PAYMENT_STATUSES.has(verification.status)) {
    orderService.recordPaymentEvidence(
      order.id,
      `payment_session_superseded_${verification.status}`,
      `The persisted session was reported by the gateway as "${verification.status}"; a replacement session is being issued.`,
      evidenceOptions
    );
    return { outcome: 'superseded' };
  }

  // 3. Everything else — notably 'pending', which covers transport failures, gateway 5xx
  //    responses and unrecognised statuses — is UNVERIFIABLE, not dead. Reuse the existing
  //    attempt: it may still be paid, and uncertainty must never be resolved by handing the
  //    customer another payable session.
  orderService.recordPaymentEvidence(
    order.id,
    'reused_open_payment_session',
    `Session creation refused because the existing attempt is still resolvable (gateway status: ${verification.status}); the persisted session was reused.`,
    { ...evidenceOptions, paymentReference: null }
  );

  return {
    outcome: 'reuse',
    payload: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      sessionId,
      reusedSession: true,
      settled: false,
      paymentStatusUncertain: true,
      reconciliation: `reused_${verification.status}`,
      message:
        'An earlier payment attempt for this order is still open. It has been reused and no second payment session was created. Re-open the original payment reference, then confirm the outcome.'
    }
  };
}

export const orderController = {
  /**
   * POST /api/v1/orders/create
   * Creates an order with authoritative pricing from backend catalog
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      noStore(res);
      const { productId, customerEmail } = req.body;
      const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
      const idempotencyKey = (Array.isArray(headerKey) ? headerKey[0] : headerKey) as string | undefined;
      // Fingerprint is computed once by the idempotency middleware for this request.
      const requestFingerprint =
        typeof res.locals.idempotencyFingerprint === 'string' ? res.locals.idempotencyFingerprint : undefined;

      const order = await orderService.createOrder({
        productId,
        customerEmail,
        idempotencyKey,
        requestFingerprint
      });

      // Attempt to initiate payment session with active gateway adapter (e.g. YouPI-PG)
      let checkoutUrl: string | undefined;
      let paymentSession: any = undefined;
      try {
        const adapter = getPaymentAdapter();
        const session = await adapter.createPaymentSession({
          id: order.orderId,
          product_id: order.productId,
          amount: order.amount,
          currency: order.currency,
          status: order.status,
          customer_email: customerEmail || null,
          payment_reference: null,
          idempotency_key: idempotencyKey || null,
          customer_token_hash: null,
          created_at: order.createdAt,
          updated_at: order.createdAt,
          paid_at: null,
          fulfilled_at: null
        });
        checkoutUrl = session.checkoutUrl;
        paymentSession = session;
        // F-20: bind the gateway-issued session id at creation time so a later
        // reconciliation never needs — or accepts — a client-supplied hint.
        if (session.mode === 'production' && session.sessionId) {
          orderService.attachPaymentSession(order.orderId, session.sessionId);
        }
      } catch (adapterErr: any) {
        console.warn(`[OrderController]: Payment session initiation notice: ${adapterErr.message}`);
      }

      // F-48: the payee identity is deployment configuration, not session data, so it is always
      // published: from the gateway session when the rail supplies one, otherwise from the
      // configured merchant identity (which is fail-closed in production, F-46). The storefront
      // refuses to render a UPI intent without BOTH values, so a missing payee can no longer be
      // papered over by a hardcoded client-side literal.
      res.status(201).json({
        ...order,
        checkoutUrl,
        upiUri: paymentSession?.upiUri,
        payeeVpa: paymentSession?.payeeVpa ?? env.paymentGatewayMerchantVpa,
        payeeName: paymentSession?.payeeName ?? env.paymentGatewayMerchantName,
        paymentSession
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/orders/:orderId/checkout
   * Generates or retrieves a payment session for an existing order
   */
  async createCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      noStore(res);
      const orderId = String(req.params.orderId);
      const order = await orderService.getOrder(orderId);

      if (!order) {
        res.status(404).json({ error: `Order "${orderId}" not found.` });
        return;
      }

      if (order.status === 'paid') {
        res.status(400).json({ error: `Order "${orderId}" is already paid.`, status: 'paid' });
        return;
      }

      // F-22: session creation is PURCHASER-scoped and MANDATORY.
      //
      // The previous "check authorization if a token happens to be supplied" made the check
      // optional, so any anonymous caller holding — or guessing — an order id could mint
      // fresh payment sessions against someone else's order.
      const access = orderService.verifyCustomerAccess(orderId, extractCustomerToken(req));
      if (!access.authorized) {
        res.status(403).json({ error: 'Customer authorization denied.' });
        return;
      }

      const adapter = getPaymentAdapter();
      const persistedSessionId = order.payment_session_id || '';

      // F-43: never mint a second payable session while the existing one might have succeeded.
      // The pre-fix handler called `adapter.createPaymentSession(order)` unconditionally, so a
      // refresh, retry or double-submit produced a SECOND live payable gateway session for the
      // same order. Because the persisted session is first-wins (F-20), `POST /verify` can only
      // ever reconcile the first one, so a payment made on the duplicate attempt was invisible
      // to the storefront's own settlement path — and the customer faced two live QR/UPI
      // sessions for one order.
      if (persistedSessionId) {
        const existing = await reconcilePersistedSession(order, persistedSessionId, adapter);
        if (existing.outcome !== 'superseded') {
          res.status(200).json(existing.payload);
          return;
        }
      }

      const session = await adapter.createPaymentSession(order);

      // F-20: only a session the GATEWAY actually issued may become the order's
      // reconciliation key. Fabricated/mock session ids are never persisted.
      if (session.mode === 'production' && session.sessionId) {
        const bound = persistedSessionId
          ? // F-43: compare-and-swap — the key only ever moves off the exact session that was
            // just reconciled as definitively dead, so this cannot race with first-wins
            // attachment and cannot re-point reconciliation at an unrelated gateway record.
            orderService.supersedePaymentSession(order.id, persistedSessionId, session.sessionId)
          : orderService.attachPaymentSession(order.id, session.sessionId);

        if (!bound) {
          // Another request moved the reconciliation key first. This session is therefore NOT
          // the order's reconciliation key, so advertising it as payable would recreate exactly
          // the duplicate-session condition F-43 exists to prevent.
          orderService.recordPaymentEvidence(
            order.id,
            'session_binding_lost',
            'A concurrently issued session was not adopted as the order reconciliation key; it was not advertised as payable.',
            {
              source: 'gateway_reconciliation',
              paymentSessionId: session.sessionId,
              paymentReference: null
            }
          );

          const current = await orderService.getOrder(orderId);
          res.status(200).json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            status: current?.status || order.status,
            sessionId: current?.payment_session_id || null,
            reusedSession: true,
            settled: false,
            paymentStatusUncertain: true,
            reconciliation: 'session_binding_contended',
            message:
              'Another session became authoritative for this order. No new payment session was advertised as payable.'
          });
          return;
        }
      }

      res.status(200).json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        checkoutUrl: session.checkoutUrl,
        sessionId: session.sessionId,
        reusedSession: false,
        settled: false,
        paymentSession: session
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/orders/:orderId/verify
   * Authoritatively reconciles settlement for the PURCHASING client (F-03 / F-05 / F-20)
   */
  async verifyPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      noStore(res);
      const orderId = String(req.params.orderId);

      // 1. Purchaser authorization is MANDATORY (F-03).
      //
      // This endpoint was reachable with NO credential at all: knowing or guessing an order
      // id was enough to trigger settlement of someone else's order (a BOLA), and the
      // responses leaked the order's payment_reference. "Missing token" and "wrong token"
      // are answered identically so the endpoint is not an authorization oracle.
      const access = orderService.verifyCustomerAccess(orderId, extractCustomerToken(req));

      if (!access.order) {
        res.status(404).json({ error: `Order "${orderId}" not found.` });
        return;
      }

      if (!access.authorized) {
        orderService.recordPaymentEvidence(
          orderId,
          'rejected_unauthorized_reconciliation',
          'Reconciliation attempted without a valid purchaser access token.'
        );
        res.status(403).json({ error: 'Customer authorization denied.' });
        return;
      }

      const order = access.order;

      // Already settled: return the authoritative settled state. The caller has proven they
      // are the purchaser, so the reference is no longer a disclosure risk.
      if (order.status === 'paid') {
        res.status(200).json({
          orderId: order.id,
          status: 'paid',
          paidAt: order.paid_at,
          paymentReference: order.payment_reference,
          settled: true,
          reconciliation: 'already_settled'
        });
        return;
      }

      // 2. A purchaser may SUBMIT a payment reference (typically the UPI UTR from their bank
      //    app). It is recorded as an UNVERIFIED claim and can never settle the order on its
      //    own (F-05): the previous implementation trusted a client-supplied value and
      //    stamped it onto the order as proof of payment.
      const claimedReference = extractClaimedReference(req.body);

      // 3. Reconcile strictly against the session the SERVER persisted for this order (F-20).
      //    Nothing the client sent can influence which gateway record is consulted.
      const sessionId = order.payment_session_id || '';
      const adapter = getPaymentAdapter();
      const verification = sessionId
        ? await adapter.verifyPayment(order.id, sessionId)
        : { isPaid: false, amount: 0, currency: order.currency, status: 'pending' as const };

      let settled = false;
      let reconciliation = sessionId ? `gateway_${verification.status}` : 'no_payment_session';

      if (sessionId && verification.isPaid && verification.status === 'paid') {
        try {
          // The single settlement choke point re-validates amount, currency and reference,
          // and fails closed on any mismatch by leaving the order untouched (never 'failed').
          await orderService.processVerifiedPayment(
            order.id,
            verification.paymentReference || '',
            verification.amount,
            verification.currency
          );
          settled = true;
          reconciliation = 'settled';
        } catch (settlementErr: any) {
          console.warn(
            `[OrderController]: settlement assertion not applied for ${order.id}: ${settlementErr.message}`
          );
          reconciliation = 'assertion_rejected';
        }
      } else {
        orderService.recordPaymentEvidence(
          order.id,
          claimedReference ? 'unverified_claim_recorded' : `gateway_${verification.status}`,
          claimedReference
            ? 'Purchaser submitted a payment reference; it is recorded as unverified and cannot settle the order on its own.'
            : 'Gateway reconciliation did not report an unambiguous settled payment.',
          {
            source: claimedReference ? 'purchaser_claim' : 'gateway_reconciliation',
            paymentSessionId: sessionId || null,
            paymentReference: claimedReference || null
          }
        );
      }

      const updated = await orderService.getOrder(orderId);
      res.status(200).json({
        orderId: order.id,
        status: updated?.status || order.status,
        paidAt: updated?.paid_at ?? null,
        paymentReference: updated?.payment_reference ?? null,
        settled,
        reconciliation,
        claimRecorded: claimedReference ? true : undefined,
        message: settled
          ? 'Payment verified and confirmed.'
          : 'Payment is not yet verified. The order remains payable and nothing has been charged by VÉRRO.'
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/orders/:orderId
   * Retrieves order status by ID
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      noStore(res);
      const orderId = String(req.params.orderId);
      const order = await orderService.getOrder(orderId);

      if (!order) {
        res.status(404).json({ error: `Order "${orderId}" not found.` });
        return;
      }

      // Check if caller provides valid customer access token
      const customerToken = extractCustomerToken(req);

      const isAuthorized = customerToken
        ? orderService.verifyCustomerAccess(orderId, customerToken).authorized
        : false;

      res.status(200).json({
        orderId: order.id,
        productId: order.product_id,
        amount: order.amount,
        formattedAmount: `₹${order.amount / 100}`,
        currency: order.currency,
        status: order.status,
        createdAt: order.created_at,
        paidAt: order.paid_at,
        fulfilledAt: order.fulfilled_at,
        customerEmail: isAuthorized ? order.customer_email : undefined,
        paymentReference: isAuthorized ? order.payment_reference : undefined
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/orders/:orderId/download
   * Generates temporary signed download access for paid orders
   * STRICTLY requires purchaser customer access token
   */
  async requestDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      noStore(res);
      const orderId = String(req.params.orderId);
      const authHeader = req.headers['authorization'];
      const customerAccessToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : (req.headers['x-customer-token'] as string | undefined);

      const access = await fulfillmentService.authorizeDownload(orderId, customerAccessToken);

      res.status(200).json(access);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/orders/:orderId/download/file
   * Securely streams private master archive after verifying token
   */
  async streamDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Private master delivery must never be cached by any intermediary.
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');

      const token = req.query.token as string | undefined;

      if (!token || typeof token !== 'string') {
        res.status(401).json({ error: 'Unauthorized: Missing download token.' });
        return;
      }

      const result = await fulfillmentService.verifyDownloadRequest(token);

      if (!result.authorized || !result.filePath || !result.filename) {
        // A consumed or unknown grant is not an authorization failure — the caller simply
        // needs a new link (F-41). Expressed as 410 Gone so clients can distinguish it.
        const status = result.reason === 'replayed' ? 410 : 403;
        res.status(status).json({ error: result.error || 'Download authorization failed.' });
        return;
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(result.filePath);
    } catch (err) {
      next(err);
    }
  }
};
