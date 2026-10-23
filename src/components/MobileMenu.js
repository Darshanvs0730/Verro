/**
 * VÉRRO Component — MobileMenu
 * Slide-out / drop-down drawer for mobile viewports
 */

export function renderMobileMenu(siteData, vol01) {
  const links = siteData.navLinks.map(link => {
    const textClass = link.isHighlighted 
      ? 'text-charcoal' 
      : 'text-charcoal/70';
    return `<a class="font-space font-medium text-label-uppercase uppercase ${textClass} tracking-[0.16em] py-1" href="${link.href}" onclick="toggleMobileMenu()">${link.label}</a>`;
  }).join('\n');

  return `
<div class="hidden md:hidden border-t border-charcoal/15 bg-parchment px-margin-mobile py-6 flex-col gap-4" id="mobile-drawer">
  <nav class="flex flex-col gap-4">
    ${links}
  </nav>
  <div class="pt-4 border-t border-charcoal/15">
    <button class="w-full py-3 bg-charcoal text-ivory font-space font-medium text-label-uppercase tracking-[0.16em] hover:bg-gold hover:text-charcoal transition-colors text-center" onclick="purchaseProduct('${vol01.id}')" type="button">
      ACQUIRE VOL. 01 — ${vol01.formattedPrice}
    </button>
  </div>
</div>
  `.trim();
}
