/**
 * VÉRRO Component — PreviewGallery
 * Section 05 individual artwork previews with interactive lightbox triggers
 * and architectural fallback plaque for pending specimen (Artwork 02)
 */

export function renderPreviewGallery(vol01) {
  const cards = vol01.artworks.map((art, idx) => {
    const accentClass = art.accent === 'navy'
      ? 'text-navy'
      : art.accent === 'oxblood'
        ? 'text-oxblood'
        : 'text-charcoal/70';

    if (art.isPendingPreview) {
      // Artwork 02: MONEY TALKS (Archival Placeholder Plaque - Dedicated Asset Pending)
      return `
<div class="flex flex-col group cursor-pointer" onclick="openLightbox(${idx})">
  <div class="relative bg-parchment aspect-[4/5] overflow-hidden border border-charcoal/15 mb-4 flex flex-col items-center justify-center p-6 text-center verro-asset-fallback select-none">
    <div class="w-12 h-px bg-charcoal/20 mb-4"></div>
    <span class="font-mono-archival text-[10px] text-navy tracking-[0.2em] uppercase mb-2">${art.plate}</span>
    <h4 class="font-bodoni font-normal text-xl uppercase tracking-wider mb-2 text-charcoal">${art.title}</h4>
    <p class="font-space font-light text-xs text-charcoal/75 max-w-[200px] mb-4 leading-relaxed">${art.pendingNotice}</p>
    <span class="font-mono-archival text-[9px] text-charcoal/80 tracking-[0.16em] uppercase border border-charcoal/25 px-2.5 py-1 bg-ivory">${art.pendingBadge}</span>
    <div class="w-12 h-px bg-charcoal/20 mt-4"></div>
    <div class="absolute inset-0 bg-charcoal/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
      <span class="bg-ivory border border-charcoal/20 px-4 py-2 font-space font-medium text-xs tracking-[0.14em] uppercase text-charcoal">INSPECT PROOF</span>
    </div>
    <span class="absolute top-3 left-3 bg-ivory border border-charcoal/15 px-2 py-0.5 font-mono-archival text-[10px] text-charcoal tracking-widest uppercase">${art.fraction}</span>
  </div>
  <div class="flex justify-between items-baseline">
    <h3 class="font-bodoni font-normal text-base sm:text-lg uppercase tracking-wider text-charcoal">${art.title}</h3>
    <span class="font-mono-archival text-[11px] ${accentClass} tracking-widest">${art.formats}</span>
  </div>
  <p class="font-space font-light text-body-sm text-charcoal/75 mt-1">${art.description}</p>
</div>
      `.trim();
    }

    // Standard Artwork Preview Card
    const errorKey = `ARTWORK_${art.number}`;
    return `
<div class="flex flex-col group cursor-pointer" onclick="openLightbox(${idx})">
  <div class="relative bg-parchment aspect-[4/5] overflow-hidden border border-charcoal/15 mb-4">
    <picture>
      <source srcset="${art.webp}" type="image/webp"/>
      <img alt="${art.alt}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" decoding="async" height="${art.height || 286}" loading="lazy" onerror="handleImageError(this, '${errorKey}')" src="${art.preview}" width="${art.width || 512}"/>
    </picture>
    <div class="absolute inset-0 bg-charcoal/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
      <span class="bg-ivory border border-charcoal/20 px-4 py-2 font-space font-medium text-xs tracking-[0.14em] uppercase text-charcoal">INSPECT PREVIEW</span>
    </div>
    <span class="absolute top-3 left-3 bg-ivory border border-charcoal/15 px-2 py-0.5 font-mono-archival text-[10px] text-charcoal tracking-widest uppercase">${art.fraction}</span>
  </div>
  <div class="flex justify-between items-baseline">
    <h3 class="font-bodoni font-normal text-base sm:text-lg uppercase tracking-wider text-charcoal">${art.title}</h3>
    <span class="font-mono-archival text-[11px] ${accentClass} tracking-widest">${art.formats}</span>
  </div>
  <p class="font-space font-light text-body-sm text-charcoal/75 mt-1">${art.description}</p>
</div>
    `.trim();
  }).join('\n');

  return `
<section class="w-full px-margin-mobile lg:px-margin py-24 max-w-7xl mx-auto">
  <div class="flex flex-col md:flex-row md:items-end justify-between mb-16 border-b border-charcoal/15 pb-6">
    <div>
      <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.2em] block mb-1 uppercase">THE TRILOGY</span>
      <h2 class="font-bodoni font-normal section-heading-md uppercase tracking-tight text-charcoal">PREVIEW GALLERY</h2>
    </div>
    <p class="font-space font-light text-body-sm text-charcoal/75 max-w-sm mt-3 md:mt-0">
      Each artwork is crafted with tactile strokes, gold leaf accents, and disciplined typography. Click any preview to inspect.
    </p>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
    ${cards}
  </div>
</section>
  `.trim();
}
