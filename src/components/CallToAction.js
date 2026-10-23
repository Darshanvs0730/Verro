/**
 * VÉRRO Component — CallToAction
 * Section 09 final call-to-acquisition panel
 */

export function renderCallToAction(vol01) {
  return `
<section class="w-full py-20 px-margin-mobile border-t border-charcoal/15 bg-ivory">
  <div class="max-w-4xl mx-auto text-center flex flex-col items-center">
    <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.25em] mb-3 uppercase">CURATED EDITION</span>
    <h2 class="font-bodoni font-normal section-heading-lg uppercase mb-4 text-charcoal">ELEVATE YOUR WORKSPACE TODAY.</h2>
    <p class="font-space font-light text-body-md text-charcoal/75 max-w-lg mb-8">
      ${vol01.collectionName.split(' — ')[0]} — ${vol01.tagline} ${vol01.formats}.
    </p>
    <div class="flex flex-col sm:flex-row items-center gap-4">
      <button class="px-10 py-4 bg-charcoal text-ivory hover:bg-gold hover:text-charcoal transition-colors duration-200 font-space font-medium text-label-uppercase tracking-[0.2em]" onclick="purchaseProduct('${vol01.id}')" type="button">
        ACQUIRE ${vol01.collectionName.split(' — ')[0]} — ${vol01.formattedPrice}
      </button>
      <a class="px-8 py-4 border border-charcoal/30 text-charcoal font-space font-medium text-label-uppercase tracking-[0.16em] hover:border-charcoal hover:bg-charcoal/5 transition-colors" href="#product-showcase">
        REVIEW ARTWORKS
      </a>
    </div>
  </div>
</section>
  `.trim();
}
