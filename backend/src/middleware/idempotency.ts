/**
 * VÉRRO Commerce Backend — Idempotency Middleware
 * Caches and replays responses for duplicate idempotent requests.
 *
 * F-3 hardening — an idempotency key is only replayed for the EXACT request that
 * created it. The record is bound to a SHA-256 fingerprint of the canonical request
 * (method + route + productId + customerEmail). A caller that reuses somebody else's
 * key with a different payload receives 409 Conflict instead of another party's
 * response, so a key can neither be squatted nor used to probe foreign order state.
 */

import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { idempotencyRepository } from '../repositories/idempotencyRepository.js';

/** Upper bound for a client-supplied idempotency key (anti-abuse / storage bound). */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Canonicalise the fields that define "the same request".
 * Unknown/extra body fields are intentionally ignored so a harmless additive field
 * cannot turn a legitimate retry into a conflict.
 */
export function buildRequestFingerprint(req: Request): string {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : '';
  const route = `${req.method}:${req.baseUrl || ''}${req.path || ''}`;

  return crypto.createHash('sha256').update(`${route}\n${productId}\n${customerEmail}`, 'utf8').digest('hex');
}

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return next();
  }

  if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    res.status(400).json({
      error: `Invalid request: "Idempotency-Key" must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`
    });
    return;
  }

  const requestFingerprint = buildRequestFingerprint(req);

  // Share the canonical identity of this request with the route handler so the order
  // service binds the persisted order to exactly the same fingerprint (single source
  // of truth, no chance of divergent re-computation).
  res.locals.idempotencyKey = idempotencyKey;
  res.locals.idempotencyFingerprint = requestFingerprint;

  // Check if a response was already recorded for this key.
  const cached = idempotencyRepository.get(idempotencyKey);
  if (cached) {
    // A stored fingerprint that differs (or a legacy record without one) means this key
    // belongs to a different request. Never replay another request's response.
    if (cached.requestFingerprint !== requestFingerprint) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(409).json({
        error: 'Conflict: this Idempotency-Key was already used for a different request payload.',
        statusCode: 409
      });
      return;
    }

    try {
      const parsedBody = JSON.parse(cached.responseBody);
      res.setHeader('X-Idempotency-Replay', 'true');
      res.setHeader('Cache-Control', 'no-store');
      res.status(cached.responseStatus).json(parsedBody);
      return;
    } catch {
      // If parsing fails, fall through to fresh execution
    }
  }

  // Token-bearing responses must never be stored by intermediaries.
  res.setHeader('Cache-Control', 'no-store');

  // Intercept response to record upon completion
  const originalJson = res.json.bind(res);
  res.json = function(body: any): Response {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        idempotencyRepository.save(idempotencyKey, res.statusCode, JSON.stringify(body), requestFingerprint);
      } catch (err) {
        console.warn('[Idempotency] Failed to cache response:', err);
      }
    }
    return originalJson(body);
  };

  next();
}

