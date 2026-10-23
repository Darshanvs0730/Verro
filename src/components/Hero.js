/**
 * VÉRRO Component — Hero
 * Masthead editorial presentation & lifestyle preview
 */

export function renderHero(vol01) {
  const heroAsset = vol01.assets.hero;

  return `
<section class="relative w-full px-margin-mobile lg:px-margin pt-8 lg:pt-14 pb-20 max-w-7xl mx-auto">
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-y-12 lg:gap-gutter items-start">
    <!-- Left Column -->
    <div class="lg:col-span-5 flex flex-col justify-between pt-2">
      <div>
        <div class="flex items-center gap-space-sm mb-6">
          <span class="inline-block w-2 h-2 rounded-full bg-gold"></span>
          <span class="font-mono-archival text-[10px] text-charcoal/70 uppercase tracking-[0.16em]">DIGITAL RELEASE</span>
        </div>
        <h1 class="font-bodoni font-normal hero-heading text-charcoal mb-8">
          DESIGNED<br/>FOR THE<br/><span class="font-normal italic tracking-[-0.01em] text-charcoal">UNORDINARY.</span>
        </h1>
        <div class="w-16 h-px bg-charcoal/20 mb-8"></div>
        <p class="font-space font-light text-body-lg text-charcoal/75 max-w-md mb-4 leading-relaxed">
          ${vol01.description}
        </p>
        <p class="mb-10 flex items-center gap-2">
          <span class="font-mono-archival text-[11px] uppercase tracking-[0.16em] text-charcoal/80">${vol01.collectionName.split(' — ')[0]}</span>
          <span class="font-space font-medium text-label-meta uppercase tracking-[0.18em] text-charcoal/70">— ${vol01.title}</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <a class="px-8 py-4 bg-charcoal text-ivory font-space font-medium text-label-uppercase tracking-[0.15em] hover:bg-gold hover:text-charcoal transition-colors duration-200" href="#product-showcase">
          EXPLORE ${vol01.collectionName.split(' — ')[0]} →
        </a>
        <a class="px-8 py-4 border border-charcoal/30 text-charcoal font-space font-medium text-label-uppercase tracking-[0.15em] hover:border-charcoal hover:bg-charcoal/5 transition-colors duration-200" href="#archive-section">
          VIEW ARCHIVE
        </a>
      </div>
      <div class="mt-14 pt-6 border-t border-charcoal/15 grid grid-cols-3 gap-2 sm:gap-4">
        <div>
          <span class="block font-mono-archival text-[10px] text-charcoal/70 uppercase tracking-[0.12em]">CHAPTER</span>
          <span class="font-space text-xs sm:text-sm font-medium tracking-wide">${vol01.chapter}</span>
        </div>
        <div>
          <span class="block font-mono-archival text-[10px] text-charcoal/70 uppercase tracking-[0.12em]">FORMATS</span>
          <span class="font-mono-archival text-xs sm:text-sm font-medium tracking-wider">${vol01.formats}</span>
        </div>
        <div>
          <span class="block font-mono-archival text-[10px] text-charcoal/70 uppercase tracking-[0.12em]">DELIVERY</span>
          <span class="font-space text-xs sm:text-sm font-medium tracking-wide">${vol01.delivery}</span>
        </div>
      </div>
    </div>
    <!-- Right Column -->
    <div class="lg:col-span-7 relative">
      <div class="relative bg-parchment border border-charcoal/15 overflow-hidden group cursor-pointer" onclick="openLightbox(0)">
        <picture>
          <source srcset="${heroAsset.webp}" type="image/webp"/>
          <img alt="${heroAsset.alt}" class="w-full aspect-[16/10] object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]" fetchpriority="high" height="${heroAsset.height}" onerror="handleImageError(this, 'HERO_LIFESTYLE')" src="${heroAsset.src}" width="${heroAsset.width}"/>
        </picture>
        <div class="absolute top-4 left-4 bg-parchment px-3 py-1.5 border border-charcoal/20 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-gold"></span>
          <span class="font-mono-archival text-[11px] uppercase tracking-[0.14em] text-charcoal">${heroAsset.caption}</span>
        </div>
        <div class="absolute bottom-4 right-4 bg-charcoal text-ivory px-3 py-1.5 text-xs font-space font-medium tracking-[0.14em] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[16px]">fullscreen</span>
          <span>VIEW PREVIEW</span>
        </div>
      </div>
      <div class="flex items-center justify-between mt-3 text-charcoal/70 font-mono-archival text-[11px] tracking-[0.14em]">
        <span>${heroAsset.subcaption}</span>
        <span class="uppercase">${heroAsset.hardwareLabel}</span>
      </div>
    </div>
  </div>
</section>
  `.trim();
}
