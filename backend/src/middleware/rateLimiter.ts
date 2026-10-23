/**
 * VÉRRO Commerce Backend — In-Memory Rate Limiting Middleware
 * Protects critical commerce routes against denial-of-service, automated scraping,
 * order table exhaustion, and token brute-forcing.
 */

import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  const store = new Map<string, RateLimitRecord>();

  // Periodic cleanup of stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Explicit, import-time opt-in only. Request-controlled headers can NEVER
    // disable protection (previous behaviour allowed X-Test-Bypass-RateLimit).
    const bypassExplicitlyEnabled = (process.env.RATE_LIMIT_TEST_BYPASS || '').trim().toLowerCase() === 'true';
    if (bypassExplicitlyEnabled && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')) {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown-client';
    const key = `${req.baseUrl || req.path}:${ip}`;
    const now = Date.now();

    const record = store.get(key);

    if (!record || now > record.resetTime) {
      store.set(key, {
        count: 1,
        resetTime: now + options.windowMs
      });
      return next();
    }

    record.count++;

    if (record.count > options.maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      // Retry-After is safe to expose; internal counters are not.
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        error: options.message || 'Too many requests. Please try again later.',
        statusCode: 429,
        retryAfterSeconds
      });
      return;
    }

    next();
  };
}

// Preset rate limiters for critical commerce endpoints
export const orderCreationLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 orders/min per IP
  message: 'Order creation rate limit exceeded. Please wait before creating another order.'
});

export const orderStatusLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 queries/min per IP
  message: 'Order status check rate limit exceeded.'
});

export const downloadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 50, // 50 download authorization attempts/15min
  message: 'Download authorization rate limit exceeded. Please retry in a few minutes.'
});

export const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 200, // 200 webhook events/min
  message: 'Webhook intake rate limit exceeded.'
});

// Test fixture routes stay reachable but bounded, even when explicitly enabled.
export const testFixtureLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 fixture settlements/min
  message: 'Test fixture rate limit exceeded.'
});
