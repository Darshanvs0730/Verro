/**
 * VÉRRO Component — ProductShowcase
 * Section 04 main dedicated sales showcase and collection tracklist
 */

export function renderProductShowcase(vol01) {
  const proofSheet = vol01.assets.proofSheet;

  const tracklistItems = vol01.artworks.map(art => {
    const accentClass = art.accent === 'navy' 
      ? 'text-navy' 
      : art.accent === 'oxblood' 
        ? 'text-oxblood' 
        : 'text-charcoal/60';

    return `
<div class="py-4 flex items-center justify-between group">
  <div class="flex items-center gap-4">
    <span class="font-mono-archival text-xs text-charcoal/60">${art.number}</span>
    <span class="font-bodoni font-normal text-base tracking-wide text-charcoal group-hover:text-gold transition-colors">${art.title}</span>
  </div>
  <span class="font-mono-archival text-[10px] ${accentClass} uppercase tracking-wider">${art.formats}</span>
</div>
    `.trim();
  }).join('\n');

  const featureChips = vol01.features.map(feat => `
<span class="px-3 py-1.5 border border-charcoal/20 text-charcoal font-space font-medium text-[11px] tracking-[0.14em] uppercase bg-ivory">
  ${feat}
</span>
  `.trim()).join('\n');

  return `
<section class="w-full bg-parchment border-t border-charcoal/15 py-24 px-margin-mobile lg:px-margin" id="product-showcase">
  <div class="max-w-7xl mx-auto">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
      <!-- Left: Tactile Proof Sheet Visual -->
      <div class="lg:col-span-6 relative">
        <div class="relative bg-ivory p-4 sm:p-6 border border-charcoal/20 cursor-pointer" onclick="openLightbox(1)">
          <picture>
            <source srcset="${proofSheet.webp}" type="image/webp"/>
            <img alt="${proofSheet.alt}" class="w-full object-cover" decoding="async" height="${proofSheet.height}" loading="lazy" onerror="handleImageError(this, 'PROOF_SHEET_SHOWCASE')" src="${proofSheet.src}" width="${proofSheet.width}"/>
          </picture>
          <div class="mt-4 pt-4 border-t border-charcoal/15 flex justify-between items-center text-charcoal/70 font-mono-archival text-[11px] tracking-[0.14em]">
            <span>${proofSheet.caption}</span>
            <span>${proofSheet.volLabel}</span>
          </div>
        </div>
      </div>
      <!-- Right: Details & Purchase Hook -->
      <div class="lg:col-span-6 flex flex-col justify-center">
        <div class="mb-2">
          <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.2em] uppercase">OFFICIAL PACK</span>
        </div>
        <h2 class="font-bodoni font-normal text-[2rem] lg:text-[2.65rem] leading-[1.12] mb-2 text-charcoal">
          VÉRRO / ${vol01.collectionName}
        </h2>
        <p class="font-space font-light italic text-lg text-charcoal/80 mb-8">
          ${vol01.tagline}
        </p>
        <!-- Tracklist -->
        <div class="border-t border-charcoal/20 mb-8 divide-y divide-charcoal/10">
          ${tracklistItems}
        </div>
        <!-- Feature Chips -->
        <div class="flex flex-wrap gap-2 mb-8">
          ${featureChips}
        </div>
        <!-- Price & CTA Box -->
        <div class="p-6 bg-ivory border border-charcoal/20">
          <div class="flex items-baseline justify-between mb-4">
            <div>
              <span class="font-mono-archival text-[10px] uppercase tracking-[0.16em] text-charcoal/65 block">PRICE FOR THE TRILOGY</span>
              <span class="font-bodoni font-normal text-3xl sm:text-4xl text-charcoal">${vol01.formattedPrice}</span>
              <span class="font-space text-xs text-charcoal/65 ml-2">${vol01.pricingNote}</span>
            </div>
            <div class="text-right">
              <span class="inline-block px-2.5 py-1 bg-charcoal/5 border border-charcoal/15 text-charcoal font-mono-archival text-[10px] uppercase tracking-[0.14em]">
                INSTANT ACCESS
              </span>
            </div>
          </div>
          <button class="w-full py-4 bg-charcoal text-ivory hover:bg-gold hover:text-charcoal transition-colors duration-200 font-space font-medium text-label-uppercase tracking-[0.2em] flex items-center justify-center gap-3" onclick="purchaseProduct('${vol01.id}')" type="button">
            <span>GET VOL. 01 →</span>
            <span class="font-bodoni text-xs font-normal opacity-85">(${vol01.formattedPrice})</span>
          </button>
          <div class="mt-4 flex items-center justify-between text-charcoal/70 font-mono-archival text-[10px] tracking-[0.14em] uppercase">
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">lock</span> INSTANT DOWNLOAD LINK
            </span>
            <span>${vol01.license}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
  `.trim();
}
