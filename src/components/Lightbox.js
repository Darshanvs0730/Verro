/**
 * VÉRRO Component — Lightbox
 * Section 11 full-screen modal preview inspection
 * Derives slides directly from vol01.artworks (exposes ONLY public marketing previews)
 */

export function renderLightbox() {
  return `
<!-- LIGHTBOX MODAL (FOR MARKETING PREVIEW INSPECTION) -->
<div aria-modal="true" class="fixed inset-0 z-50 bg-charcoal/95 hidden items-center justify-center p-4 lg:p-8" id="image-lightbox" role="dialog">
  <!-- Controls -->
  <div class="absolute top-6 right-6 flex items-center gap-4 z-10">
    <button aria-label="Close Lightbox" class="text-ivory hover:text-gold p-2 flex items-center gap-2 font-space font-medium text-label-meta text-xs tracking-[0.16em] uppercase transition-colors" onclick="closeLightbox()" type="button">
      <span>CLOSE</span>
      <span class="material-symbols-outlined text-[20px]">close</span>
    </button>
  </div>
  <!-- Navigation Buttons -->
  <button aria-label="Previous Preview" class="absolute left-4 top-1/2 -translate-y-1/2 text-ivory hover:text-gold p-2 transition-colors focus:outline-none" onclick="prevLightboxSlide()" type="button">
    <span class="material-symbols-outlined text-[36px]">chevron_left</span>
  </button>
  <button aria-label="Next Preview" class="absolute right-4 top-1/2 -translate-y-1/2 text-ivory hover:text-gold p-2 transition-colors focus:outline-none" onclick="nextLightboxSlide()" type="button">
    <span class="material-symbols-outlined text-[36px]">chevron_right</span>
  </button>
  <!-- Modal Content -->
  <div class="max-w-5xl w-full flex flex-col items-center">
    <div class="relative w-full max-h-[80vh] flex items-center justify-center" id="lightbox-container">
      <img alt="VÉRRO Marketing Preview" class="max-w-full max-h-[75vh] object-contain border border-white/10" id="lightbox-img" src=""/>
    </div>
    <p class="mt-4 font-bodoni font-normal text-sm lg:text-base text-ivory tracking-wide text-center" id="lightbox-caption"></p>
    <span class="font-mono-archival text-[10px] text-gold tracking-[0.16em] uppercase mt-1">ESC TO EXIT · USE ARROW KEYS TO NAVIGATE</span>
  </div>
</div>
  `.trim();
}

/**
 * Initialize Lightbox state and keyboard/click interactions
 * @param {object} vol01 - Master collection data
 */
export function initLightbox(vol01) {
  // Derive slides directly from centralized artworks data (prevents duplication)
  const slides = vol01.artworks.map(art => ({
    src: art.preview,
    caption: art.caption,
    alt: art.alt
  }));

  let currentIndex = 0;

  function openLightbox(index) {
    currentIndex = (index + slides.length) % slides.length;
    const modal = document.getElementById('image-lightbox');
    const img = document.getElementById('lightbox-img');
    const cap = document.getElementById('lightbox-caption');

    if (modal && img && slides[currentIndex]) {
      img.src = slides[currentIndex].src;
      img.alt = slides[currentIndex].alt || 'VÉRRO Marketing Preview';
      if (cap) cap.textContent = slides[currentIndex].caption;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeLightbox() {
    const modal = document.getElementById('image-lightbox');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.body.style.overflow = '';
    }
  }

  function nextLightboxSlide() {
    openLightbox(currentIndex + 1);
  }

  function prevLightboxSlide() {
    openLightbox(currentIndex - 1);
  }

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('image-lightbox');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowRight') {
      nextLightboxSlide();
    } else if (e.key === 'ArrowLeft') {
      prevLightboxSlide();
    }
  });

  // Expose to window for inline onclick handlers
  window.openLightbox = openLightbox;
  window.closeLightbox = closeLightbox;
  window.nextLightboxSlide = nextLightboxSlide;
  window.prevLightboxSlide = prevLightboxSlide;
}
