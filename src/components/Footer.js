/**
 * VÉRRO Component — Footer
 * Section 12 footer branding, centralized navigation links, and copyright
 */

export function renderFooter(siteData) {
  const navLinks = siteData.navLinks.map(link => `
<a class="font-space font-medium text-label-uppercase uppercase text-charcoal/70 hover:text-charcoal transition-colors tracking-[0.15em]" href="${link.href}">${link.label}</a>
  `.trim()).join('\n');

  const legalLinks = siteData.footerLinks.map(link => `
<a class="hover:text-charcoal transition-colors" href="${link.href}">${link.label}</a>
  `.trim()).join('\n');

  return `
<!-- FOOTER -->
<footer class="w-full bg-parchment border-t border-charcoal/15 mt-space-2xl">
  <div class="max-w-7xl mx-auto px-margin-mobile lg:px-margin py-space-xl flex flex-col gap-space-xl">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-space-lg">
      <div class="flex flex-col gap-space-xs">
        <span class="font-bodoni font-normal text-headline-md uppercase tracking-[0.28em] text-charcoal">${siteData.brandName}</span>
        <p class="font-space text-label-meta uppercase tracking-[0.18em] text-charcoal/70">${siteData.tagline}</p>
      </div>
      <nav class="flex flex-wrap items-center gap-space-md md:gap-space-lg">
        ${navLinks}
        <a class="font-space font-medium text-label-uppercase uppercase text-charcoal/70 hover:text-charcoal transition-colors tracking-[0.15em]" href="${siteData.social.instagram.url}" rel="noopener noreferrer" target="_blank">${siteData.social.instagram.handle}</a>
      </nav>
    </div>
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-space-sm pt-space-md border-t border-charcoal/15 font-space text-body-sm text-charcoal/70">
      <p>${siteData.copyrightNotice}</p>
      <div class="flex gap-space-md font-space font-medium text-label-meta uppercase tracking-[0.14em]">
        ${legalLinks}
      </div>
    </div>
  </div>
</footer>
  `.trim();
}
