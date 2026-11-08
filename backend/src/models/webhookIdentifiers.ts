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

/**
 * Payment references accepted as settlement evidence (F-05).
 *
 * Covers the shapes the platform actually receives — a 12-digit NPCI UTR, a gateway
 * payment/session id, or the token-guarded test fixture reference — while rejecting empty
 * strings, whitespace, control characters and unbounded input.
 */
export const PAYMENT_REFERENCE_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Retired placeholder references that must NEVER be accepted as settlement evidence.
 * These were synthesised by the backend itself (`youpi_reconciled` by the reconciliation
 * endpoint, `youpi_settlement` by the webhook parser) when a real reference was absent,
 * which let an order be marked paid against a reference that no gateway ever issued.
 */
export const SYNTHETIC_PAYMENT_REFERENCES: readonly string[] = ['youpi_reconciled', 'youpi_settlement'];
