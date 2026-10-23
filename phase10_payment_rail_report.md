# PHASE 10 — VÉRRO REAL PAYMENT RAIL & PRODUCTION PAYMENT ADAPTER REPORT

**Date:** 2026-09-27  
**Execution Phase:** Phase 10 — Real Payment Rail Handoff & Architecture Audit  
**Status:** Discovery Complete — Production Payment Adapter Paused Awaiting Real Gateway

---

## Executive Summary

Phase 10 executed an exhaustive search across the current workspace, adjacent local workspaces, and host environment to identify the genuine VÉRRO payment rail implementation. 

**Discovery Conclusion:**  
No proprietary VÉRRO payment server, payment gateway routes, merchant credentials, or transaction verification APIs currently exist in the accessible environment.

In strict compliance with the Phase 10 mandate:
- **Zero payment providers were invented.**
- **Stripe, Razorpay, Instamojo, and third-party gateways were strictly rejected.**
- **No fake endpoints or synthetic payment flows were fabricated.**
- **No orders were marked paid without authentic server-side settlement.**
- **Implementation is paused at the discovery audit boundary.**

This document provides the authoritative report covering all requirements (A through P) of Phase 10.

---

## Master Subsystem Readiness Matrix

| Subsystem | Readiness Status | Verification Basis |
| :--- | :---: | :--- |
| **Storefront Architecture** | **READY** | Native ES modules, locked typography (Bodoni Moda / Space Grotesk / IBM Plex Mono), 6-viewport visual QA verified. |
| **Catalog & Order Authority** | **READY** | SQLite persistence (`better-sqlite3`), authoritative ₹399 pricing, client tampering rejected, idempotency enforced. |
| **Real Payment Rail** | **NOT READY** | **Zero real payment gateway code, server, or merchant credentials exist in the accessible workspace.** |
| **ProductionPaymentAdapter** | **NOT READY** | Adapter interface defined; production implementation intentionally paused awaiting real gateway API contract. |
| **Customer Entitlement Boundary** | **PARTIALLY READY** | Cryptographic bearer token (`cst_...` hashed via SHA-256) functional; persistent email/session restoration pending. |
| **Fulfillment & Streaming Engine** | **READY** | Strict 5-guard fulfillment verification: order existence, paid status, purchaser token hash, catalog match, archive presence. |
| **Private Master Storage** | **READY (DEV)** / **NOT READY (PROD)** | Local dev archive isolated in `backend/storage/private_masters/`; AWS S3 / Cloudflare R2 private bucket pending. |
| **Transactional Email Delivery** | **NOT READY** | Development logger mock operational; real transactional email service (Resend / AWS SES / Postmark) pending. |
| **Database Durability** | **READY (DEV / VPS)** / **PARTIALLY READY (PROD)** | SQLite WAL mode and foreign keys active; migration to PostgreSQL required only if deployed to serverless containers. |
| **Rate Limiting** | **READY** | Sliding-window limiters active on order creation (30/m), status (100/m), download (50/15m), webhooks (200/m). |
| **Production Deployment** | **NOT READY** | Blocked by missing real payment rail, cloud object storage, transactional email provider, domain, and SSL. |

---

## A. Real Payment System Discovered

The workspace and machine discovery audit inspected:

1. **Active Project (`/Users/darshan/Desktop/stitch_v_rro_digital_art_gallery`):**
   - Recursive inspection of all source files, configurations, scripts, and documentation.
   - Grep searches for `payment`, `gateway`, `checkoutUrl`, `session`, `webhook`, `signature`.
   - Inspection of `backend/src/adapters/`, `backend/src/controllers/`, `backend/src/routes/`.
   - Inspection of `backend/.env.example` and runtime environment definitions.
2. **Adjacent Desktop Workspaces (`/Users/darshan/Desktop/`):**
   - `catchpe-split/`: Google AI Studio Gemini application; zero payment infrastructure.
   - `CLDESK/`: SpendPulse Android documentation and Play Store ₹99 one-time in-app monetization spec; no web payment rail.
   - `security-audit/`: Static markdown security guidelines; zero payment implementation.
   - `v&d-detailing-feedback-&-reputation-assistant/`: Automotive detailing SaaS; zero commerce gateway.
3. **Machine-Wide System Files (`/Users/darshan/`):**
   - Scanned for payment repositories, daemons, or credentials. Only native macOS PassKit system frameworks were located.

**Finding:**  
No proprietary VÉRRO payment backend, gateway daemon, or merchant account exists in the accessible workspace.

---

## B. Exact Payment API Contract

When the real payment gateway implementation is made available, it must conform to the following contract to plug seamlessly into the commerce backend:

### 1. Checkout Session Creation
- **Endpoint:** `POST {GATEWAY_BASE_URL}/v1/checkout/sessions`
- **Request Headers:**
  - `Authorization: Bearer {PAYMENT_GATEWAY_API_KEY}`
  - `Content-Type: application/json`
  - `Idempotency-Key: {VÉRRO_ORDER_ID}`
- **Request Payload:**
  ```json
  {
    "orderId": "ord_verro_1790526437498_8178289516da300d",
    "amount": 39900,
    "currency": "INR",
    "customer": {
      "email": "buyer@example.com"
    },
    "returnUrl": "https://verro.art/order/confirmed?orderId=ord_verro_1790526437498_8178289516da300d&grant={RETURN_GRANT}",
    "cancelUrl": "https://verro.art/order/cancelled?orderId=ord_verro_1790526437498_8178289516da300d",
    "metadata": {
      "productId": "vol-01",
      "edition": "Vol. 01 — Digital Master Chapter"
    }
  }
  ```
- **Response Payload (Expected):**
  ```json
  {
    "sessionId": "sess_live_99283741829",
    "checkoutUrl": "https://pay.gateway.example.com/checkout/sess_live_99283741829",
    "paymentReference": "pay_ref_live_019283",
    "status": "pending",
    "expiresAt": "2026-09-27T17:12:00.000Z"
  }
  ```

### 2. Server-to-Server Payment Verification
- **Endpoint:** `GET {GATEWAY_BASE_URL}/v1/payments/{PAYMENT_REFERENCE}`
- **Request Headers:**
  - `Authorization: Bearer {PAYMENT_GATEWAY_API_KEY}`
- **Response Payload (Expected):**
  ```json
  {
    "paymentReference": "pay_ref_live_019283",
    "gatewayTransactionId": "txn_live_98127391823",
    "orderId": "ord_verro_1790526437498_8178289516da300d",
    "amount": 39900,
    "currency": "INR",
    "status": "settled",
    "settledAt": "2026-09-27T16:30:15.000Z"
  }
  ```

### 3. Webhook Delivery Specification
- **Endpoint:** `POST https://api.verro.art/api/v1/webhooks/payment`
- **Request Headers:**
  - `X-Gateway-Signature: t=1790526615,v1=a9f3b8c7...` (HMAC-SHA256 of `timestamp + "." + rawBody`)
  - `Content-Type: application/json`
- **Payload:**
  ```json
  {
    "id": "evt_live_88371928301",
    "type": "payment.settled",
    "timestamp": 1790526615,
    "data": {
      "orderId": "ord_verro_1790526437498_8178289516da300d",
      "paymentReference": "pay_ref_live_019283",
      "gatewayTransactionId": "txn_live_98127391823",
      "amount": 39900,
      "currency": "INR",
      "status": "paid"
    }
  }
  ```

---

## C. ProductionPaymentAdapter Implementation

The adapter interface is defined in [`backend/src/adapters/paymentGatewayAdapter.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/adapters/paymentGatewayAdapter.ts):

```typescript
export interface PaymentGatewayAdapter {
  readonly adapterName: string;
  readonly isProductionReady: boolean;
  createPaymentSession(order: OrderRecord): Promise<PaymentSessionResult>;
  verifyPayment(orderId: string, paymentReference: string): Promise<PaymentVerificationResult>;
  handleWebhook(rawPayload: string, signatureHeader?: string): Promise<PaymentWebhookEvent>;
}
```

- **Current Adapter:** [`DevelopmentPaymentAdapter`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/adapters/developmentPaymentAdapter.ts) (`isProductionReady = false`). It rejects real settlement, requires explicit cryptographic HMAC signatures in test fixtures, and refuses hardcoded public secret literals.
- **Production Adapter:** `ProductionPaymentAdapter` has **NOT** been implemented because doing so without the real gateway would require fabricating synthetic endpoints, mock tokens, or an unauthorized third-party gateway (violating the core project constraint).
- **Status:** **NOT READY** (Waiting for real gateway backend code or API specification).

---

## D. Order / Payment Mapping

The commerce database schema maintains an immutable, server-authoritative relationship between VÉRRO orders and payment transactions:

```
[VÉRRO Storefront]
       ↓ (1) POST /orders/create { productId: "vol-01", email: "..." }
[OrderService]
       ↓ (2) Insert Order (status: "pending", amount: 39900 paise)
[Orders Database]
       ↓ (3) createPaymentSession(order)
[Payment Gateway] → Returns { paymentReference, checkoutUrl }
       ↓ (4) Update Order (status: "payment_pending", payment_reference: "pay_ref_...")
[Orders Database]
       ↓ (5) Authoritative Settlement (Webhook or Server Verification)
[Payment Adapter] → Validates HMAC & status == "paid"
       ↓ (6) Update Order (status: "paid", gateway_transaction_id: "txn_...", paid_at: NOW)
[Orders Database]
       ↓ (7) Trigger Fulfillment & Issue Download Token
[Customer Entitlement]
```

**Security Invariant:**  
The client is never accepted as an authority on payment status. A client sending `status: "paid"` is completely ignored by `POST /orders/create`. Order state transitions to `paid` occur exclusively inside `orderService.markOrderPaid()`.

---

## E. Verification Mechanism

1. **Browser Redirects Are Never Authority:**  
   Redirecting a user to `/payment/success` or `/order/confirmed` is treated purely as an informational UX transition. The storefront polls `GET /orders/:id/status` with its bearer token, which reads the current state from the database.
2. **Two Authoritative Verification Paths:**
   - **Path A (Primary — Webhook):** The real gateway issues an asynchronous server-to-server webhook containing cryptographic proof of settlement.
   - **Path B (Secondary — Reconciliation):** The backend queries the gateway's settlement API via `verifyPayment(orderId, paymentReference)`.
3. **Recorded Audit Data:**
   Upon confirmed verification, the database commits:
   - `payment_reference`: Provider's reference ID.
   - `gateway_transaction_id`: Cryptographic settlement transaction identifier.
   - `paid_at`: ISO 8601 UTC timestamp of verified settlement.
   - `status`: Transitioned from `payment_pending` to `paid`.

---

## F. Webhook Security

The webhook implementation in [`backend/src/controllers/webhookController.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/controllers/webhookController.ts) enforces:

1. **Raw Body Integrity:**  
   The webhook route (`/api/v1/webhooks/payment`) intakes requests as raw byte streams (`express.raw({ type: 'application/json' })`). Global JSON parsers are excluded to eliminate whitespace mutation that invalidates HMAC-SHA256 signatures.
2. **Cryptographic Signature Verification:**  
   The signature is computed over the exact raw buffer using the shared webhook secret. Verification uses `crypto.timingSafeEqual` with 32-byte SHA-256 digests to prevent timing attacks. Public fallback secrets are strictly rejected.
3. **Event Identifier Bounding:**  
   Event IDs are sanitized against `^[A-Za-z0-9_.:-]{1,128}$` to prevent injection and buffer exhaustion.
4. **Idempotency & Replay Protection:**  
   Events are recorded in `idempotency_keys` under `webhook_evt_{env}_{eventId}`. Replay attempts return `HTTP 200` with the cached acknowledgement response without triggering duplicate fulfillment or email delivery.

---

## G. Customer Entitlement Lifecycle

### Vulnerability Audit of In-Memory Tokens
Currently, the storefront stores the purchaser access token (`cst_...`) in JavaScript volatile memory.
- If a customer leaves the storefront for bank 3D-Secure verification,
- Closes the browser or refreshes the page,
- Or completes purchase on mobile and redirects to VÉRRO,  
the in-memory token is cleared, leaving the customer unable to retrieve their purchased digital archive.

### Production Solution Architecture
1. **Single-Use Signed Return Grant:**  
   The payment return redirect must provide a temporary, signed grant:  
   `https://verro.art/order/confirmed?orderId=...&grant=<signed_grant>`  
   The backend validates the grant once, issues a short-lived `HttpOnly`, `SameSite=Strict`, `Secure` session cookie, and burns the grant immediately.
2. **Transactional Email Magic Link:**  
   Upon payment settlement, the backend dispatches an email containing a persistent access link with a cryptographic retrieval token.
3. **Prohibition of LocalStorage Secrets:**  
   Permanent purchaser access tokens are prohibited from `localStorage` to safeguard against Cross-Site Scripting (XSS) compromise.

---

## H. Email Delivery Status

- **Current Implementation:** [`backend/src/services/emailService.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/services/emailService.ts) operates as a structured development logger mock.
- **Provider Readiness:** **NOT READY**.
- **Production Integration Path:**  
  Requires an outbound email provider (Resend, AWS SES, or Postmark). The service abstraction (`sendOrderConfirmation`, `sendDownloadAccess`) is already isolated and requires only plugging in the production API key and transport.

---

## I. Private Storage Status

- **Development Implementation:** The master archive is stored at `backend/storage/private_masters/vol-01-master.zip`, outside the static public web directory. All web requests to `private_masters/` are redirected via `serve.json`.
- **Status:** **READY (DEV)** / **NOT READY (PROD)**.
- **Production Requirement:**  
  Production master assets must not be stored on the application server disk. They must reside in a private AWS S3 or Cloudflare R2 bucket with:
  - All public read permissions disabled.
  - Temporary download URLs generated via pre-signed S3 `GetObjectCommand` with a 15-minute TTL.

---

## J. Database Production Status

- **Current Implementation:** SQLite via `better-sqlite3` located at `backend/verro_commerce.sqlite`.
- **Durability Features Active:**
  - Write-Ahead Logging (`PRAGMA journal_mode = WAL`).
  - Foreign key enforcement (`PRAGMA foreign_keys = ON`).
  - Busy timeout (`PRAGMA busy_timeout = 5000`).
  - Synchronous mode normal (`PRAGMA synchronous = NORMAL`).
- **Production Readiness:**
  - **Single-Node VPS (Hetzner / AWS EC2 / Fly.io with persistent volume):** **READY**. SQLite handles >1,000 writes/sec with WAL mode.
  - **Serverless Containers (AWS Lambda / Vercel):** **PARTIALLY READY**. Serverless ephemeral filesystems discard SQLite data. Migration to managed PostgreSQL (`pg`) is documented; SQL schemas and parameterized statements are directly compatible.

---

## K. Rate Limiting Protection

In-memory sliding-window rate limiters are implemented in [`backend/src/middleware/rateLimiter.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/middleware/rateLimiter.ts):

| Endpoint Route | Limit | Window | Action on Limit Exceeded |
| :--- | :---: | :---: | :--- |
| `POST /api/v1/orders/create` | 30 requests | 1 minute | HTTP 429 Too Many Requests, `Retry-After: 60` |
| `GET /api/v1/orders/:id/status` | 100 requests | 1 minute | HTTP 429 Too Many Requests, `Retry-After: 60` |
| `POST /api/v1/orders/:id/download` | 50 requests | 15 minutes | HTTP 429 Too Many Requests, `Retry-After: 900` |
| `POST /api/v1/webhooks/payment` | 200 requests | 1 minute | HTTP 429 Too Many Requests, `Retry-After: 60` |

- Internal limit counter headers (`X-RateLimit-*`) are stripped from public responses to prevent reconnaissance.
- Standard `Retry-After` headers are preserved for compliance.
- Status: **READY**.

---

## L. Security Attack-Test Results

The comprehensive security and adversarial test suites were executed with 100% pass rates:

### 1. Backend Security Test Suite (`backend/tests/backend.test.ts`)
- **Total Tests:** 19
- **Passed:** 19
- **Failed:** 0
- **Verifications:**
  - Authoritative server pricing enforced (client tampering ignored).
  - Unpaid orders strictly rejected from download (HTTP 403).
  - Webhooks signed with public dev secret rejected (F1).
  - Tampered and cross-order download tokens rejected.
  - Storage package allowlist blocks directory traversal.
  - Prototype pollution payload rejected safely.
  - Sensitive responses marked `Cache-Control: no-store`.
  - Test fixture routes unmounted by default (`testRoutesEnabled = false`).
  - Framework fingerprint headers (`X-Powered-By`) suppressed.
  - Webhook signatures bound to exact raw byte body.

### 2. E2E Adversarial Attack Suite (`tests/e2e-commerce.test.js`)
- **Total Tests:** 22
- **Passed:** 22
- **Failed:** 0
- **Adversarial Scenarios:**
  - `SEC-1`: Client price tampering ignored — **PASS**
  - `SEC-2`: Forged `status="paid"` during order creation ignored — **PASS**
  - `SEC-3`: Invalid product ID rejected (HTTP 400) — **PASS**
  - `SEC-4`: Random order ID enumeration safely returns HTTP 404 — **PASS**
  - `SEC-5`: Malformed download token rejected (HTTP 403) — **PASS**
  - `SEC-6`: Expired download token rejected (HTTP 403) — **PASS**
  - `SEC-7`: Idempotency key prevents duplicate charge/order creation — **PASS**

---

## M. Real Sandbox E2E Results

- **Real Gateway Sandbox Flow:** **NOT RUN**.  
  In strict adherence to Step 15 ("If no sandbox exists, STOP before attempting real settlement and report the missing capability"), no fake sandbox was constructed.
- **Local Isolated Commerce E2E Flow:** **22 PASSED, 0 FAILED**.  
  Verified complete storefront order creation, authoritative price enforcement, state transition via authorized test fixture, and secure streaming of the private development master archive.

---

## N. Six Viewport Visual Regression Results

Headless browser QA visual regression tests were executed across all 6 target screen dimensions:

| Index | Viewport Name | Dimensions | Horizontal Overflow | Broken Images | Console Errors | Status |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 0 | Mobile Small | 390 × 844 | 0px | 0 | 0 | **PASS** |
| 1 | Mobile Standard | 430 × 932 | 0px | 0 | 0 | **PASS** |
| 2 | Tablet Portrait | 768 × 1024 | 0px | 0 | 0 | **PASS** |
| 3 | Desktop Small | 1024 × 768 | 0px | 0 | 0 | **PASS** |
| 4 | Desktop Standard | 1440 × 900 | 0px | 0 | 0 | **PASS** |
| 5 | Desktop Wide | 1728 × 1080 | 0px | 0 | 0 | **PASS** |

- Zero horizontal scrollbar/overflow detected.
- All 11 local image assets rendered without errors.
- Checkout CTA transitions into `payment_pending` seamlessly.
- Lightbox modal dialog semantics (`aria-modal="true"`, `role="dialog"`) and keyboard navigation verified.
- Mobile drawer and FAQ accordion interactions verified.

---

## O. Remaining Blockers

Before VÉRRO can process live transactions, four external production dependencies must be resolved:

1. **Real Payment Rail Service:** Missing API base URL, merchant credentials, checkout redirect contract, and webhook signing secret.
2. **Production Cloud Object Storage:** Missing AWS S3 or Cloudflare R2 bucket with pre-signed URL generation.
3. **Transactional Email Service:** Missing Resend / AWS SES / Postmark API key for automated customer entitlement restoration.
4. **Production Domain & TLS:** Need live domain DNS configuration and automated SSL certificates (e.g. Let's Encrypt / Caddy / Cloudflare).

---

## P. Exact Production Deployment Prerequisites

To achieve live launch readiness, execute the following operational steps:

```bash
# 1. Provide Payment Gateway Credentials in backend/.env:
PAYMENT_GATEWAY_PROVIDER=verro_custom_rail
PAYMENT_GATEWAY_BASE_URL=https://api.gateway.example.com
PAYMENT_GATEWAY_MERCHANT_ID=mch_live_xxxxxxxx
PAYMENT_GATEWAY_API_KEY=key_live_xxxxxxxxxxxxxxxxxxxx
PAYMENT_GATEWAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx

# 2. Provide Production Object Storage Credentials:
STORAGE_PROVIDER=s3 # or r2
AWS_REGION=ap-south-1
S3_BUCKET_NAME=verro-digital-masters-private
AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxxxxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 3. Provide Transactional Email Credentials:
EMAIL_PROVIDER=resend # or ses, postmark
EMAIL_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM_ADDRESS="VÉRRO Art Editions <editions@verro.art>"

# 4. Generate Strong Cryptographic Secrets:
APP_SECRET=$(openssl rand -hex 32)
CUSTOMER_TOKEN_SECRET=$(openssl rand -hex 32)
DOWNLOAD_TOKEN_SECRET=$(openssl rand -hex 32)

# 5. Enable Production Security Guardrails:
NODE_ENV=production
ENABLE_TEST_ROUTES=false
ALLOWED_ORIGIN=https://verro.art
PORT=4000
```

---

*Report certified complete in accordance with Phase 10 directives. Implementation is paused pending real payment rail provision.*
