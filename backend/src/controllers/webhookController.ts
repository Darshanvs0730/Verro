/**
 * VÉRRO Commerce Backend — Webhook Controller
 * Processes asynchronous payment settlement notifications with signature verification & idempotency.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getPaymentAdapter } from '../adapters/paymentAdapterFactory.js';
import { OrderService } from '../services/orderService.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { idempotencyRepository } from '../repositories/idempotencyRepository.js';
import { WEBHOOK_EVENT_ID_PATTERN, WEBHOOK_ORDER_ID_PATTERN } from '../models/webhookIdentifiers.js';

const orderService = new OrderService();

export const webhookController = {
  /**
   * POST /api/v1/webhooks/payment
   * Processes server-to-server gateway callback events
   *
   * SECURITY (R1.4): the signature is verified as an HMAC over the EXACT raw request
   * bytes. The body is never re-serialized before verification, so byte-level
   * tampering between the wire and the verifier is impossible.
   */
  async handlePaymentWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signatureHeader = (
        req.headers['x-gateway-signature'] ||
        req.headers['x-verro-signature']
      ) as string | undefined;

      // Prefer the raw buffer captured by the express.raw() webhook mount.
      let rawPayload: string;
      if (Buffer.isBuffer(req.body)) {
        rawPayload = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
        rawPayload = req.body;
      } else {
        // Fail closed: never verify against a re-serialized object.
        rawPayload = '';
      }

      res.setHeader('Cache-Control', 'no-store');

      if (rawPayload.length === 0) {
        res.status(400).json({ error: 'Webhook rejected: raw request body is required for signature verification.' });
        return;
      }

      // 1. Delegate signature and structure verification to the active payment adapter
      const adapter = getPaymentAdapter();
      const event = await adapter.handleWebhook(rawPayload, signatureHeader);

      if (!event.isValid) {
        res.status(401).json({
          error: 'Webhook rejected: Invalid or unverified cryptographic signature.'
        });
        return;
      }

      // 2. Structural validation of the verified event (F-2 / P-4).
      //    A malformed event id must never be coerced into a shared replay bucket (the
      //    previous implementation collapsed every invalid id into "untrusted_event_id"),
      //    and an unknown order must never be acknowledged as a successful settlement.
      //    The identifier grammar is shared with the adapter via models/webhookIdentifiers.ts.
      if (!WEBHOOK_EVENT_ID_PATTERN.test(event.eventId)) {
        res.status(400).json({ error: 'Webhook rejected: eventId is missing or malformed.' });
        return;
      }
      if (!WEBHOOK_ORDER_ID_PATTERN.test(event.orderId)) {
        res.status(400).json({ error: 'Webhook rejected: orderId is missing or malformed.' });
        return;
      }

      // 3. Enforce Event Idempotency (prevent duplicate fulfillment of the same event).
      //    The key is namespaced by environment and the record is additionally bound to
      //    the exact order/status pair it acknowledged, so one event id can never be used
      //    to suppress a different settlement.
      const idempotencyKey = `webhook_evt_${env.nodeEnv}_${event.eventId}`;
      const eventFingerprint = crypto
        .createHash('sha256')
        .update(`${event.orderId}|${event.status}`, 'utf8')
        .digest('hex');

      const existing = idempotencyRepository.get(idempotencyKey);
      if (existing && existing.requestFingerprint === eventFingerprint) {
        console.info(`[WebhookController]: Duplicate event "${event.eventId}" received. Replaying cached acknowledgement.`);
        res.setHeader('Cache-Control', 'no-store');
        res.status(existing.responseStatus).json(JSON.parse(existing.responseBody));
        return;
      }

      // 4. P-4 — the referenced order must exist. An unknown reference is reported as a
      //    failure (so the gateway retries) and is deliberately NOT written to the replay
      //    cache, so a genuine later delivery can still settle the order once it exists.
      const order = orderRepository.findById(event.orderId);
      if (!order) {
        console.warn(
          `[WebhookController]: Rejected event "${event.eventId}" for unknown order "${event.orderId}".`
        );
        orderRepository.logAudit('WEBHOOK', event.orderId, 'UNKNOWN_ORDER_REJECTED', {
          eventId: event.eventId,
          status: event.status
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).json({ error: 'Webhook rejected: referenced order was not found.' });
        return;
      }

      // 5. Apply the authoritative order state transition.
      //    P-1: the lifecycle policy is enforced at the repository write choke point, so a
      //    late or duplicated "failed" signal can never downgrade a settled (paid) order.
      let applied = true;
      if (event.status === 'paid') {
        await orderService.processVerifiedPayment(
          event.orderId,
          event.paymentReference,
          event.amount,
          event.currency
        );
      } else {
        applied = await orderService.failOrder(event.orderId, `Gateway event reported status: ${event.status}`);
      }

      const settledOrder = orderRepository.findById(event.orderId);
      const responsePayload = {
        received: true,
        applied,
        eventId: event.eventId,
        orderId: event.orderId,
        status: event.status,
        orderStatus: settledOrder?.status ?? order.status,
        processedAt: new Date().toISOString()
      };

      idempotencyRepository.save(idempotencyKey, 200, JSON.stringify(responsePayload), eventFingerprint);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(responsePayload);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/webhooks/sms
   * POST /api/v1/webhooks/email
   * Multi-rail settlement for iOS Shortcuts, Bank SMS, or Email Forwarders
   */
  async handleSmsOrEmailWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.setHeader('Cache-Control', 'no-store');

      let rawText = '';
      if (Buffer.isBuffer(req.body)) {
        rawText = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
        rawText = req.body;
      } else if (req.body && typeof req.body === 'object') {
        rawText = (req.body as any).message || (req.body as any).text || (req.body as any).body || (req.body as any).content || JSON.stringify(req.body);
      }

      if (!rawText || rawText.trim().length === 0) {
        res.status(400).json({ error: 'Empty notification body received.' });
        return;
      }

      // Check if this looks like a credit/deposit notification
      const isCredit = /credit|credited|received|deposited|transferred/i.test(rawText);
      if (!isCredit) {
        res.status(200).json({ received: true, ignored: true, reason: 'Non-credit notification' });
        return;
      }

      // Extract 12-digit UTR (standard NPCI banking reference)
      const utrMatch = rawText.match(/\b([4-9]\d{11}|\d{12})\b/);
      const utr = utrMatch ? utrMatch[1] : `sms_${Date.now()}`;

      // Extract Amount in INR
      const amountMatch = rawText.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                          rawText.match(/credited (?:by|with)?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
      let parsedAmountPaise = 39900; // default VÉRRO Vol. 01 price
      if (amountMatch) {
        const floatVal = parseFloat(amountMatch[1].replace(/,/g, ''));
        if (!isNaN(floatVal) && floatVal > 0) {
          parsedAmountPaise = Math.round(floatVal * 100);
        }
      }

      // Check for custom order ref like VERRO1FB04F2A
      const refMatch = rawText.match(/VERRO([A-Z0-9]{4,12})/i);
      let targetOrder = null;
      if (refMatch) {
        targetOrder = orderRepository.findByReferenceSuffix(refMatch[1]);
      }
      if (!targetOrder) {
        targetOrder = orderRepository.findRecentPending(parsedAmountPaise);
      }

      if (!targetOrder) {
        orderRepository.logAudit('NOTIFICATION', utr, 'UNMATCHED_CREDIT_ALERT', { rawText: rawText.slice(0, 200) });
        res.status(200).json({ received: true, matched: false, utr, reason: 'No pending order matching amount/reference' });
        return;
      }

      // Authoritative settlement — strictly idempotent
      await orderService.processVerifiedPayment(
        targetOrder.id,
        utr,
        targetOrder.amount,
        targetOrder.currency
      );

      res.status(200).json({
        success: true,
        settled: true,
        orderId: targetOrder.id,
        utr,
        amount: targetOrder.amount,
        processedAt: new Date().toISOString()
      });
    } catch (err) {
      next(err);
    }
  }
};
