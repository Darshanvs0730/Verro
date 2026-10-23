/**
 * VÉRRO Component — Navigation
 * Primary desktop header navigation & mobile trigger
 */

export function renderNavigation(siteData, vol01) {
  const navItems = siteData.navLinks.map(link => {
    const textClass = link.isHighlighted 
      ? 'text-charcoal hover:text-gold' 
      : 'text-charcoal/70 hover:text-charcoal';
    return `<a class="font-space font-medium text-label-uppercase uppercase ${textClass} transition-colors tracking-[0.16em]" href="${link.href}">${link.label}</a>`;
  }).join('\n');

  return `
<header class="fixed top-0 left-0 right-0 z-50 bg-ivory border-b border-charcoal/15">
  <div class="h-20 max-w-7xl mx-auto px-margin-mobile lg:px-margin flex items-center justify-between">
    <a class="flex items-center gap-space-xs" href="#">
      <span class="font-bodoni font-normal text-[1.4rem] uppercase tracking-[0.28em] text-charcoal">${siteData.brandName}</span>
    </a>
    <!-- Desktop Nav -->
    <nav class="hidden md:flex items-center gap-space-lg">
      ${navItems}
    </nav>
    <!-- Right Action Area -->
    <div class="flex items-center gap-3">
      <button class="hidden sm:inline-flex items-center justify-center px-5 py-2.5 bg-charcoal text-ivory font-space font-medium text-label-uppercase tracking-[0.16em] hover:bg-gold hover:text-charcoal transition-colors duration-200" onclick="purchaseProduct('${vol01.id}')" type="button">
        ACQUIRE VOL. 01 — ${vol01.formattedPrice}
      </button>
      <button aria-label="Toggle Navigation Menu" class="md:hidden flex items-center justify-center w-10 h-10 text-charcoal hover:text-gold transition-colors focus:outline-none" onclick="toggleMobileMenu()" type="button">
        <span class="material-symbols-outlined text-[24px]" id="mobile-menu-icon">menu</span>
      </button>
    </div>
  </div>
</header>
  `.trim();
}

/**
 * Initialize Mobile Navigation Toggle Logic
 */
export function initNavigation() {
  window.toggleMobileMenu = function() {
    const drawer = document.getElementById('mobile-drawer');
    const icon = document.getElementById('mobile-menu-icon');
    if (drawer) {
      const isHidden = drawer.classList.contains('hidden');
      if (isHidden) {
        drawer.classList.remove('hidden');
        drawer.classList.add('flex');
        if (icon) icon.textContent = 'close';
      } else {
        drawer.classList.add('hidden');
        drawer.classList.remove('flex');
        if (icon) icon.textContent = 'menu';
      }
    }
  };
}
