/**
 * VÉRRO Component — FAQ
 * Section 08 accordion FAQ rendering dynamically from centralized FAQ data
 */

export function renderFAQ(faqData, siteData) {
  const faqItems = faqData.map(item => `
<div class="faq-item py-6">
  <button aria-expanded="false" class="faq-toggle w-full flex justify-between items-center text-left font-space font-normal text-base sm:text-lg text-charcoal hover:text-gold transition-colors focus:outline-none" type="button">
    <span>${item.question}</span>
    <span class="material-symbols-outlined transition-transform duration-300 icon-arrow">add</span>
  </button>
  <div class="faq-content hidden pt-4 text-charcoal/80 font-space font-light text-body-md leading-relaxed pr-8">
    ${item.answer}
  </div>
</div>
  `.trim()).join('\n');

  return `
<section class="w-full bg-parchment border-t border-charcoal/15 py-24 px-margin-mobile lg:px-margin" id="faq">
  <div class="max-w-4xl mx-auto">
    <div class="text-center mb-16">
      <span class="font-mono-archival text-[11px] text-charcoal/70 tracking-[0.2em] block mb-2 uppercase">INQUIRIES</span>
      <h2 class="font-bodoni font-normal section-heading-lg uppercase text-charcoal">FREQUENTLY ASKED</h2>
    </div>
    <div class="divide-y divide-charcoal/15 border-y border-charcoal/15" id="faq-accordion">
      ${faqItems}
    </div>
    <div class="mt-12 text-center">
      <p class="font-space text-body-sm text-charcoal/75">
        Have a question or custom inquiry? Reach us at 
        <a class="font-mono-archival text-xs text-charcoal underline underline-offset-4 hover:text-gold" href="mailto:${siteData.contactEmail}">${siteData.contactEmail}</a>
      </p>
    </div>
  </div>
</section>
  `.trim();
}

/**
 * Initialize Accordion toggle interactions
 */
export function initFAQ() {
  const toggles = document.querySelectorAll('.faq-toggle');
  toggles.forEach(button => {
    button.addEventListener('click', () => {
      const content = button.nextElementSibling;
      const icon = button.querySelector('.icon-arrow');
      const isExpanded = button.getAttribute('aria-expanded') === 'true';

      // Close all items
      document.querySelectorAll('.faq-content').forEach(c => c.classList.add('hidden'));
      document.querySelectorAll('.faq-toggle').forEach(t => {
        t.setAttribute('aria-expanded', 'false');
        const i = t.querySelector('.icon-arrow');
        if (i) i.textContent = 'add';
      });

      // Toggle clicked item
      if (!isExpanded) {
        content.classList.remove('hidden');
        button.setAttribute('aria-expanded', 'true');
        if (icon) icon.textContent = 'remove';
      }
    });
  });
}
