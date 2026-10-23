/**
 * VÉRRO Component — Manifesto
 * Section 02 curatorial statement and philosophy transition
 */

export function renderManifesto(vol01, siteData) {
  return `
<section class="w-full bg-parchment border-y border-charcoal/15 py-24">
  <div class="max-w-4xl mx-auto px-margin-mobile text-center flex flex-col items-center">
    <span class="font-mono-archival text-[11px] tracking-[0.2em] text-charcoal/70 mb-4 uppercase">THE CURATORIAL MANIFESTO</span>
    <h2 class="font-bodoni font-normal section-heading-lg text-charcoal max-w-3xl mb-8">
      <span class="font-mono-archival text-xs sm:text-sm tracking-[0.18em] block mb-2 text-charcoal/80 font-normal">${vol01.collectionName.split(' — ')[0]}</span>
      ${vol01.title}<br/>
      <span class="font-space font-light italic text-charcoal/80 text-xl sm:text-2xl lg:text-3xl block mt-2">${vol01.tagline}</span>
    </h2>
    <p class="font-space font-light text-body-lg text-charcoal/80 max-w-2xl leading-relaxed mb-6">
      Designed to be seen. Not scrolled past. We reject sterile default screensavers and corporate color gradients in pursuit of physical tactile depth, architectural shadows, and raw painterly intent.
    </p>
    <div class="inline-flex items-center gap-3 text-charcoal font-mono-archival text-[11px] tracking-[0.18em] uppercase py-2 px-4 border border-charcoal/20 bg-ivory">
      <span class="font-bodoni text-xs font-normal tracking-[0.2em]">${siteData.brandName}</span>
      <span>·</span>
      <span class="font-space text-[10px] tracking-[0.16em]">${siteData.tagline}</span>
    </div>
  </div>
</section>
  `.trim();
}
