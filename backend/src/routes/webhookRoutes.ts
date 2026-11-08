/**
 * VÉRRO Commerce Backend — Webhook Routes
 */

import { Router } from 'express';
import { webhookController } from '../controllers/webhookController.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Payment Webhook Endpoint (with Rate Limiting).
//
// F-01 / F-02 remediation: the /sms and /email "multi-rail" routes were REMOVED.
// They accepted an unauthenticated free-text body and then settled whichever pending
// order best matched an attacker-controlled amount or id fragment, so any caller who
// could POST JSON could mark an order paid without paying. The gateway webhook below is
// now the single asynchronous settlement signal, and it is HMAC-verified over the exact
// raw request bytes before any order state is touched.
router.post('/payment', webhookLimiter, webhookController.handlePaymentWebhook);

export default router;
