/**
 * VÉRRO Digital Art Gallery — Main Application Orchestrator
 * Connects centralized data, design tokens, and modular components
 */

import { vol01 } from './data/vol01.js';
import { siteData } from './data/site.js';
import { faqData } from './data/faq.js';
import { purchaseService, purchaseProduct } from './lib/purchaseService.js';
import { handleImageError } from './lib/imageUtils.js';

import { renderNavigation, initNavigation } from './components/Navigation.js';
import { renderMobileMenu } from './components/MobileMenu.js';
import { renderHero } from './components/Hero.js';
import { renderManifesto } from './components/Manifesto.js';
import { renderCollectionCard, initInteractiveCard } from './components/CollectionCard.js';
import { renderProductShowcase } from './components/ProductShowcase.js';
import { renderPreviewGallery } from './components/PreviewGallery.js';
import { renderEditorialStatement } from './components/EditorialStatement.js';
import { renderDeliveryManifest } from './components/DeliveryManifest.js';
import { renderPhilosophy } from './components/Philosophy.js';
import { renderFAQ, initFAQ } from './components/FAQ.js';
import { renderCallToAction } from './components/CallToAction.js';
import { renderLightbox, initLightbox } from './components/Lightbox.js';
import { renderFooter } from './components/Footer.js';

/**
 * Assemble and render the complete VÉRRO storefront markup
 * @returns {string} Complete HTML inner content of body
 */
export function renderStorefront() {
  return `
<!-- Header & Navigation -->
${renderNavigation(siteData, vol01)}

<main class="w-full min-h-screen pt-20">
  <!-- Mobile Navigation Drawer -->
  ${renderMobileMenu(siteData, vol01)}

  <div class="flex flex-col w-full">
    <!-- 1. Hero Section -->
    ${renderHero(vol01)}

    <!-- 2. Curatorial Manifesto -->
    ${renderManifesto(vol01, siteData)}

    <!-- 3. Archive Collection Card -->
    ${renderCollectionCard(vol01)}

    <!-- 4. Dedicated Product Showcase -->
    ${renderProductShowcase(vol01)}

    <!-- 5. Individual Preview Gallery -->
    ${renderPreviewGallery(vol01)}

    <!-- 6. Full-Width Nocturnal Editorial Statement -->
    ${renderEditorialStatement(vol01)}

    <!-- 7. Delivery Manifest & Atelier Philosophy -->
    <section class="w-full px-margin-mobile lg:px-margin py-24 max-w-7xl mx-auto" id="philosophy">
      ${renderDeliveryManifest(vol01)}
      ${renderPhilosophy(vol01)}
    </section>

    <!-- 8. Accordion FAQ -->
    ${renderFAQ(faqData, siteData)}

    <!-- 9. Final Call-to-Acquisition -->
    ${renderCallToAction(vol01)}
  </div>
</main>

<!-- Lightbox Modal -->
${renderLightbox()}

<!-- Footer -->
${renderFooter(siteData)}
  `.trim();
}

/**
 * Initialize all interactive components and event listeners
 */
export function initApp() {
  // Expose global helpers for backward compatibility with inline markup
  if (typeof window !== 'undefined') {
    window.purchaseService = purchaseService;
    window.purchaseProduct = purchaseProduct;
    window.handleImageError = handleImageError;
  }

  // Initialize interactive components
  initNavigation();
  initInteractiveCard();
  initFAQ();
  initLightbox(vol01);

  console.info('[VÉRRO Architecture] Application initialized successfully with centralized data.');
}

// Auto-initialize if running directly in a browser environment
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
