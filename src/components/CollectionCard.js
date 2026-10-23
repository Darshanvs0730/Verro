/**
 * VÉRRO Component — CollectionCard
 * Section 03 two-state interactive product card & specification column
 */

export function renderCollectionCard(vol01) {
  const proofSheet = vol01.assets.proofSheet;
  const inSitu = vol01.assets.inSituHover;

  return `
<section class="w-full px-margin-mobile lg:px-margin py-24 max-w-7xl mx-auto" id="archive-section">
  <div class="flex flex-col md:flex-row md:items-end justify-between mb-12 border-b border-charcoal/15 pb-6 gap-4">
    <div>
      <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.18em] block mb-1 uppercase">MONOGRAPH CATALOGUE</span>
      <h2 class="font-bodoni font-normal section-heading-md tracking-tight uppercase text-charcoal">COLLECTION 01 / ARCHIVE PROOF</h2>
    </div>
    <div class="flex items-center gap-3 text-charcoal/70 font-space text-xs tracking-[0.14em]">
      <span class="w-2 h-2 bg-gold rounded-full"></span>
      <span class="text-charcoal font-medium uppercase">TAP / HOVER TO REVEAL IN SITU</span>
    </div>
  </div>
  <!-- 2-State Interactive Card -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
    <div class="interactive-card lg:col-span-8 group relative bg-parchment overflow-hidden border border-charcoal/15 cursor-pointer select-none" id="interactive-proof-card" onclick="toggleCardTouchState()">
      <!-- Base State: Print Proof Sheet -->
      <div class="relative w-full aspect-[16/10] overflow-hidden">
        <picture>
          <source srcset="${proofSheet.webp}" type="image/webp"/>
          <img alt="${proofSheet.alt}" class="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" decoding="async" height="${proofSheet.height}" loading="lazy" onerror="handleImageError(this, 'PROOF_SHEET_BASE')" src="${proofSheet.src}" width="${proofSheet.width}"/>
        </picture>
        <div class="absolute inset-0 bg-charcoal/5 pointer-events-none mix-blend-multiply"></div>
      </div>
      <!-- In-Situ Hover & Tap State -->
      <div class="active-in-situ absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-in-out pointer-events-none overflow-hidden">
        <picture>
          <source srcset="${inSitu.webp}" type="image/webp"/>
          <img alt="${inSitu.alt}" class="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" decoding="async" height="${inSitu.height}" loading="lazy" onerror="handleImageError(this, 'IN_SITU_HOVER')" src="${inSitu.src}" width="${inSitu.width}"/>
        </picture>
        <div class="absolute inset-0 bg-black/10"></div>
        <div class="absolute top-4 right-4 bg-charcoal text-ivory px-3 py-1 font-mono-archival text-[11px] tracking-[0.14em] uppercase">
          ${inSitu.label}
        </div>
      </div>
      <!-- Badge Overlay -->
      <div class="absolute top-4 left-4 bg-parchment px-3 py-1 border border-charcoal/20 font-mono-archival text-[11px] tracking-[0.14em] uppercase text-charcoal">
        SPECIMEN PROOF
      </div>
      <div class="absolute bottom-4 left-4 bg-parchment px-3 py-1.5 border border-charcoal/20 flex items-center gap-2 text-charcoal">
        <span class="material-symbols-outlined text-[16px] text-charcoal">touch_app</span>
        <span class="font-space font-medium text-[11px] tracking-[0.14em] uppercase">TAP / HOVER TO REVEAL IN SITU</span>
      </div>
    </div>
    <!-- Card Metadata Column -->
    <div class="lg:col-span-4 bg-parchment border border-charcoal/15 p-8 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between border-b border-charcoal/15 pb-4 mb-6">
          <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.16em] uppercase">SPECIFICATION 01</span>
          <span class="font-mono-archival text-xs tracking-[0.14em] text-charcoal/60 uppercase">${vol01.availabilityText}</span>
        </div>
        <h3 class="font-bodoni font-normal text-headline-sm mb-3 text-charcoal">${vol01.collectionName}</h3>
        <p class="font-space font-light text-body-md text-charcoal/75 mb-6 leading-relaxed">
          The inaugural set. Three textured artworks designed as an intentional visual identity across your primary screens.
        </p>
        <div class="space-y-3 mb-8">
          <div class="flex justify-between items-center text-sm py-2 border-b border-charcoal/10 font-space">
            <span class="text-charcoal/65">Aspect Ratios</span>
            <span class="font-mono-archival text-xs tracking-wider font-medium text-charcoal">${vol01.aspectRatios}</span>
          </div>
          <div class="flex justify-between items-center text-sm py-2 border-b border-charcoal/10 font-space">
            <span class="text-charcoal/65">Wallpapers Included</span>
            <span class="font-medium text-charcoal">${vol01.wallpapersCountText}</span>
          </div>
          <div class="flex justify-between items-center text-sm py-2 border-b border-charcoal/10 font-space">
            <span class="text-charcoal/65">Delivery</span>
            <span class="font-medium text-charcoal">${vol01.delivery} Files</span>
          </div>
          <div class="flex justify-between items-center text-sm py-2 border-b border-charcoal/10 font-space">
            <span class="text-charcoal/65">Usage</span>
            <span class="font-medium text-charcoal">${vol01.license}</span>
          </div>
        </div>
      </div>
      <div>
        <div class="flex items-baseline justify-between mb-4">
          <span class="font-mono-archival text-xs uppercase tracking-[0.16em] text-charcoal/65">DIGITAL DOWNLOAD</span>
          <span class="font-bodoni font-normal price-fluid text-charcoal">${vol01.formattedPrice}</span>
        </div>
        <button class="w-full py-4 bg-charcoal text-ivory hover:bg-gold hover:text-charcoal transition-colors duration-200 font-space font-medium text-label-uppercase tracking-[0.16em] flex items-center justify-center gap-2" onclick="purchaseProduct('${vol01.id}')" type="button">
          <span>GET VOL. 01 NOW</span>
          <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>
    </div>
  </div>
</section>
  `.trim();
}

/**
 * Initialize touch support for interactive collection card reveal
 */
export function initInteractiveCard() {
  window.toggleCardTouchState = function() {
    const card = document.getElementById('interactive-proof-card');
    if (card) {
      card.classList.toggle('is-active');
    }
  };
}
