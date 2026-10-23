/**
 * VÉRRO Commerce Backend — Webhook Routes
 */

import { Router } from 'express';
import { webhookController } from '../controllers/webhookController.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Payment Webhook Endpoint (with Rate Limiting)
router.post('/payment', webhookLimiter, webhookController.handlePaymentWebhook);

// iOS Shortcuts / Bank SMS Multi-rail Webhook
router.post('/sms', webhookLimiter, webhookController.handleSmsOrEmailWebhook);

// Bank Email Observer Webhook
router.post('/email', webhookLimiter, webhookController.handleSmsOrEmailWebhook);

export default router;
