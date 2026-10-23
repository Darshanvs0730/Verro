/**
 * VÉRRO Commerce Backend — Order Routes
 */

import { Router } from 'express';
import { orderController } from '../controllers/orderController.js';
import { validateCreateOrderRequest, validateOrderIdParam } from '../middleware/validation.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { orderCreationLimiter, orderStatusLimiter, downloadLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Order Creation (with Rate Limiting + Idempotency)
router.post('/create', orderCreationLimiter, idempotencyMiddleware, validateCreateOrderRequest, orderController.create);

// Order Status Retrieval (with Rate Limiting)
router.get('/:orderId', orderStatusLimiter, validateOrderIdParam, orderController.getById);

// Payment Session Initiation / Retrieval (YouPI-PG integration)
router.post('/:orderId/checkout', orderCreationLimiter, validateOrderIdParam, orderController.createCheckout);

// Authoritative Settlement Reconciliation Check
router.post('/:orderId/verify', orderStatusLimiter, validateOrderIdParam, orderController.verifyPaymentStatus);

// Download Authorization Request (with Strict Rate Limiting)
router.post('/:orderId/download', downloadLimiter, validateOrderIdParam, orderController.requestDownload);

// Download File Stream (Private Master Delivery)
router.get('/:orderId/download/file', downloadLimiter, validateOrderIdParam, orderController.streamDownload);

export default router;
