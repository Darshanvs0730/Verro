/**
 * VÉRRO Commerce Backend — Shared identifier grammar for verified webhook events (F-2)
 *
 * Kept in one place so the payment adapter's structural validation and the webhook
 * controller's replay-key construction can never disagree about what a valid identifier
 * looks like. Both are bounded in length and restricted to an inert character set.
 */

/** Event identifiers: bounded, structured, and safe to embed in a cache key. */
export const WEBHOOK_EVENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Order identifiers accepted from webhook payloads (matches the order ID grammar). */
export const WEBHOOK_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
