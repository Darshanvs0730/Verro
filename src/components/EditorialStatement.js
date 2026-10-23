/**
 * VÉRRO Component — EditorialStatement
 * Section 06 full-width nocturnal editorial statement on deep Charcoal
 */

export function renderEditorialStatement(vol01) {
  const asset = vol01.assets.eveningStudy;

  return `
<section class="w-full bg-charcoal text-ivory py-28 relative overflow-hidden">
  <div class="max-w-7xl mx-auto px-margin-mobile lg:px-margin grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
    <div class="lg:col-span-7 flex flex-col justify-center">
      <div class="flex items-center gap-3 mb-6">
        <span class="w-8 h-px bg-gold"></span>
        <span class="font-mono-archival text-[11px] text-gold tracking-[0.25em] uppercase">DAILY RITUAL</span>
      </div>
      <h2 class="font-bodoni font-normal editorial-heading leading-[1.08] tracking-tight mb-8 text-ivory">
        MORE THAN A<br/>WALLPAPER.<br/>
        <span class="text-gold font-normal italic block mt-3">A DAILY STANDARD.</span>
      </h2>
      <p class="font-space font-light text-body-lg text-parchment/80 max-w-xl mb-8 leading-relaxed">
        The same visual language, everywhere your screen goes. Mac. iPhone. One intentional identity.
      </p>
      <div class="flex flex-wrap items-center gap-6 pt-4 border-t border-white/10">
        <div class="flex flex-col">
          <span class="font-bodoni font-normal text-2xl sm:text-3xl text-ivory">03</span>
          <span class="font-mono-archival text-[10px] tracking-[0.18em] text-gold uppercase">WALLPAPERS</span>
        </div>
        <div class="w-px h-10 bg-white/10"></div>
        <div class="flex flex-col">
          <span class="font-space font-medium text-lg sm:text-xl text-ivory">DUAL FORMAT</span>
          <span class="font-mono-archival text-[10px] tracking-[0.18em] text-gold uppercase">MAC + IPHONE</span>
        </div>
        <div class="w-px h-10 bg-white/10"></div>
        <div class="flex flex-col">
          <span class="font-space font-medium text-lg sm:text-xl text-ivory">INSTANT</span>
          <span class="font-mono-archival text-[10px] tracking-[0.18em] text-gold uppercase">DIGITAL DISPATCH</span>
        </div>
      </div>
    </div>
    <div class="lg:col-span-5 relative">
      <div class="relative overflow-hidden border border-white/10 bg-black/40">
        <picture>
          <source srcset="${asset.webp}" type="image/webp"/>
          <img alt="${asset.alt}" class="w-full aspect-[4/5] object-cover" decoding="async" height="${asset.height || 286}" loading="lazy" onerror="handleImageError(this, 'EDITORIAL_LIFESTYLE')" src="${asset.src}" width="${asset.width || 512}"/>
        </picture>
        <div class="absolute inset-0 bg-gradient-to-t from-charcoal via-transparent to-transparent"></div>
        <div class="absolute bottom-6 left-6 right-6">
          <p class="font-mono-archival text-[11px] text-gold tracking-[0.18em] uppercase mb-1">${asset.label}</p>
          <p class="font-bodoni font-normal italic text-lg text-ivory">${asset.quote}</p>
        </div>
      </div>
    </div>
  </div>
</section>
  `.trim();
}
