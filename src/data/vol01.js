/**
 * VÉRRO Digital Art Gallery — Vol. 01 Master Data Architecture
 * Single Source of Truth for Vol. 01 Catalog, Artworks, Specs, and Assets
 */

export const vol01 = {
  id: "vol-01",
  title: "NO DEFAULTS.",
  collectionName: "VOL. 01 — NO DEFAULTS.",
  price: 399,
  currency: "INR",
  formattedPrice: "₹399",
  tagline: "Three wallpapers. One money chapter.",
  description: "Digital wallpapers for Mac + iPhone. Fine-art brushstrokes, archival gold leaf, and uncompromising typographic discipline.",
  chapter: "01 / THREE ARTWORKS",
  formats: "MAC + IPHONE",
  delivery: "INSTANT DIGITAL",
  license: "PERSONAL LICENSE",
  aspectRatios: "Mac + iPhone",
  wallpapersCountText: "3 Curated Artworks",
  availabilityText: "AVAILABLE NOW",
  pricingNote: "(One-time purchase)",
  
  features: [
    "MAC + IPHONE RATIOS",
    "HIGH RESOLUTION",
    "INSTANT DIGITAL DELIVERY",
    "PERPETUAL PERSONAL USE"
  ],

  // Production Local Asset Endpoints (strictly isolated from downloadable masters)
  assets: {
    hero: {
      src: "public/images/hero/hero-lifestyle.jpg",
      webp: "public/images/hero/hero-lifestyle.webp",
      alt: "VÉRRO Vol. 01 MacBook preview — No Risk, No Story daylight desk environment",
      width: 512,
      height: 286,
      caption: "PLATE 01 · NO RISK, NO STORY",
      subcaption: "[01 / NO RISK, NO STORY]",
      hardwareLabel: "MACBOOK PRO PREVIEW"
    },
    proofSheet: {
      src: "public/images/collections/vol-01-proof-sheet.jpg",
      webp: "public/images/collections/vol-01-proof-sheet.webp",
      alt: "VÉRRO Vol. 01 editorial collection proof sheet featuring trilogy titles: No Risk No Story, Money Talks, and Move Like They're Watching",
      width: 512,
      height: 382,
      caption: "TRILOGY PROOF SPECIMEN",
      volLabel: "VOL. 01"
    },
    inSituHover: {
      src: "public/images/lifestyle/macbook-daylight-no-risk.jpg",
      webp: "public/images/lifestyle/macbook-daylight-no-risk.webp",
      alt: "VÉRRO Vol. 01 in-situ lifestyle preview showing MacBook on stone desk",
      width: 512,
      height: 286,
      label: "IN SITU VIEW"
    },
    eveningStudy: {
      src: "public/images/lifestyle/evening-study-move.jpg",
      webp: "public/images/lifestyle/evening-study-move.webp",
      alt: "VÉRRO Vol. 01 nocturnal study setup with MacBook and iPhone — Move Like They're Watching",
      width: 512,
      height: 286,
      label: "ATMOSPHERE: EVENING STUDY",
      quote: "Move like they’re watching."
    }
  },

  // Individual Artworks
  artworks: [
    {
      id: "no-risk-no-story",
      index: 0,
      number: "01",
      plate: "PLATE 01",
      fraction: "01 / 03",
      title: "NO RISK, NO STORY",
      formats: "MAC · IPHONE",
      description: "Deep gold impasto across charcoal linen.",
      preview: "public/images/previews/01-no-risk-no-story.jpg",
      webp: "public/images/previews/01-no-risk-no-story.webp",
      alt: "VÉRRO Vol. 01 MacBook preview — No Risk, No Story",
      caption: "01 — NO RISK, NO STORY (MacBook Pro Daylight Preview)",
      width: 512,
      height: 286
    },
    {
      id: "money-talks",
      index: 1,
      number: "02",
      plate: "ARCHIVE REF · PLATE 02",
      fraction: "02 / 03",
      title: "MONEY TALKS",
      formats: "MAC · IPHONE",
      accent: "navy",
      description: "Restrained midnight navy with burnished bronze foil lettering.",
      preview: "public/images/collections/vol-01-proof-sheet.jpg", // Fallback specimen for lightbox inspection
      webp: "public/images/collections/vol-01-proof-sheet.webp",
      alt: "VÉRRO Vol. 01 proof specimen — Money Talks",
      caption: "02 — MONEY TALKS (Dedicated Preview Asset Pending)",
      isPendingPreview: true,
      pendingNotice: "Dedicated individual preview asset pending from atelier.",
      pendingBadge: "SPECIMEN IN PROOF",
      width: 512,
      height: 382
    },
    {
      id: "move-like-theyre-watching",
      index: 2,
      number: "03",
      plate: "PLATE 03",
      fraction: "03 / 03",
      title: "MOVE LIKE THEY’RE WATCHING",
      formats: "MAC · IPHONE",
      accent: "oxblood",
      description: "Oxblood & charcoal chiaroscuro with balanced typography.",
      preview: "public/images/previews/03-move-like-theyre-watching.jpg",
      webp: "public/images/previews/03-move-like-theyre-watching.webp",
      alt: "VÉRRO Vol. 01 MacBook and iPhone preview — Move Like They're Watching",
      caption: "03 — MOVE LIKE THEY'RE WATCHING (MacBook Pro & iPhone Evening Preview)",
      width: 512,
      height: 286
    }
  ],

  // Delivery Manifest Pillars
  deliveryManifest: [
    {
      number: "01 / ARCHIVE",
      title: "03 DIGITAL WALLPAPERS",
      description: "The full Vol. 01 chapter: No Risk No Story, Money Talks, Move Like They’re Watching.",
      tag: "COMPLETE CHAPTER"
    },
    {
      number: "02 / HARDWARE",
      title: "MAC + IPHONE",
      description: "Tailored desktop and vertical mobile dimensions framed cleanly for screens and docks.",
      tag: "DUAL FORMAT"
    },
    {
      number: "03 / DISPATCH",
      title: "INSTANT DELIVERY",
      description: "Automated download link delivered to your email address upon successful payment.",
      tag: "IMMEDIATE ACCESS"
    },
    {
      number: "04 / LICENSE",
      title: "PERPETUAL USE",
      description: "Direct digital files for personal use on your own personal devices anytime.",
      tag: "PERSONAL LICENSE"
    }
  ],

  // Atelier Pillars
  atelierPillars: [
    {
      number: "PILLAR 01",
      title: "CURATED",
      description: "Deliberate single chapters built around focused themes."
    },
    {
      number: "PILLAR 02",
      title: "INTENTIONAL",
      description: "Crafted to honor typography and composition on personal screens."
    },
    {
      number: "PILLAR 03",
      title: "EXPRESSIVE",
      description: "A tactile counterweight to default operating system visuals."
    }
  ]
};
