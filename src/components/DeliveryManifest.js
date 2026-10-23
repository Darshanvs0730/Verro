/**
 * VÉRRO Component — DeliveryManifest
 * Section 07 part A: 4-block delivery manifest grid
 */

export function renderDeliveryManifest(vol01) {
  const blocks = vol01.deliveryManifest.map(item => `
<div class="bg-parchment border border-charcoal/15 p-6 flex flex-col justify-between">
  <span class="font-mono-archival text-[10px] text-charcoal/70 tracking-widest uppercase">${item.number}</span>
  <div class="my-6">
    <h3 class="font-bodoni font-normal text-lg mb-2 text-charcoal">${item.title}</h3>
    <p class="font-space font-light text-body-sm text-charcoal/75">${item.description}</p>
  </div>
  <span class="font-mono-archival text-[10px] uppercase tracking-widest text-charcoal/60">${item.tag}</span>
</div>
  `.trim()).join('\n');

  return `
<!-- Section Title -->
<div class="text-center max-w-2xl mx-auto mb-16">
  <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.2em] block mb-2 uppercase">DELIVERY MANIFEST</span>
  <h2 class="font-bodoni font-normal section-heading-lg uppercase text-charcoal">WHAT YOU RECEIVE</h2>
  <p class="font-space font-light text-body-md text-charcoal/75 mt-3">Delivered directly to your inbox immediately upon purchase.</p>
</div>
<!-- 4-Block Grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-24">
  ${blocks}
</div>
  `.trim();
}
