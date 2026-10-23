/**
 * VÉRRO Commerce Backend — Order Controller
 * Handles order creation, retrieval, payment initiation, and digital fulfillment requests.
 */

import { Request, Response, NextFunction } from 'express';
import { OrderService } from '../services/orderService.js';
import { FulfillmentService } from '../services/fulfillmentService.js';
import { getPaymentAdapter } from '../adapters/paymentAdapterFactory.js';

const orderService = new OrderService();
const fulfillmentService = new FulfillmentService();

/** Apply no-store to every order/payment response (they carry tokens or PII). */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
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
      } catch (adapterErr: any) {
        console.warn(`[OrderController]: Payment session initiation notice: ${adapterErr.message}`);
      }

      res.status(201).json({
        ...order,
        checkoutUrl,
        upiUri: paymentSession?.upiUri,
        payeeVpa: paymentSession?.payeeVpa,
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

      // Check customer authorization if provided
      const authHeader = req.headers['authorization'];
      const customerToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : (req.headers['x-customer-token'] as string | undefined);

      if (customerToken) {
        const auth = orderService.verifyCustomerAccess(orderId, customerToken);
        if (!auth.authorized) {
          res.status(403).json({ error: 'Customer authorization denied.' });
          return;
        }
      }

      const adapter = getPaymentAdapter();
      const session = await adapter.createPaymentSession(order);

      res.status(200).json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        checkoutUrl: session.checkoutUrl,
        sessionId: session.sessionId,
        paymentSession: session
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/orders/:orderId/verify
   * Authoritatively queries the payment gateway (YouPI-PG) to reconcile settlement
   */
  async verifyPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      noStore(res);
      const orderId = String(req.params.orderId);
      const order = await orderService.getOrder(orderId);

      if (!order) {
        res.status(404).json({ error: `Order "${orderId}" not found.` });
        return;
      }

      // If already paid, return settled state immediately
      if (order.status === 'paid') {
        res.status(200).json({
          orderId: order.id,
          status: 'paid',
          paidAt: order.paid_at,
          paymentReference: order.payment_reference
        });
        return;
      }

      // Query gateway via adapter
      const adapter = getPaymentAdapter();
      const verification = await adapter.verifyPayment(orderId, order.payment_reference || order.id);

      if (verification.isPaid && verification.status === 'paid') {
        await orderService.processVerifiedPayment(
          orderId,
          verification.paymentReference || 'youpi_reconciled',
          verification.amount || order.amount,
          verification.currency || order.currency
        );
      }

      const updated = await orderService.getOrder(orderId);
      res.status(200).json({
        orderId: order.id,
        status: updated?.status || order.status,
        paidAt: updated?.paid_at,
        paymentReference: updated?.payment_reference
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
      const authHeader = req.headers['authorization'];
      const customerToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : (req.headers['x-customer-token'] as string | undefined);

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
        res.status(403).json({ error: result.error || 'Download authorization failed.' });
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
