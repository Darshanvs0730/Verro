/**
 * VÉRRO Commerce Backend — Centralized Error Handler
 * Formats structured errors without leaking internal system stack traces.
 */

import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  console.error(`[VÉRRO Commerce Error] ${req.method} ${req.path}:`, err.message);

  res.setHeader('Cache-Control', 'no-store');

  const rawMessage = typeof err.message === 'string' ? err.message : '';
  const anyErr = err as any;

  // 1. Body parser / payload failures — mapped on structured properties, NEVER by
  //    substring matching user-controlled content.
  if (anyErr?.type === 'entity.too.large' || anyErr?.status === 413) {
    res.status(413).json({ error: 'Request payload too large.', statusCode: 413, timestamp: new Date().toISOString() });
    return;
  }
  if (
    anyErr?.type === 'entity.parse.failed' ||
    anyErr instanceof SyntaxError ||
    anyErr?.status === 400 && /JSON/i.test(anyErr?.message || '')
  ) {
    res.status(400).json({ error: 'Malformed request body.', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }

  let statusCode = 500;
  let userMessage = 'An unexpected server error occurred.';

  // 2. Map only known server-authored domain exceptions to client-safe messages.
  if (rawMessage.startsWith('Conflict:')) {
    // F-3: idempotency key reused for a different payload, or another state conflict.
    statusCode = 409;
    userMessage = rawMessage;
  } else if (rawMessage.includes('nonexistent order')) {
    statusCode = 404;
    userMessage = 'Order not found.';
  } else if (rawMessage.includes('not found') || rawMessage.includes('missing')) {
    statusCode = 404;
    userMessage = rawMessage;
  } else if (rawMessage.includes('denied') || rawMessage.includes('unpaid') || rawMessage.includes('not paid')) {
    statusCode = 403;
    userMessage = rawMessage;
  } else if (rawMessage.includes('Invalid or inactive product ID')) {
    statusCode = 400;
    userMessage = rawMessage;
  } else if (rawMessage.startsWith('Invalid request:')) {
    statusCode = 400;
    userMessage = rawMessage;
  } else if (rawMessage.includes('mismatch')) {
    statusCode = 400;
    userMessage = 'Payment verification failed: amount or currency mismatch.';
  }

  // Unknown/unexpected errors never leak internal message text or stack traces.
  res.status(statusCode).json({
    error: userMessage,
    statusCode,
    timestamp: new Date().toISOString()
  });
}
