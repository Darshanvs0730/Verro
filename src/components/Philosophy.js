/**
 * VÉRRO Component — Philosophy
 * Section 07 part B: About the Atelier & 3 Pillars split panel
 */

export function renderPhilosophy(vol01) {
  const pillars = vol01.atelierPillars.map(pillar => `
<div class="border-t border-charcoal/20 pt-4">
  <span class="font-mono-archival text-xs text-charcoal/70 tracking-widest">${pillar.number}</span>
  <h4 class="font-space font-medium text-base sm:text-lg my-2 uppercase tracking-wider text-charcoal">${pillar.title}</h4>
  <p class="font-space font-light text-body-sm text-charcoal/75">${pillar.description}</p>
</div>
  `.trim()).join('\n');

  return `
<div class="bg-parchment border border-charcoal/15 p-8 lg:p-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
  <div class="lg:col-span-5">
    <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.2em] block mb-2 uppercase">ABOUT THE ATELIER</span>
    <h3 class="font-bodoni font-normal text-[2rem] lg:text-[2.65rem] leading-tight mb-4 text-charcoal">
      DESIGNED FOR THE UNORDINARY.
    </h3>
    <p class="font-space font-light text-body-md text-charcoal/75 leading-relaxed">
      We make wallpapers for people who spend enough time looking at a screen to care what they see.
    </p>
  </div>
  <div class="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-6">
    ${pillars}
  </div>
</div>
  `.trim();
}
