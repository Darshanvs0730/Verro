/**
 * VÉRRO Digital Art Gallery — Sovereign UPI Payment Modal
 * Integrates directly with YouPI-PG direct-to-bank settlement rail
 * Target Payee: dvs2004@slc
 */

import { generateQrSvg } from '../lib/qrCode.js';

let activePollTimer = null;

/**
 * Open the sovereign UPI payment modal for the given order
 * @param {object} order - Authoritative backend order object
 * @param {object} service - purchaseService instance
 */
export function openPaymentModal(order, service) {
  if (typeof document === 'undefined' || !order) return;

  // Clear any previous modal or polling timer
  closePaymentModal();

  const upiId = order.payeeVpa || 'dvs2004@slc';
  const amount = order.formattedAmount || (order.amount ? (order.amount / 100).toFixed(2) : '399.00');
  const orderId = order.orderId;

  // NPCI standard compliant P2P URI format (clean am=399.00 without mode=02 so UPI apps pre-fill ₹399)
  const cleanRef = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent('Darshan V Sunkanur')}&am=${amount}&cu=INR&tn=VERRO${cleanRef}`;

  // Generate authentic ISO-standard QR code with pitch-black modules and clean quiet zone
  const qrSvg = generateQrSvg(upiUri, { width: 250, margin: 2, errorCorrectionLevel: 'M' });

  const backdrop = document.createElement('div');
  backdrop.id = 'verro-payment-modal-backdrop';
  backdrop.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md transition-opacity duration-300';
  backdrop.style.cssText = 'animation: verroFadeIn 0.2s ease-out;';

  backdrop.innerHTML = `
    <div id="verro-payment-modal-card" class="relative w-full max-w-lg bg-[#141414] border border-gold/40 text-ivory p-6 sm:p-7 flex flex-col gap-5 shadow-2xl max-h-[92vh] overflow-y-auto">
      
      <!-- Modal Header -->
      <div class="flex items-start justify-between border-b border-ivory/10 pb-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="inline-block w-2 h-2 bg-gold animate-pulse"></span>
            <span class="font-mono text-[10px] tracking-[0.2em] uppercase text-gold">DIRECT UPI BANK SETTLEMENT</span>
          </div>
          <h2 class="font-serif text-xl sm:text-2xl text-ivory tracking-wide">VÉRRO / VOL. 01 — NO DEFAULTS</h2>
          <p class="font-mono text-xs text-stone-400 mt-1">ORDER ID: <span class="text-ivory select-all font-mono">${orderId}</span></p>
        </div>
        <button id="verro-modal-close-btn" type="button" class="text-stone-400 hover:text-ivory text-xl p-1 transition-colors leading-none" aria-label="Close modal">✕</button>
      </div>

      <!-- Price & Beneficiary Plaque -->
      <div class="bg-[#1a1a1a] border border-ivory/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="text-[10px] font-mono tracking-widest text-stone-400 uppercase">Amount Due</div>
          <div class="font-serif text-2xl sm:text-3xl text-gold font-medium">₹${amount}</div>
          <div class="text-[10px] font-mono text-stone-400">Direct-to-bank · Zero platform fee</div>
        </div>
        <div class="sm:text-right border-t sm:border-t-0 sm:border-l border-ivory/10 pt-3 sm:pt-0 sm:pl-4">
          <div class="text-[10px] font-mono tracking-widest text-stone-400 uppercase">Recipient UPI ID</div>
          <div class="flex items-center sm:justify-end gap-2 mt-1">
            <span class="font-mono text-sm font-semibold text-ivory bg-black/40 px-2 py-0.5 border border-ivory/20">${upiId}</span>
            <button id="verro-copy-upi-btn" type="button" class="text-[10px] font-mono uppercase px-2.5 py-1 border border-gold/70 text-gold hover:bg-gold hover:text-charcoal transition-colors">
              Copy ID
            </button>
          </div>
          <div class="text-[10px] font-mono text-stone-400 mt-1">Payee: VÉRRO Atelier (Ref: VERRO${cleanRef})</div>
        </div>
      </div>

      <!-- Mobile Instant Tap Button -->
      <div class="flex flex-col gap-1">
        <a id="verro-upi-intent-link" href="${upiUri}" class="w-full py-3.5 bg-gold text-charcoal font-space font-semibold text-xs tracking-[0.16em] uppercase flex items-center justify-center gap-2 hover:bg-[#c29953] transition-colors text-center shadow-md">
          <span>⚡ TAP TO PAY ₹${amount} IN UPI APP (GPAY · PHONEPE · PAYTM)</span>
        </a>
        <div class="text-[9px] font-mono text-stone-400 text-center uppercase tracking-wider mt-0.5">
          (If browsing on mobile, taps directly into your payment app with ₹${amount} locked)
        </div>
      </div>

      <!-- QR Code Presentation (Fixed ₹399.00 Locked QR) -->
      <div class="flex flex-col items-center justify-center p-4 bg-[#0a0a0a] border border-ivory/10">
        <div class="flex items-center justify-between w-full mb-3 px-1">
          <span class="text-[11px] font-mono tracking-widest text-stone-300 uppercase">SCAN TO PAY EXACT ₹${amount}</span>
          <span class="text-[9px] font-mono text-gold uppercase tracking-wider bg-gold/10 px-2 py-0.5 border border-gold/40">
            AMOUNT LOCKED (₹${amount})
          </span>
        </div>

        <!-- QR Display Canvas -->
        <div id="verro-qr-container" class="bg-white p-3 border-2 border-white shadow-2xl flex items-center justify-center">
          ${qrSvg}
        </div>

        <div class="text-[11px] font-mono text-stone-300 mt-3 text-center">
          Amount is locked at ₹${amount}. Scan with <span class="text-ivory font-medium">Google Pay</span>, <span class="text-ivory font-medium">PhonePe</span>, <span class="text-ivory font-medium">Paytm</span>, or <span class="text-ivory font-medium">CRED</span>
        </div>
      </div>

      <!-- Verification Section: Polling + 12-Digit Bank UTR -->
      <div class="border-t border-ivory/10 pt-4 flex flex-col gap-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-mono text-[10px] tracking-widest text-stone-400 uppercase flex items-center gap-2">
            <span id="verro-poll-dot" class="inline-block w-2 h-2 rounded-full bg-gold animate-ping"></span>
            <span id="verro-poll-text">Listening for bank settlement...</span>
          </span>
          <button id="verro-refresh-status-btn" type="button" class="text-[10px] font-mono text-gold hover:underline uppercase">
            Check Status
          </button>
        </div>

        <!-- 12-Digit UTR Form -->
        <div class="bg-[#181818] border border-ivory/10 p-3.5 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label for="verro-utr-input" class="text-[10px] font-mono tracking-widest text-stone-300 uppercase">
              Enter 12-digit UTR from your bank receipt
            </label>
            <span class="text-[9px] font-mono text-stone-500 uppercase">Instant Unlock</span>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input 
              id="verro-utr-input" 
              type="text" 
              maxlength="16" 
              placeholder="e.g. 429301928301" 
              class="flex-1 bg-black/80 border border-ivory/25 px-3 py-2 text-xs font-mono text-ivory placeholder-stone-500 focus:outline-none focus:border-gold"
            />
            <button 
              id="verro-verify-utr-btn" 
              type="button" 
              class="px-5 py-2.5 bg-gold text-charcoal font-space font-semibold text-xs uppercase tracking-wider hover:bg-[#c29953] transition-colors"
            >
              Verify UTR
            </button>
          </div>
          <div id="verro-verify-error" class="hidden text-[11px] font-mono text-red-400 mt-1"></div>
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

  // Copy UPI button
  const copyBtn = document.getElementById('verro-copy-upi-btn');
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard?.writeText(upiId).then(() => {
      copyBtn.textContent = 'COPIED!';
      setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 2000);
    }).catch(() => {
      copyBtn.textContent = 'COPIED';
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

  card.innerHTML = `
    <div class="flex flex-col items-center justify-center py-6 text-center gap-6">
      <div class="w-16 h-16 rounded-full bg-gold/20 border-2 border-gold flex items-center justify-center">
        <span class="material-symbols-outlined text-gold text-3xl">check</span>
      </div>

      <div>
        <div class="font-mono text-xs tracking-[0.2em] text-gold uppercase mb-1">SETTLEMENT VERIFIED</div>
        <h2 class="font-serif text-2xl sm:text-3xl text-ivory">PAYMENT COMPLETE</h2>
        <p class="font-mono text-xs text-stone-400 mt-2">
          ORDER #${order.orderId} · ₹${order.formattedAmount || '399.00'} PAID
        </p>
      </div>

      <div class="w-full bg-[#181818] border border-gold/30 p-5 text-left text-xs font-mono flex flex-col gap-2">
        <div class="text-stone-300 font-medium">DIGITAL MASTER DELIVERABLE:</div>
        <div class="text-stone-400">• VÉRRO Vol. 01 — Full 3-Piece Archival Set (4K/6K)</div>
        <div class="text-stone-400">• Mac 16:10 Desktop & iPhone 9:19.5 Native Ratios</div>
        <div class="text-stone-400">• Signed Perpetual Personal Use License Certificate</div>
      </div>

      <button id="verro-modal-download-btn" type="button" class="w-full py-4 bg-gold text-charcoal font-space font-semibold text-xs tracking-[0.2em] uppercase hover:bg-[#c29953] transition-colors flex items-center justify-center gap-2 shadow-lg">
        <span class="material-symbols-outlined text-lg">download</span>
        <span>DOWNLOAD MASTER ARCHIVE (ZIP)</span>
      </button>

      <button id="verro-modal-done-btn" type="button" class="text-stone-400 hover:text-ivory font-mono text-xs uppercase tracking-wider">
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
