/**
 * VÉRRO Digital Art Gallery — Sovereign UPI Payment Modal
 * Editorial Art Gallery Edition · Botanical Green + Warm Paper + Terracotta Warning
 * Payee: supplied by the authoritative backend order (`payeeVpa` + `payeeName`, F-48) — never
 * hardcoded here. A client-side payment destination is a literal that pays whoever shipped it.
 */

import { generateQrSvg } from '../lib/qrCode.js';
import { vol01 } from '../data/vol01.js';

let activePollTimer = null;

/**
 * F-42: order fields originate from the commerce API and are interpolated into modal markup,
 * so they are escaped rather than trusted as markup.
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
 * Extract and normalize authoritative order amount in standard Rupee string format.
 * Returns null if missing or invalid to avoid inventing financial figures.
 */
function formatOrderAmount(order) {
  if (typeof order?.formattedAmount === 'string' && order.formattedAmount.trim() !== '') {
    const cleaned = order.formattedAmount.replace(/[^0-9.]/g, '').trim();
    if (cleaned && !Number.isNaN(parseFloat(cleaned))) {
      return parseFloat(cleaned).toFixed(2);
    }
  }
  if (typeof order?.amount === 'number' && Number.isFinite(order.amount) && order.amount > 0) {
    return (order.amount / 100).toFixed(2);
  }
  return null;
}

/**
 * Open the sovereign UPI payment modal for the given order
 * @param {object} order - Authoritative backend order object
 * @param {object} service - purchaseService instance
 */
export function openPaymentModal(order, service) {
  if (typeof document === 'undefined' || !order) return;

  // Clear any previous modal or polling timer
  closePaymentModal();

  const upiId = typeof order.payeeVpa === 'string' ? order.payeeVpa.trim() : '';
  const payeeName = typeof order.payeeName === 'string' ? order.payeeName.trim() : '';
  const amount = formatOrderAmount(order);
  const orderId = order.orderId;

  // Resolve dynamic product metadata from catalog
  const isVol01 = order.productId === vol01.id || order.product_id === vol01.id || !order.productId;
  const productTitle = order.productTitle || (isVol01 ? 'Vol. 01 — No Defaults' : (order.productName || 'VÉRRO Monograph'));
  const productDesc = order.productDescription || (isVol01 ? 'Premium digital wallpaper collection' : 'Curated digital deliverable');

  const backdrop = document.createElement('div');
  backdrop.id = 'verro-payment-modal-backdrop';
  backdrop.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pm-backdrop transition-opacity duration-300';

  // Guard against missing/invalid amount: do not show a payment CTA that could charge an incorrect amount
  if (!amount) {
    backdrop.innerHTML = `
      <div id="verro-payment-modal-card" class="relative w-full pm-card p-6 sm:p-8 flex flex-col gap-5 text-center">
        <div class="flex items-center justify-between border-b pm-border pb-3">
          <span class="font-bodoni text-xl font-medium tracking-wide pm-text">VÉRRO</span>
          <button id="verro-modal-close-btn" type="button" aria-label="Close modal" class="pm-close-btn p-1.5 transition-colors">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="py-6">
          <h2 class="font-bodoni text-2xl pm-text mb-2">Order Price Unavailable</h2>
          <p class="text-xs font-space pm-text-muted max-w-sm mx-auto">
            The authoritative settlement amount for order <span class="font-mono text-[#252C28]">${escapeHtml(order.orderId)}</span> could not be confirmed.
          </p>
        </div>
        <button id="verro-modal-done-btn" type="button" class="w-full py-3 pm-cta-btn font-space font-medium text-xs tracking-wider uppercase">
          Close Window
        </button>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.getElementById('verro-modal-close-btn')?.addEventListener('click', closePaymentModal);
    document.getElementById('verro-modal-done-btn')?.addEventListener('click', closePaymentModal);
    return;
  }

  // F-48: the payee identity must come from the authoritative backend order. This file used to
  // carry BOTH halves of it — a `|| 'dvs2004@slc'` VPA fallback and a hardcoded payee name — so a
  // response missing the fields still produced a scannable payment intent pointing at the
  // developer's personal UPI ID. A customer would pay, no order would ever settle, and nothing
  // would report an error. Refuse to build an intent we cannot prove is correct.
  if (!upiId || !payeeName) {
    console.error(
      '[VÉRRO] Refusing to render a UPI intent: the backend order supplied no authoritative payeeVpa/payeeName.'
    );
    backdrop.innerHTML = `
      <div id="verro-payment-modal-card" class="relative w-full pm-card p-6 sm:p-8 flex flex-col gap-5 text-center">
        <div class="py-6">
          <h2 class="font-bodoni text-2xl pm-text mb-2">Payment Destination Unavailable</h2>
          <p class="text-xs font-space pm-text-muted max-w-sm mx-auto">
            The authoritative payee for order <span class="font-mono text-[#252C28]">${escapeHtml(order.orderId)}</span> could not be confirmed, so no payment request was created.
          </p>
        </div>
        <button id="verro-modal-done-btn" type="button" class="w-full py-3 pm-cta-btn font-space font-medium text-xs tracking-wider uppercase">
          Close Window
        </button>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.getElementById('verro-modal-done-btn')?.addEventListener('click', closePaymentModal);
    return;
  }

  // NPCI standard compliant P2P URI format (clean am=${amount} without mode=02 so UPI apps pre-fill exact amount)
  const cleanRef = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR&tn=VERRO${cleanRef}`;

  // Generate authentic ISO-standard QR code with pitch-black modules and clean quiet zone
  const qrSvg = generateQrSvg(upiUri, { width: 140, margin: 1, errorCorrectionLevel: 'M' });

  backdrop.innerHTML = `
    <div id="verro-payment-modal-card" class="relative w-full pm-card p-4 sm:p-5 md:p-6 flex flex-col gap-3 shadow-2xl max-h-[96vh] md:max-h-none overflow-y-auto md:overflow-hidden my-auto">
      
      <!-- Modal Header Bar -->
      <div class="relative flex items-center justify-between border-b pm-border pb-2.5">
        <div class="flex items-center gap-2.5">
          <span class="font-bodoni text-xl sm:text-2xl font-bold tracking-wide pm-text">VÉRRO</span>
          <span class="font-mono text-xs font-bold tracking-wider uppercase pm-text bg-[#E5EBE3] px-2 py-0.5 rounded-sm">
            UPI PAYMENT
          </span>
        </div>

        <div class="flex items-center gap-3">
          <div class="hidden sm:flex items-center gap-1.5 text-xs font-mono font-bold pm-text">
            <span>Order ID: <span class="font-mono font-extrabold text-[#111815] select-all">${escapeHtml(order.orderId)}</span></span>
            <button id="verro-copy-order-btn" type="button" aria-label="Copy Order ID" class="p-1 pm-copy-btn rounded-sm flex items-center justify-center">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="1" ry="1"></rect>
                <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"></path>
              </svg>
            </button>
          </div>
          <button id="verro-modal-close-btn" type="button" aria-label="Close modal" class="pm-close-btn p-1 transition-colors">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile Order ID Line -->
      <div class="sm:hidden flex items-center justify-between text-xs font-mono font-bold pm-text pb-1 border-b pm-border">
        <span>Order: <span class="font-extrabold select-all">${escapeHtml(order.orderId)}</span></span>
      </div>

      <!-- 2-Column Desktop Grid (Side-by-Side Widescreen) -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-3.5 sm:gap-4 items-stretch">

        <!-- LEFT COLUMN: Order Details, Amount & CTA Button (6 cols) -->
        <div class="md:col-span-6 flex flex-col justify-between gap-2.5">
          
          <!-- Product Title & Info -->
          <div>
            <div class="font-mono text-xs font-bold tracking-[0.16em] uppercase pm-text mb-0.5">COMPLETE YOUR PURCHASE</div>
            <h2 class="pm-serif-title text-xl sm:text-2xl pm-text font-bold leading-tight">${escapeHtml(productTitle)}</h2>
            <p class="text-xs font-space font-semibold pm-text mt-0.5">${escapeHtml(productDesc)}</p>
          </div>

          <!-- Prominent Amount & Exact-Payment Warning -->
          <div class="pm-amount-box p-3.5 sm:p-4 flex flex-col gap-2 rounded-sm">
            <div class="flex items-baseline justify-between">
              <span class="text-xs font-mono tracking-[0.18em] pm-text-green uppercase font-bold">AMOUNT TO PAY</span>
              <span class="text-[10px] font-mono font-bold text-[#143D32] uppercase">Direct Settlement</span>
            </div>
            <div class="pm-bold-amount text-3xl sm:text-4xl pm-text-green font-extrabold tracking-tight">₹${amount}</div>
            
            <!-- Terracotta Warning Banner -->
            <div class="pm-warning-box p-2.5 sm:p-3 text-center flex flex-col gap-0.5 rounded-sm shadow-sm">
              <div class="font-space font-extrabold text-xs tracking-wide uppercase text-white">
                IMPORTANT: PAY EXACTLY ₹${amount}
              </div>
              <div class="text-[11px] font-space font-bold text-white/95 leading-normal">
                Do not pay more or less. Your order confirms only for exact amount.
              </div>
            </div>
          </div>

          <!-- Recipient Card -->
          <div class="pm-card-white p-3 sm:p-3.5 flex items-center justify-between gap-2.5 rounded-sm">
            <div>
              <div class="text-[10px] font-mono tracking-wider pm-text font-bold uppercase">PAY TO UPI ID</div>
              <div class="font-mono text-sm sm:text-base font-bold pm-text mt-0.5">${escapeHtml(upiId)}</div>
              <div class="text-[10px] font-mono font-bold pm-text">Payee: VÉRRO Atelier (Ref: VERRO${cleanRef})</div>
            </div>
            <button id="verro-copy-upi-btn" type="button" class="px-3 py-1.5 pm-copy-btn font-space text-xs font-bold flex items-center gap-1.5 whitespace-nowrap">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="1" ry="1"></rect>
                <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"></path>
              </svg>
              <span id="verro-copy-upi-text">Copy ID</span>
            </button>
          </div>

          <!-- Primary Payment Action -->
          <a id="verro-upi-intent-link" href="${upiUri}" class="w-full py-3 pm-cta-btn font-space font-bold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2 text-center shadow-md rounded-sm">
            <span>Open UPI app</span>
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>

        </div>

        <!-- RIGHT COLUMN: QR Scanner, Steps & UTR Verification (6 cols) -->
        <div class="md:col-span-6 flex flex-col justify-between gap-2.5">
          
          <!-- Top Card: QR Scanner & How to Pay Steps -->
          <div class="pm-card-white p-3 sm:p-3.5 flex flex-col gap-2 rounded-sm">
            
            <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
              
              <!-- QR Scanner (5 cols) -->
              <div class="sm:col-span-5 flex flex-col items-center text-center">
                <div class="text-[10px] font-mono tracking-wider pm-text uppercase font-bold">SCAN QR TO PAY</div>
                <div id="verro-qr-container" class="pm-qr-container p-1.5 my-1.5 flex items-center justify-center">
                  ${qrSvg}
                </div>
                <div class="text-[10px] font-space font-bold pm-text leading-tight">
                  Scan with any UPI app
                </div>
              </div>

              <!-- How to Pay Steps (7 cols) -->
              <div class="sm:col-span-7 flex flex-col justify-between gap-1.5 border-t sm:border-t-0 sm:border-l pm-border pt-2 sm:pt-0 sm:pl-3">
                <div class="text-[10px] font-mono tracking-wider pm-text uppercase font-bold mb-0.5">HOW TO PAY</div>
                
                <div class="flex flex-col gap-1.5 text-xs font-space">
                  <div class="flex items-start gap-2">
                    <span class="w-5 h-5 rounded-full pm-step-num flex items-center justify-center text-[10px] font-extrabold flex-shrink-0 mt-0.5">1</span>
                    <div>
                      <div class="font-bold text-xs pm-text leading-snug">Open UPI app</div>
                      <div class="text-[10px] font-bold pm-text opacity-90">Google Pay, PhonePe, Paytm, CRED</div>
                    </div>
                  </div>

                  <div class="flex items-start gap-2">
                    <span class="w-5 h-5 rounded-full pm-step-num flex items-center justify-center text-[10px] font-extrabold flex-shrink-0 mt-0.5">2</span>
                    <div>
                      <div class="font-bold text-xs pm-text leading-snug">Scan QR code</div>
                      <div class="text-[10px] font-bold pm-text opacity-90">or copy the recipient UPI ID</div>
                    </div>
                  </div>

                  <div class="flex items-start gap-2">
                    <span class="w-5 h-5 rounded-full pm-step-num flex items-center justify-center text-[10px] font-extrabold flex-shrink-0 mt-0.5">3</span>
                    <div>
                      <div class="font-bold text-xs pm-text leading-snug">Pay exact ₹${amount}</div>
                      <div class="text-[10px] font-bold pm-text opacity-90">matches amount shown</div>
                    </div>
                  </div>

                  <div class="flex items-start gap-2">
                    <span class="w-5 h-5 rounded-full pm-step-num flex items-center justify-center text-[10px] font-extrabold flex-shrink-0 mt-0.5">4</span>
                    <div>
                      <div class="font-bold text-xs pm-text leading-snug">Instant confirmation</div>
                      <div class="text-[10px] font-bold pm-text opacity-90">settlement confirms automatically</div>
                    </div>
                  </div>
                </div>

                <!-- Supported Apps Chips -->
                <div class="pt-1.5 border-t pm-border mt-0.5 flex items-center gap-1 text-[10px] font-space flex-wrap">
                  <span class="text-[9px] font-mono tracking-wider pm-text font-bold uppercase mr-1">APPS:</span>
                  <span class="pm-app-chip px-1.5 py-0.5 font-bold">GPay</span>
                  <span class="pm-app-chip px-1.5 py-0.5 font-bold">PhonePe</span>
                  <span class="pm-app-chip px-1.5 py-0.5 font-bold">Paytm</span>
                  <span class="pm-app-chip px-1.5 py-0.5 font-bold">CRED</span>
                </div>
              </div>

            </div>

          </div>

          <!-- Bottom Card: Status Polling & 12-Digit UTR Verification Form -->
          <div class="pm-card-white p-3 sm:p-3.5 flex flex-col gap-2 rounded-sm">
            <div class="flex items-center justify-between text-xs">
              <span class="font-mono text-xs tracking-wider pm-text uppercase flex items-center gap-2 font-bold">
                <span id="verro-poll-dot" class="inline-block w-2 h-2 rounded-full pm-poll-dot animate-ping"></span>
                <span id="verro-poll-text">Listening for bank settlement...</span>
              </span>
              <button id="verro-refresh-status-btn" type="button" class="text-xs font-mono pm-refresh-btn font-bold uppercase">
                Check Status
              </button>
            </div>

            <div class="flex items-center gap-2">
              <div class="h-[1px] flex-1 pm-border border-t"></div>
              <span class="text-[10px] font-mono font-bold text-[#3B4740] uppercase">OR VERIFY UTR</span>
              <div class="h-[1px] flex-1 pm-border border-t"></div>
            </div>

            <!-- 12-Digit UTR Form -->
            <div class="flex flex-col gap-1.5">
              <div class="flex flex-col sm:flex-row gap-1.5">
                <input 
                  id="verro-utr-input" 
                  type="text" 
                  maxlength="16" 
                  placeholder="Enter 12-digit UTR from receipt" 
                  class="flex-1 pm-utr-input px-3 py-1.5 text-xs font-mono font-bold" 
                />
                <button 
                  id="verro-verify-utr-btn" 
                  type="button" 
                  class="px-4 py-1.5 pm-verify-btn font-space font-bold text-xs uppercase tracking-wider whitespace-nowrap"
                >
                  Verify UTR
                </button>
              </div>
              <div id="verro-verify-error" class="hidden text-xs font-mono font-bold text-[#B85F45]"></div>
            </div>
          </div>

        </div>

      </div>

    </div>
  `;

  document.body.appendChild(backdrop);

  // Setup Event Handlers
  const closeBtn = document.getElementById('verro-modal-close-btn');
  closeBtn?.addEventListener('click', closePaymentModal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closePaymentModal();
    }
  });

  // Copy Order ID Button
  const copyOrderBtn = document.getElementById('verro-copy-order-btn');
  copyOrderBtn?.addEventListener('click', () => {
    navigator.clipboard?.writeText(orderId).then(() => {
      copyOrderBtn.classList.add('bg-[#21483D]', 'text-white');
      setTimeout(() => { copyOrderBtn.classList.remove('bg-[#21483D]', 'text-white'); }, 2000);
    });
  });

  // Copy UPI button
  const copyBtn = document.getElementById('verro-copy-upi-btn');
  const copyText = document.getElementById('verro-copy-upi-text');
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard?.writeText(upiId).then(() => {
      if (copyText) copyText.textContent = 'COPIED!';
      setTimeout(() => { if (copyText) copyText.textContent = 'Copy UPI ID'; }, 2000);
    }).catch(() => {
      if (copyText) copyText.textContent = 'COPIED';
    });
  });

  // Manual Check Status Button
  const refreshBtn = document.getElementById('verro-refresh-status-btn');
  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.textContent = 'CHECKING...';
    try {
      const res = await service.getOrderStatus(orderId, order.customerAccessToken);
      if (res && res.status === 'paid') {
        renderPaymentSuccess(res, service);
      } else {
        refreshBtn.textContent = 'STILL PENDING';
        setTimeout(() => { refreshBtn.textContent = 'Check Status'; }, 2500);
      }
    } catch {
      refreshBtn.textContent = 'CHECK ERROR';
      setTimeout(() => { refreshBtn.textContent = 'Check Status'; }, 2500);
    }
  });

  // Verify UTR Button
  const verifyBtn = document.getElementById('verro-verify-utr-btn');
  const utrInput = document.getElementById('verro-utr-input');
  const errEl = document.getElementById('verro-verify-error');

  verifyBtn?.addEventListener('click', async () => {
    const utr = utrInput?.value?.trim();
    if (!utr || utr.length < 8) {
      if (errEl) {
        errEl.textContent = 'Please enter a valid 12-digit bank UTR reference number.';
        errEl.classList.remove('hidden');
      }
      return;
    }
    if (errEl) errEl.classList.add('hidden');
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'VERIFYING...';

    try {
      const res = await service.verifyAndSettleOrder(orderId, utr);
      if (res && res.status === 'paid') {
        renderPaymentSuccess(res, service);
      } else {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify UTR';
        if (errEl) {
          errEl.textContent = 'Reference recorded. Once matched with bank settlement, archive unlocks automatically.';
          errEl.classList.remove('hidden');
        }
      }
    } catch (err) {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify UTR';
      if (errEl) {
        errEl.textContent = err.message || 'Verification could not be completed.';
        errEl.classList.remove('hidden');
      }
    }
  });

  // Auto-Polling: check order status every 3 seconds
  startPaymentPolling(orderId, order.customerAccessToken, service);
}

/**
 * Start background polling for order status
 */
function startPaymentPolling(orderId, token, service) {
  if (activePollTimer) clearInterval(activePollTimer);

  let pollAttempts = 0;
  const maxAttempts = 120; // 6 minutes maximum

  activePollTimer = setInterval(async () => {
    pollAttempts++;
    if (pollAttempts > maxAttempts) {
      clearInterval(activePollTimer);
      return;
    }

    try {
      const res = await service.getOrderStatus(orderId, token);
      if (res && res.status === 'paid') {
        clearInterval(activePollTimer);
        renderPaymentSuccess(res, service);
      }
    } catch {
      // transient network poll failure
    }
  }, 3000);
}

/**
 * Transition the modal to the high-contrast verified success state
 */
function renderPaymentSuccess(order, service) {
  const card = document.getElementById('verro-payment-modal-card');
  if (!card) return;

  const amount = formatOrderAmount(order);
  const amountFragment = amount ? ` · ₹${escapeHtml(amount)} PAID` : ' · PAID';

  card.innerHTML = `
    <div class="flex flex-col items-center justify-center py-6 text-center gap-5">
      <div class="w-14 h-14 rounded-full pm-success-icon-wrap flex items-center justify-center">
        <svg class="w-7 h-7 pm-success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>

      <div>
        <div class="font-mono text-xs tracking-[0.2em] pm-text-green uppercase font-bold mb-1">SETTLEMENT VERIFIED</div>
        <h2 class="pm-serif-title text-3xl pm-text font-bold">PAYMENT COMPLETE</h2>
        <p class="font-mono text-xs font-bold pm-text mt-2">
          ORDER #${escapeHtml(order.orderId)}${amountFragment}
        </p>
      </div>

      <div class="w-full pm-card-white p-5 text-left text-xs font-mono flex flex-col gap-2">
        <div class="pm-text font-bold">DIGITAL MASTER DELIVERABLE:</div>
        <div class="pm-text font-semibold">• VÉRRO Vol. 01 — Full 3-Piece Archival Set (4K/6K)</div>
        <div class="pm-text font-semibold">• Mac 16:10 Desktop & iPhone 9:19.5 Native Ratios</div>
        <div class="pm-text font-semibold">• Signed Perpetual Personal Use License Certificate</div>
      </div>

      <button id="verro-modal-download-btn" type="button" class="w-full py-4 pm-download-btn font-space font-bold text-xs sm:text-sm tracking-[0.2em] uppercase flex items-center justify-center gap-2 shadow-md">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>DOWNLOAD MASTER ARCHIVE (ZIP)</span>
      </button>

      <button id="verro-modal-done-btn" type="button" class="pm-close-btn font-mono text-xs font-bold uppercase tracking-wider">
        Close Window
      </button>
    </div>
  `;

  document.getElementById('verro-modal-download-btn')?.addEventListener('click', () => {
    service.downloadMasterArchive(order.orderId, order.customerAccessToken);
  });

  document.getElementById('verro-modal-done-btn')?.addEventListener('click', closePaymentModal);
}

/**
 * Close and tear down the modal and active timers
 */
export function closePaymentModal() {
  if (activePollTimer) {
    clearInterval(activePollTimer);
    activePollTimer = null;
  }
  const modal = document.getElementById('verro-payment-modal-backdrop');
  if (modal) {
    modal.remove();
  }
}
