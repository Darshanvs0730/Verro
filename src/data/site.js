/**
 * VÉRRO Digital Art Gallery — Site & Brand Configuration
 * Centralized Navigation, Brand Metadata, and Global Settings
 */

export const siteData = {
  brandName: "VÉRRO",
  tagline: "DESIGNED FOR THE UNORDINARY.",
  seoTitle: "VÉRRO — Designed for the Unordinary | Vol. 01",
  seoDescription: "Digital fine-art wallpapers for Mac + iPhone. Fine-art brushstrokes, archival gold leaf, and uncompromising typographic discipline.",
  contactEmail: "atelier@verro.design",
  copyrightNotice: "© 2025 VÉRRO. ALL RIGHTS RESERVED.",
  
  social: {
    instagram: {
      handle: "@verro.walls",
      url: "https://instagram.com/verro.walls"
    }
  },

  navLinks: [
    { label: "VOL. 01", href: "#product-showcase", isHighlighted: true },
    { label: "ARCHIVE", href: "#archive-section", isHighlighted: false },
    { label: "ABOUT", href: "#philosophy", isHighlighted: false },
    { label: "FAQ", href: "#faq", isHighlighted: false }
  ],

  footerLinks: [
    { label: "TERMS", href: "#" },
    { label: "PRIVACY", href: "#" }
  ]
};
