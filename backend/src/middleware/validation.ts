/**
 * VÉRRO Commerce Backend — Request Validation Middleware
 */

import { Request, Response, NextFunction } from 'express';

/** Prototype-pollution / object-injection keys that must never appear in a body. */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateCreateOrderRequest(req: Request, res: Response, next: NextFunction): void {
  const body = req.body;

  if (!isPlainObject(body)) {
    res.status(400).json({
      error: 'Invalid request: JSON object body is required.'
    });
    return;
  }

  // Reject prototype-pollution style keys outright (defence in depth).
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      res.status(400).json({
        error: 'Invalid request: body contains a forbidden key.'
      });
      return;
    }
  }

  const { productId, customerEmail } = body;

  // Strictly reject non-string scalars, arrays and objects.
  if (typeof productId !== 'string' || productId.trim() === '') {
    res.status(400).json({
      error: 'Invalid request: "productId" is required and must be a non-empty string.'
    });
    return;
  }

  // Prevent unexpected injection or path traversal in productId
  if (!/^[a-zA-Z0-9_-]+$/.test(productId)) {
    res.status(400).json({
      error: 'Invalid request: "productId" contains invalid characters.'
    });
    return;
  }

  if (customerEmail !== undefined) {
    if (typeof customerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      res.status(400).json({
        error: 'Invalid request: "customerEmail" must be a valid email address.'
      });
      return;
    }
  }

  next();
}

export function validateOrderIdParam(req: Request, res: Response, next: NextFunction): void {
  const { orderId } = req.params;

  if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(orderId)) {
    res.status(400).json({
      error: 'Invalid request: "orderId" parameter is malformed.'
    });
    return;
  }

  next();
}
