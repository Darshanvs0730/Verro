/**
 * VÉRRO Commerce Backend — Test Fixture Routes
 *
 * STRICT SAFETY NOTICE (F-1 hardening):
 * These routes can settle an order WITHOUT any real money moving. They are therefore
 * gated by THREE independent, fail-closed controls:
 *
 *   1. NODE_ENV must be exactly "test"   (enforced in config/env.ts)
 *   2. ENABLE_TEST_ROUTES=true           (enforced in config/env.ts)
 *   3. TEST_FIXTURE_TOKEN (>= 16 chars) supplied via the X-Test-Fixture-Token header
 *      and compared in constant time.
 *
 * The route table is not even mounted unless all three hold, and this module repeats
 * the environment check so an accidental manual mount can never expose settlement.
 * Missing/wrong token -> 403. Surface not enabled -> 404 (existence not disclosed).
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { env, MIN_TEST_FIXTURE_TOKEN_LENGTH } from '../config/env.js';
import { OrderService } from '../services/orderService.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { testFixtureLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const orderService = new OrderService();

/** Maximum accepted length for a candidate fixture token (anti-abuse bound). */
const MAX_FIXTURE_TOKEN_LENGTH = 512;

/**
 * Build the shared-secret guard for the fixture surface.
 *
 * Fail-closed semantics:
 *  - No/weak configured token  -> 404 (the surface behaves as if it does not exist).
 *  - Missing/empty/wrong token -> 403 with a generic message (no oracle, no length leak).
 *  - Correct token             -> next().
 * Comparison is a constant-time timingSafeEqual over raw bytes; lengths are compared
 * first because timingSafeEqual requires equal-length inputs.
 */
export function createFixtureTokenGuard(expectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Cache-Control', 'no-store');

    if (!expectedToken || expectedToken.length < MIN_TEST_FIXTURE_TOKEN_LENGTH) {
      res.status(404).json({ error: 'Resource not found.' });
      return;
    }

    const rawHeader = req.headers['x-test-fixture-token'];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    const genericDenial = (): void => {
      res.status(403).json({ error: 'Forbidden: test fixture authorization token is missing or invalid.' });
    };

    if (typeof provided !== 'string' || provided.length === 0 || provided.length > MAX_FIXTURE_TOKEN_LENGTH) {
      genericDenial();
      return;
    }

    const expectedBuffer = Buffer.from(expectedToken, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');

    const isMatch =
      providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);

    if (!isMatch) {
      genericDenial();
      return;
    }

    next();
  };
}

// Layer 1 — fail-closed environment gate. Repeats the check enforced at mount time so
// the surface can never be reached even if this router is mounted by mistake.
router.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!env.testRoutesEnabled || env.isProduction) {
    res.status(404).json({ error: 'Resource not found.' });
    return;
  }

  next();
});

// Layer 2 — bounded attempts (30/min) so the shared token cannot be brute-forced.
router.use(testFixtureLimiter);

// Layer 3 — shared-secret header guard (timing-safe).
router.use(createFixtureTokenGuard(env.testFixtureToken));

/**
 * POST /api/v1/test/orders/:orderId/simulate-paid
 * Test fixture allowing automated E2E tests to simulate server-side settlement
 */
router.post('/orders/:orderId/simulate-paid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.orderId);

    if (!/^[a-zA-Z0-9_-]+$/.test(orderId)) {
      res.status(400).json({ error: 'Invalid request: "orderId" parameter is malformed.' });
      return;
    }

    const order = orderRepository.findById(orderId);

    if (!order) {
      res.status(404).json({ error: `Order "${orderId}" not found.` });
      return;
    }

    await orderService.processVerifiedPayment(
      order.id,
      'dev_test_fixture_settlement',
      order.amount,
      order.currency
    );

    res.status(200).json({
      simulated: true,
      orderId: order.id,
      status: 'paid',
      message: 'DEVELOPMENT TEST FIXTURE: Order transitioned to paid for automated verification.'
    });
  } catch (err) {
    next(err);
  }
});

export default router;
