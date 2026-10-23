# PHASE 10 — VÉRRO REAL PAYMENT RAIL HANDOFF REPORT
**Status: Payment Rail Discovery Audit Complete — Implementation Handoff Required**

---

## Executive Summary

Phase 10 conducted a comprehensive workspace discovery audit to locate the real VÉRRO payment rail implementation, backend server, gateway APIs, and cryptographic webhook signatures. 

**Audit Conclusion:**
No real payment gateway API, payment server, merchant credentials, or proprietary payment backend exists within the workspace, adjacent repositories, or host environment.

In strict compliance with the Phase 10 directive:
- **Zero payment gateways were fabricated or simulated.**
- **Stripe, Razorpay, Instamojo, and third-party libraries were strictly rejected.**
- **No orders were marked as paid without real settlement.**
- **Implementation is paused at the discovery audit boundary.**

This document provides the exhaustive architectural handoff specification, detailing the exact API contract, data structures, webhook protocol, customer token lifecycle, rate limiting implementations, and security requirements needed to plug the genuine payment rail into `backend/src/adapters/paymentGatewayAdapter.ts`.

---

## 1. Subsystem Readiness Matrix

| Subsystem | Readiness Status | Verification Basis |
| :--- | :---: | :--- |
| **Storefront Architecture** | **READY** | Native ES modules, locked Bodoni/Space/Mono typography, responsive 6-viewport verified baseline. |
| **Order Creation** | **READY** | Real SQLite persistence (`better-sqlite3`), authoritative ₹399 catalog pricing, idempotency tracking. |
| **Payment Rail** | **NOT READY** | **Zero real payment gateway code, server, or merchant credentials exist in the accessible environment.** |
| **Customer Authorization** | **PARTIALLY READY** | Cryptographic bearer token boundary (`cst_...` hashed via SHA-256) functional; email magic-link delivery pending. |
| **Fulfillment Engine** | **READY** | 5-step strict server-side guard: order existence, paid status, purchaser token, catalog match, file presence. |
| **Download Delivery** | **READY** | Short-lived signed download tokens (15-min TTL) streaming private master archive via backend route. |
| **Private Storage** | **READY (DEV)** | Master archive strictly isolated in `backend/storage/private_masters/`; web root protected via `serve.json`. |
| **Production Storage** | **NOT READY** | Requires private AWS S3 / Cloudflare R2 bucket with pre-signed temporary URLs. |
| **Transactional Email** | **NOT READY** | Requires provider integration (Resend / AWS SES / Postmark) for outbound customer entitlement delivery. |
| **Production Deployment** | **NOT READY** | Blocked by missing real payment rail, domain/SSL certificate, cloud storage, and email infrastructure. |

---

## A. What Was Searched

The discovery audit inspected all accessible workspace and local filesystem locations:

1. **Current Project (`/Users/darshan/Desktop/stitch_v_rro_digital_art_gallery`):**
   - Full recursive directory tree inspection.
   - Grep searches for `payment`, `gateway`, `checkoutUrl`, `session`, `webhook`, `signature`.
   - Inspection of `backend/src/adapters/`, `backend/src/controllers/`, `backend/src/routes/`.
   - Environment templates (`backend/.env.example`).
   - Git repository state (uninitialized/clean).
2. **Adjacent Desktop Workspaces (`/Users/darshan/Desktop/`):**
   - `catchpe-split/` (AI Studio Gemini web app; zero payment logic).
   - `CLDESK/` (SpendPulse Android documentation and Play Store ₹99 one-time in-app monetization spec; no web payment rail).
   - `security-audit/` (Static markdown audit guidelines; no payment backend).
   - `v&d-detailing-feedback-&-reputation-assistant/` (Automotive detailing reputation SaaS; zero commerce gateway).
3. **Machine-Wide System Files (`/Users/darshan/`):**
   - Scanned for repositories or packages matching `*payment*`, `*gateway*`, `*verro*`. Only native macOS PassKit system frameworks were present.

---

## B. What Was Found

1. **Payment Gateway Abstraction Interface:**
   - Location: [`backend/src/adapters/paymentGatewayAdapter.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/adapters/paymentGatewayAdapter.ts)
   - Defines standard interface: `createPaymentSession()`, `verifyPayment()`, `handleWebhook()`.
2. **Safe Development Mock Adapter:**
   - Location: [`backend/src/adapters/developmentPaymentAdapter.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/adapters/developmentPaymentAdapter.ts)
   - Explicitly marked `isProductionReady = false`. Rejects real money settlement.
3. **Webhook Intake Controller:**
   - Location: [`backend/src/controllers/webhookController.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/controllers/webhookController.ts)
   - Implements event deduplication and signature verification delegation.
4. **Environment Placeholder Configuration:**
   - Location: [`backend/src/config/env.ts`](file:///Users/darshan/Desktop/stitch_v_rro_digital_art_gallery/backend/src/config/env.ts)
   - Exposes empty variables: `PAYMENT_GATEWAY_BASE_URL`, `PAYMENT_GATEWAY_SECRET`, `WEBHOOK_SECRET`.

---

## C. What Payment API Information Is Missing

To connect the real payment rail, the following critical engineering specifications must be provided:

1. **Gateway Identity & Protocol:**
   - Is the gateway a proprietary VÉRRO microservice, a banking API, or a self-hosted payment daemon?
   - Communication protocol (REST JSON, gRPC, ISO 8583, or hosted checkout redirect).
2. **Endpoint URLs:**
   - Sandbox / Test Gateway Base URL.
   - Production Gateway Base URL.
3. **Authentication Scheme:**
   - API Key, Bearer Token, Mutual TLS (mTLS), or HMAC request signing headers.
4. **Checkout Initiation Contract:**
   - Exact endpoint for creating a session (e.g. `POST /v1/checkout/sessions`).
   - Does the customer pay on a hosted gateway page (`checkoutUrl`) or via an embedded modal/SDK?
5. **Settlement Verification Contract:**
   - Synchronous server-to-server verification endpoint (e.g. `GET /v1/payments/:id` or `POST /v1/payments/verify`).
6. **Webhook Signature Specification:**
   - Signature header name (e.g. `X-VERRO-Signature`, `X-Gateway-Signature`).
   - Signing algorithm (e.g. HMAC-SHA256, Ed25519, RSA-SHA256).
   - Exact signature payload construction (e.g. `timestamp + "." + rawBody`).
7. **Gateway State Machine Values:**
   - Canonical status strings representing success, failure, authorization, and cancellation.

---

## D. Exact API Contract Needed for `ProductionPaymentAdapter`

When the real payment gateway is supplied, it must fulfill this TypeScript contract:

```typescript
export interface ProductionPaymentConfig {
  baseUrl: string;
  merchantId: string;
  apiKey: string;
  webhookSecret: string;
  timeoutMs: number;
}

export class ProductionPaymentAdapter implements PaymentGatewayAdapter {
  readonly adapterName = 'VÉRRO Production Payment Rail';
  readonly isProductionReady = true;

  /**
   * 1. Create Checkout Session
   * Called by OrderService when customer clicks Acquire CTA.
   * Sends order details to gateway and returns customer redirect URL.
   */
  async createPaymentSession(order: OrderRecord): Promise<{
    sessionId: string;
    checkoutUrl: string;
    amount: number;
    currency: string;
    mode: 'production';
  }>;

  /**
   * 2. Authoritative Payment Verification
   * Called upon browser return or manual reconciliation.
   * Directly queries gateway server to verify genuine settlement.
   */
  async verifyPayment(orderId: string, paymentReference: string): Promise<{
    isPaid: boolean;
    paymentReference: string;
    gatewayTransactionId: string;
    amount: number;
    currency: string;
    status: 'paid' | 'unpaid' | 'failed' | 'pending';
  }>;

  /**
   * 3. Asynchronous Webhook Event Intake
   * Validates raw HTTP body against cryptographic signature.
   * Prevents replay attacks and verifies event authenticity.
   */
  async handleWebhook(rawPayload: string, signatureHeader?: string): Promise<{
    isValid: boolean;
    eventId: string;
    orderId: string;
    status: 'paid' | 'failed';
    paymentReference: string;
    gatewayTransactionId: string;
    amount: number;
    currency: string;
    timestamp: string;
  }>;
}
```

---

## E. Exact Integration Inputs Required

The following environment variables must be populated in `backend/.env`:

```ini
# Production Payment Rail Configuration
PAYMENT_GATEWAY_PROVIDER=verro_custom_rail
PAYMENT_GATEWAY_BASE_URL=https://api.gateway.example.com
PAYMENT_GATEWAY_MERCHANT_ID=mch_verro_live_01
PAYMENT_GATEWAY_API_KEY=key_live_xxxxxxxxxxxxxxxxxxxx
PAYMENT_GATEWAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
PAYMENT_GATEWAY_RETURN_URL=https://verro.art/checkout/return
PAYMENT_GATEWAY_CANCEL_URL=https://verro.art/checkout/cancel
```

---

## F. Security & Architecture Requirements

### 1. Zero Client-Authoritative Settlement
- A browser redirect to `/return` or `/success` **must never** mark an order as paid.
- Settlement authority belongs solely to:
  1. Cryptographically verified server-to-server webhook callback, OR
  2. Server-initiated polling verification against the gateway's settlement API.

### 2. Customer Token Lifecycle Audit (Step 8 Resolution)
**Threat Scenario:** If the purchaser token is stored solely in browser volatile memory, a customer who:
- Leaves the storefront for an external bank 3D-Secure window,
- Closes or refreshes the tab,
- Completes payment on mobile and returns via redirect,
will lose their in-memory token and be unable to access their purchased master archive.

**Production Entitlement Solution:**
1. **Single-Use Signed Return Token:** The payment gateway return redirect must include a cryptographically signed, single-use grant:
   `https://verro.art/order/confirmed?orderId=...&grant=<one_time_token>`
   The backend validates the grant once, issues an `HttpOnly`, `SameSite=Strict`, `Secure` session cookie, and immediately burns the grant.
2. **Outbound Transactional Email Magic-Link:** The authoritative settlement webhook automatically triggers an email containing a persistent download retrieval link with a fresh customer access token.
3. **No Long-Lived Secrets in LocalStorage:** Storing permanent tokens in `localStorage` is explicitly forbidden to prevent cross-site scripting (XSS) compromise.

### 3. Rate Limiting Protection (Step 13 Implementation)
In-memory rate limiting has been integrated into `backend/src/middleware/rateLimiter.ts`:
- **Order Creation:** Capped at 30 requests/minute per IP (prevents order table flooding).
- **Order Status Queries:** Capped at 100 queries/minute per IP.
- **Download Authorization & Streaming:** Capped at 50 requests/15 minutes per IP.
- **Webhook Intake:** Capped at 200 events/minute per IP.
Exceeding limits returns `HTTP 429 Too Many Requests` with a standard `Retry-After` header.

### 4. Production Secret Audit (Step 17 Verification)
- Automated AST and regex scan across all repository files confirmed **zero plaintext keys, tokens, or credentials** in frontend JavaScript, HTML, CSS, public assets, or committed backend files.
- All secrets are resolved strictly from `process.env`.

### 5. Database Durability Review (Step 12 Verification)
- **Current SQLite (`better-sqlite3`):** High performance with Write-Ahead Logging (`WAL`) and strict foreign keys.
- **Production Assessment:** Fully durable for single-instance virtual machines (AWS EC2, Fly.io persistent volumes, Hetzner VPS). If deployed to stateless serverless containers (AWS Lambda, Vercel), migration to managed PostgreSQL is required. Schema data types and queries are already PostgreSQL-compatible.

---

## G. Next Action Required Before Coding Can Continue

Implementation cannot proceed until the user or payment infrastructure team supplies:

1. The real payment gateway documentation or repository.
2. Gateway sandbox credentials (`PAYMENT_GATEWAY_BASE_URL`, `API_KEY`, `WEBHOOK_SECRET`).
3. Confirmation of whether checkout is hosted or embedded.
4. The exact webhook cryptographic signing specification.

**Work is stopped at Phase 10 as mandated.**
