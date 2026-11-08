/**
 * VÉRRO Digital Art Gallery — Storefront Commerce Gateway Service (Phase 9)
 * Production-ready client integration with local commerce backend (http://127.0.0.1:4000)
 * 
 * Strict Guarantees:
 * - Zero third-party payment providers (no Stripe, Razorpay, or Instamojo)
 * - Zero client-side price authority (price, currency, and settlement are server-authoritative)
 * - Zero simulated fake checkouts or fabricated payment successes
 * - Strict purchaser access token boundary for fulfillment authorization
 * - Authoritative server-side status checks (GET /api/v1/orders/:orderId)
 */

// Authoritative Backend Configuration
const GATEWAY_CONFIG = {
  apiBaseUrl: typeof window !== 'undefined' && window.__VERRO_GATEWAY_URL__ 
    ? window.__VERRO_GATEWAY_URL__ 
    : 'http://127.0.0.1:4000',
  currency: 'INR',
  timeoutMs: 10000
};

import { openPaymentModal } from '../components/PaymentModal.js';

/** sessionStorage key holding the in-flight purchase so a refresh can resume it. */
const ACTIVE_PURCHASE_KEY = 'verro_active_purchase';

/**
 * A resumed purchase is only honoured for 30 minutes (refresh/interruption-safety).
 *
 * Anything older is stale: the order may still exist server-side, but silently resuming an
 * ancient checkout is more confusing than starting a fresh one, and an idempotency key must
 * never be reused indefinitely.
 */
const ACTIVE_PURCHASE_TTL_MS = 30 * 60 * 1000;

/**
 * Origins allowed to drive the embedded checkout iframe via postMessage.
 *
 * The previous handler acted on ANY message that happened to carry a `youpi.payment_success`
 * event name, so anything holding a window reference — a cross-origin iframe, an embedded
 * widget, an opener — could steer the storefront into "settling" a purchase. Settlement is
 * re-verified server-side now, but the message surface is restricted as well.
 */
function resolveCheckoutOrigins() {
  const origins = new Set();

  const add = (value) => {
    try {
      if (value) origins.add(new URL(value, window.location.href).origin);
    } catch {
      // Ignore malformed configuration rather than trusting it.
    }
  };

  if (typeof window !== 'undefined') {
    add(GATEWAY_CONFIG.apiBaseUrl);
    add(window.__VERRO_YOUPI_URL__);
    add(window.__VERRO_YOUPI_ORIGIN__);
    add(window.location.href);
    ['http://localhost:7000', 'http://127.0.0.1:7000'].forEach(add);
  }

  return origins;
}

/**
 * F-42: opaque client-side identifiers (idempotency keys) must come from a CSPRNG.
 *
 * `Math.random()` is not cryptographically secure and is seedable/predictable, which matters
 * for the idempotency key: whoever presents a key first owns the stored response for it. The
 * fallback still mixes timestamp + counter so it cannot collide, and is only reached in
 * environments without WebCrypto.
 */
let opaqueCounter = 0;
function generateOpaqueId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}_${hex}`;
  }
  opaqueCounter += 1;
  return `${prefix}_${Date.now()}_${opaqueCounter}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * F-42: server-provided strings are rendered into the storefront chrome, so never trust them
 * as markup. Escaping at the single interpolation point is cheaper to audit than escaping at
 * every call site.
 */
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

/**
 * Validated Commerce Lifecycle State Model
 * Supported by backend and storefront
 * @typedef {'idle' | 'creating_order' | 'payment_pending' | 'failed' | 'cancelled' | 'paid'} PurchaseState
 */

export const purchaseService = {
  /** @type {PurchaseState} */
  currentState: 'idle',

  /**
   * Authoritative active order object returned by backend
   * @type {{ orderId: string, productId: string, amount: number, formattedAmount: string, currency: string, status: string, customerAccessToken?: string, createdAt: string } | null}
   */
  currentOrder: null,

  /**
   * Active idempotency key for current purchase attempt
   * @type {string | null}
   */
  activeIdempotencyKey: null,

  /**
   * Pending order creation promise to prevent duplicate concurrent clicks
   * @type {Promise<any> | null}
   */
  _inflightPromise: null,

  /**
   * Centralized Checkout Initiation
   * Creates a real order on the commerce backend with authoritative pricing
   * @param {string} productId - Canonical product ID (e.g. 'vol-01')
   * @param {object} [customerInfo] - Optional buyer details
   * @returns {Promise<object>}
   */
  async checkout(productId = 'vol-01', customerInfo = {}) {
    // If an order is already paid, trigger download
    if (this.currentState === 'paid' && this.currentOrder) {
      return this.downloadMasterArchive(this.currentOrder.orderId, this.currentOrder.customerAccessToken);
    }

    // If order creation is already inflight, prevent duplicate concurrent request
    if (this._inflightPromise) {
      console.warn('[VÉRRO Commerce] Order creation already inflight. Awaiting server response.');
      return this._inflightPromise;
    }

    // Refresh / interruption recovery: rebuild the in-flight purchase from sessionStorage
    // BEFORE creating anything, so reloading mid-payment resumes the SAME order instead of
    // minting a second one for the same buyer.
    if (!this.currentOrder || this.currentState === 'idle') {
      const restored = this.restoreActivePurchase();
      if (restored) {
        this.currentOrder = {
          orderId: restored.orderId,
          productId: restored.productId,
          amount: restored.amount,
          currency: restored.currency,
          status: restored.status,
          customerAccessToken: restored.customerAccessToken
        };
        this.currentState = 'payment_pending';
        // Reusing the persisted key means any retry replays the same order server-side
        // rather than creating a parallel one.
        this.activeIdempotencyKey = restored.idempotencyKey || null;

        console.info(`[VÉRRO Commerce] Resumed in-flight purchase "${restored.orderId}" after interruption.`);
        this.notifyStateChange(this.currentState, this.currentOrder);
        this.updateStorefrontCta(this.currentState, this.currentOrder);
        this.displayArchivalToast(`RESUMED ORDER #${restored.orderId} · PAYMENT PENDING`);

        if (typeof window !== 'undefined' && !window.__E2E_TEST_ENV__) {
          this.openPaymentModal(this.currentOrder);
        }
        return this.getOrderStatus(restored.orderId, restored.customerAccessToken);
      }
    }

    // If an order is already in payment_pending, check its authoritative status and re-open modal
    if (this.currentState === 'payment_pending' && this.currentOrder) {
      console.info(`[VÉRRO Commerce] Checking authoritative status for existing order "${this.currentOrder.orderId}"...`);
      if (typeof window !== 'undefined' && !window.__E2E_TEST_ENV__) {
        this.openPaymentModal(this.currentOrder);
      }
      return this.getOrderStatus(this.currentOrder.orderId, this.currentOrder.customerAccessToken);
    }

    // Generate or maintain idempotency key for this checkout attempt
    if (!this.activeIdempotencyKey) {
      this.activeIdempotencyKey = generateOpaqueId('ik');
    }

    this._inflightPromise = (async () => {
      try {
        // Step 1: Transition to creating_order
        this.currentState = 'creating_order';
        this.notifyStateChange(this.currentState, { productId });
        this.updateStorefrontCta(this.currentState);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GATEWAY_CONFIG.timeoutMs);

        // Step 2: Call real backend POST /api/v1/orders/create
        // Strictly send productId (and optional customerEmail) — DO NOT send client price
        const payload = {
          productId,
          customerEmail: customerInfo.email || undefined
        };

        const response = await fetch(`${GATEWAY_CONFIG.apiBaseUrl}/api/v1/orders/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': this.activeIdempotencyKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errDetail = `Server returned HTTP ${response.status}`;
          try {
            const errJson = await response.json();
            if (errJson && errJson.error) errDetail = errJson.error;
          } catch {
            // non-json error
          }
          // F-3: a 409 means this Idempotency-Key is permanently bound to a different
          // payload on the server. Retrying with the same key can never succeed, so
          // retire it here and let the next attempt generate a fresh one.
          if (response.status === 409) {
            this.activeIdempotencyKey = null;
          }
          throw new Error(errDetail);
        }

        const orderData = await response.json();

        // Step 3: Store authoritative backend order details
        this.currentOrder = orderData;
        // Refresh-safety: remember the order, its purchaser token and the idempotency key
        // that claimed it, so an interrupted checkout resumes instead of duplicating.
        this.persistActivePurchase(orderData, this.activeIdempotencyKey);
        this.activeIdempotencyKey = null; // Reset for next logical attempt

        // Step 4: Authoritative state transition based on backend response
        if (orderData.status === 'paid') {
          this.currentState = 'paid';
        } else if (orderData.status === 'cancelled') {
          this.currentState = 'cancelled';
        } else {
          this.currentState = 'payment_pending';
        }

        this.notifyStateChange(this.currentState, orderData);
        this.updateStorefrontCta(this.currentState, orderData);

        const toastMsg = orderData.checkoutUrl
          ? `ORDER #${orderData.orderId} CREATED · STATUS: PAYMENT PENDING · YOUPI READY`
          : `ORDER #${orderData.orderId} CREATED · STATUS: PAYMENT PENDING (NO PAYMENT RAIL CONNECTED)`;

        this.displayArchivalToast(toastMsg);

        // Automatically launch sovereign UPI payment modal for immediate settlement
        if (orderData.status !== 'paid' && typeof window !== 'undefined' && !window.__E2E_TEST_ENV__) {
          this.openPaymentModal(orderData);
        }

        console.info(`[VÉRRO Commerce] Real order created: ${orderData.orderId} (${orderData.formattedAmount} ${orderData.currency})`);
        return orderData;

      } catch (err) {
        this.currentState = 'failed';
        console.error('[VÉRRO Commerce Gateway Error]:', err.message);
        this.notifyStateChange(this.currentState, { error: err.message });
        this.updateStorefrontCta(this.currentState);
        this.displayArchivalToast('PAYMENT SERVICE UNAVAILABLE · PLEASE TRY AGAIN');

        return {
          status: 'failed',
          productId,
          error: err.message
        };
      } finally {
        this._inflightPromise = null;
      }
    })();

    return this._inflightPromise;
  },

  /**
   * Authoritative Server-Side Order Status Lookup
   * Connects to GET /api/v1/orders/:orderId
   * Never infers status from client-side state alone
   * @param {string} orderId 
   * @param {string} [customerAccessToken] 
   */
  async getOrderStatus(orderId, customerAccessToken) {
    const targetOrderId = orderId || (this.currentOrder && this.currentOrder.orderId);
    const token = customerAccessToken || (this.currentOrder && this.currentOrder.customerAccessToken);

    if (!targetOrderId) {
      throw new Error('No order ID provided for status check.');
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${GATEWAY_CONFIG.apiBaseUrl}/api/v1/orders/${targetOrderId}`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`Order lookup failed with status: ${response.status}`);
      }

      const statusData = await response.json();

      // Update state authoritatively based on server response
      if (statusData.status === 'paid') {
        this.currentState = 'paid';
        this.currentOrder = { ...this.currentOrder, ...statusData };
        // Settled for good: the interrupted-purchase slot has done its job.
        this.clearActivePurchase();
        this.displayArchivalToast(`ORDER #${targetOrderId} VERIFIED PAID · MASTER ARCHIVE AVAILABLE`);
      } else if (statusData.status === 'cancelled' || statusData.status === 'expired' || statusData.status === 'failed') {
        // Terminal and non-payable: resuming would only replay a dead order, so retire the
        // slot (and the bearer token stored alongside it) instead of leaving it to expire.
        // 'expired' collapses onto the storefront's 'cancelled' presentation state — the CTA
        // renderer has no dedicated expired branch and must never silently skip the update.
        this.currentState = statusData.status === 'expired' ? 'cancelled' : statusData.status;
        this.currentOrder = { ...this.currentOrder, ...statusData };
        this.clearActivePurchase();
        this.displayArchivalToast(`ORDER #${targetOrderId} ${String(statusData.status).toUpperCase()}`);
      } else {
        this.currentState = 'payment_pending';
        this.displayArchivalToast(`ORDER #${targetOrderId} STATUS: PAYMENT PENDING`);
      }

      this.notifyStateChange(this.currentState, statusData);
      this.updateStorefrontCta(this.currentState, statusData);

      return statusData;
    } catch (err) {
      console.error('[VÉRRO Order Status Error]:', err.message);
      throw err;
    }
  },

  /**
   * Derive the purchaser access token for an order from memory or the resumed session.
   *
   * The token is issued once, at order creation, and is required for every purchaser-scoped
   * operation now (reconciliation, checkout, download). Keeping the lookup in one place is
   * what stops an endpoint from silently going unauthenticated again.
   */
  getPurchaserToken(orderId) {
    if (this.currentOrder && (!orderId || this.currentOrder.orderId === orderId)) {
      return this.currentOrder.customerAccessToken || null;
    }
    const restored = this.restoreActivePurchase();
    if (restored && (!orderId || restored.orderId === orderId)) {
      return restored.customerAccessToken || null;
    }
    return null;
  },

  /**
   * Persist the in-flight purchase so an interrupted checkout survives a refresh.
   *
   * Stored in sessionStorage (per-tab, cleared when the tab closes) because the purchaser
   * access token is a bearer credential and must never outlive the browsing session.
   */
  persistActivePurchase(order, idempotencyKey) {
    if (typeof window === 'undefined' || !window.sessionStorage || !order || !order.orderId) return;

    try {
      window.sessionStorage.setItem(
        ACTIVE_PURCHASE_KEY,
        JSON.stringify({
          orderId: order.orderId,
          productId: order.productId || order.product_id || null,
          amount: order.amount ?? null,
          currency: order.currency || null,
          status: order.status || 'payment_pending',
          customerAccessToken: order.customerAccessToken || null,
          idempotencyKey: idempotencyKey || null,
          createdAt: Date.now()
        })
      );
    } catch {
      // Private-browsing / storage-disabled: recovery is a convenience, never a requirement.
    }
  },

  /**
   * Read back a live in-flight purchase (or null when absent, malformed or older than 30min).
   */
  restoreActivePurchase() {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;

    try {
      const raw = window.sessionStorage.getItem(ACTIVE_PURCHASE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.orderId !== 'string') {
        window.sessionStorage.removeItem(ACTIVE_PURCHASE_KEY);
        return null;
      }

      const age = Date.now() - Number(parsed.createdAt || 0);
      if (!Number.isFinite(age) || age > ACTIVE_PURCHASE_TTL_MS) {
        // Stale: drop it so a fresh checkout gets its own order and its own key.
        window.sessionStorage.removeItem(ACTIVE_PURCHASE_KEY);
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  },

  /** Forget the in-flight purchase once it is settled, cancelled or abandoned. */
  clearActivePurchase() {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      window.sessionStorage.removeItem(ACTIVE_PURCHASE_KEY);
    } catch {
      // Nothing to clear.
    }
  },

  /**
   * Request Temporary Signed Download Authorization for Authorized Paid Order
   * Connects to POST /api/v1/orders/:orderId/download
   * @param {string} orderId 
   * @param {string} [customerAccessToken] 
   * @returns {Promise<{ orderId: string, downloadUrl: string, expiresAt: string, filename: string }>}
   */
  async getSecureDownloadUrl(orderId, customerAccessToken) {
    const targetOrderId = orderId || (this.currentOrder && this.currentOrder.orderId);
    const token = customerAccessToken || (this.currentOrder && this.currentOrder.customerAccessToken);

    if (!targetOrderId) {
      throw new Error('No order ID provided for download authorization.');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${GATEWAY_CONFIG.apiBaseUrl}/api/v1/orders/${targetOrderId}/download`, {
      method: 'POST',
      headers
    });

    if (!response.ok) {
      let message = `Download authorization denied (${response.status})`;
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
      } catch {
        // non-json
      }
      throw new Error(message);
    }

    return await response.json();
  },

  /**
   * Trigger master archive download for verified paid order
   * Follows the temporary download stream URL
   * @param {string} orderId 
   * @param {string} [customerAccessToken] 
   */
  async downloadMasterArchive(orderId, customerAccessToken) {
    try {
      this.displayArchivalToast('AUTHORIZING DIGITAL ARCHIVE DOWNLOAD...');
      const auth = await this.getSecureDownloadUrl(orderId, customerAccessToken);
      
      const fullUrl = auth.downloadUrl.startsWith('http')
        ? auth.downloadUrl
        : `${GATEWAY_CONFIG.apiBaseUrl}${auth.downloadUrl}`;

      // Initiate secure stream download via temporary link
      const link = document.createElement('a');
      link.href = fullUrl;
      link.download = auth.filename || 'vol-01-master.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      this.displayArchivalToast(`DOWNLOADING MASTER ARCHIVE (${auth.filename})`);
      return auth;
    } catch (err) {
      this.displayArchivalToast(`DOWNLOAD ERROR: ${err.message}`);
      throw err;
    }
  },

  /**
   * Update all storefront CTA buttons to match current commerce lifecycle state
   * @param {PurchaseState} state 
   * @param {object} [order] 
   */
  updateStorefrontCta(state, order = null) {
    if (typeof document === 'undefined') return;

    const ctaButtons = Array.from(document.querySelectorAll('button[onclick*="purchaseProduct"], button[data-verro-cta]'));

    ctaButtons.forEach(btn => {
      // Stash initial default text if not already saved
      if (!btn.dataset.defaultHtml) {
        btn.dataset.defaultHtml = btn.innerHTML;
      }

      switch (state) {
        case 'idle':
          btn.disabled = false;
          btn.innerHTML = btn.dataset.defaultHtml;
          break;

        case 'creating_order':
          btn.disabled = true;
          btn.innerHTML = `
            <span class="inline-block w-3.5 h-3.5 border-2 border-ivory border-t-transparent animate-spin mr-2"></span>
            <span>CREATING ORDER...</span>
          `;
          break;

        case 'payment_pending':
          btn.disabled = false;
          btn.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-gold inline-block mr-2 animate-pulse"></span>
            <span>PAYMENT PENDING</span>
          `;
          btn.setAttribute('title', order ? `Order: ${order.orderId} (Click to refresh status)` : 'Payment pending');
          break;

        case 'failed':
          btn.disabled = false;
          btn.innerHTML = `<span>PAYMENT SERVICE UNAVAILABLE · TRY AGAIN</span>`;
          break;

        case 'cancelled':
          btn.disabled = false;
          btn.innerHTML = `<span>ORDER CANCELLED · TRY AGAIN</span>`;
          break;

        case 'paid':
          btn.disabled = false;
          btn.innerHTML = `
            <span class="material-symbols-outlined text-[18px] mr-1.5">download</span>
            <span>DOWNLOAD MASTER ARCHIVE</span>
          `;
          break;
      }
    });
  },

  /**
   * Accessible Toast / Plaque Notification
   * Adheres strictly to VÉRRO design tokens (charcoal, ivory, gold, zero-radius)
   * @param {string} message 
   */
  displayArchivalToast(message) {
    if (typeof document === 'undefined') return;

    let toastEl = document.getElementById('verro-commerce-toast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'verro-commerce-toast';
      toastEl.className = 'fixed bottom-6 right-6 z-50 bg-charcoal text-ivory border border-gold/50 px-5 py-3.5 font-mono-archival text-xs tracking-[0.14em] uppercase flex items-center gap-3 transition-opacity duration-300 shadow-none';
      document.body.appendChild(toastEl);
    }

    toastEl.innerHTML = `
      <span class="w-2 h-2 bg-gold flex-shrink-0"></span>
      <span class="leading-tight">${escapeHtml(message)}</span>
    `;
    toastEl.style.opacity = '1';
    toastEl.style.display = 'flex';

    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 4500);
  },

  /**
   * Internal Event Dispatcher for Custom Observers
   * @param {PurchaseState} state 
   * @param {object} payload 
   */
  notifyStateChange(state, payload = {}) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('verro:payment-state-change', {
        detail: { state, ...payload, timestamp: Date.now() }
      }));
    }
  },

  /**
   * Launch VÉRRO Sovereign UPI Payment Modal
   * @param {object} [order]
   */
  openPaymentModal(order) {
    const targetOrder = order || this.currentOrder;
    if (!targetOrder || typeof window === 'undefined') return;
    openPaymentModal(targetOrder, this);
  },

  /**
   * Launch YouPI-PG Sovereign UPI Checkout Modal
   * @param {string} [checkoutUrl]
   */
  openYoupiCheckout(checkoutUrl) {
    const targetUrl = checkoutUrl || this.currentOrder?.checkoutUrl;
    if (typeof window === 'undefined' || !targetUrl) return;

    if (window.Youpi && typeof window.Youpi.pay === 'function') {
      try {
        window.Youpi.pay({
          checkoutUrl: targetUrl,
          orderId: this.currentOrder?.orderId,
          amount: (this.currentOrder?.amount ? this.currentOrder.amount / 100 : 399).toFixed(2),
          name: 'VÉRRO Atelier',
          description: 'Vol. 01 — Digital Art Edition',
          onSuccess: (res) => {
            console.info('[VÉRRO Commerce] YouPI payment success reported. Verifying with server...');
            this.verifyAndSettleOrder(this.currentOrder?.orderId, res.utr);
          },
          onFailed: (res) => {
            console.warn('[VÉRRO Commerce] YouPI checkout failed or cancelled:', res.reason);
          }
        });
        return;
      } catch (err) {
        console.warn('[VÉRRO Commerce] Youpi.pay invocation warning:', err);
      }
    }

    this._injectDirectCheckoutModal(targetUrl);
  },

  /**
   * Inject Sovereign YouPI Checkout Modal into Storefront
   * @private
   */
  _injectDirectCheckoutModal(checkoutUrl) {
    if (typeof document === 'undefined') return;

    const existing = document.getElementById('verro-youpi-modal-container');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'verro-youpi-modal-container';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(23,23,23,0.85);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#171717;border:1px solid rgba(176,138,74,0.4);width:100%;max-width:480px;height:90vh;max-height:680px;display:flex;flex-direction:column;position:relative;box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);';

    const header = document.createElement('div');
    header.style.cssText = 'padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;background:#141414;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:8px;height:8px;background:#B08A4A;"></span>
        <span style="font-family:monospace;font-size:11px;letter-spacing:0.18em;color:#F2EBDD;text-transform:uppercase;">YOUPI-PG · SOVEREIGN UPI RAIL</span>
      </div>
      <button type="button" id="verro-youpi-close-btn" style="background:transparent;border:none;color:#F2EBDD;font-size:16px;cursor:pointer;padding:4px 8px;line-height:1;" title="Close">✕</button>
    `;

    const iframe = document.createElement('iframe');
    iframe.src = checkoutUrl;
    iframe.style.cssText = 'flex:1;width:100%;border:none;background:#ffffff;';
    iframe.allow = 'clipboard-write; payment';

    card.appendChild(header);
    card.appendChild(iframe);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const closeModal = () => {
      window.removeEventListener('message', messageHandler);
      backdrop.remove();
    };

    document.getElementById('verro-youpi-close-btn')?.addEventListener('click', closeModal);

    const messageHandler = (e) => {
      // Only the configured checkout origins may drive this flow, and only the exact frame
      // we embedded is allowed to speak for it (F-2x).
      const allowedOrigins = resolveCheckoutOrigins();
      if (allowedOrigins.size > 0 && !allowedOrigins.has(e.origin)) {
        console.warn(`[VÉRRO Commerce] Ignored checkout message from untrusted origin: ${e.origin}`);
        return;
      }
      if (iframe.contentWindow && e.source && e.source !== iframe.contentWindow) {
        console.warn('[VÉRRO Commerce] Ignored checkout message from an unexpected window.');
        return;
      }

      if (!e.data || typeof e.data !== 'object') return;
      const eventName = e.data.event;
      if (eventName === 'youpi.payment_success' || eventName === 'youpi:payment:success') {
        const payload = e.data.data || e.data;
        setTimeout(() => closeModal(), 1000);
        this.verifyAndSettleOrder(this.currentOrder?.orderId, payload.utr || payload.bankRef);
      } else if (eventName === 'youpi.request_cancel' || eventName === 'youpi:payment:cancelled') {
        closeModal();
      }
    };

    window.addEventListener('message', messageHandler);
  },

  /**
   * Authoritative Settlement Reconciliation Check
   * @param {string} [orderId]
   * @param {string} [paymentReference]
   */
  async verifyAndSettleOrder(orderId, paymentReference) {
    const targetOrderId = orderId || this.currentOrder?.orderId;
    if (!targetOrderId) return;

    // F-03: reconciliation is purchaser-scoped. The previous call sent no credential at all,
    // which (pre-fix) settled any order whose id it knew and now correctly returns 403.
    const purchaserToken = this.getPurchaserToken(targetOrderId);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (purchaserToken) {
        headers['Authorization'] = `Bearer ${purchaserToken}`;
      }

      const response = await fetch(`${GATEWAY_CONFIG.apiBaseUrl}/api/v1/orders/${targetOrderId}/verify`, {
        method: 'POST',
        headers,
        // The reference is a CLAIM the server records as unverified evidence; it never
        // settles the order on its own (F-05).
        body: JSON.stringify({ paymentReference })
      });

      if (response.ok) {
        const data = await response.json();

        if (data.status === 'paid' && data.settled !== false) {
          this.currentState = 'paid';
          if (this.currentOrder) {
            this.currentOrder.status = 'paid';
            this.currentOrder.paidAt = data.paidAt;
          }
          // The purchase is complete: the resumed-state slot must not linger.
          this.clearActivePurchase();
          this.notifyStateChange(this.currentState, this.currentOrder);
          this.updateStorefrontCta(this.currentState, this.currentOrder);
          this.displayArchivalToast('PAYMENT SETTLED · MASTER ARCHIVE UNLOCKED');
          return data;
        }

        if (data && data.settled === false) {
          // Authoritative server answer: not settled. Say so instead of implying success.
          this.displayArchivalToast('PAYMENT NOT YET CONFIRMED · ORDER REMAINS PENDING');
        }
      }
      return this.getOrderStatus(targetOrderId, purchaserToken);
    } catch (err) {
      console.warn('[VÉRRO Commerce] Settlement verification notice:', err.message);
      return this.getOrderStatus(targetOrderId, purchaserToken);
    }
  }
};

/**
 * Global purchase helper maintaining backward compatibility with markup onclick handlers
 * @param {string} productId 
 */
export function purchaseProduct(productId = 'vol-01') {
  return purchaseService.checkout(productId);
}

// Bind to window for global inline accessibility
if (typeof window !== 'undefined') {
  window.purchaseProduct = purchaseProduct;
  window.purchaseService = purchaseService;
}
