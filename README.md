# VÉRRO — Digital Art Gallery & Atelier

Curated Digital Wallpapers for the Unordinary (Vol. 01).

---

## Overview

VÉRRO is an editorial digital art storefront and custom commerce system designed with typographic rigor and secure digital entitlement.

- **Editorial Frontend:** Built with native ES modules, custom design tokens, Bodoni Moda serifs, Space Grotesk body typography, and responsive proof sheets.
- **Commerce Backend:** Node.js, Express, TypeScript, and SQLite (`better-sqlite3` in WAL mode) with server-authoritative catalog pricing, cryptographic customer access tokens, and gated digital delivery.
- **Security Invariants:** Strict client/server separation, tamper-proof download tokens, fail-closed payment adapters, and isolated test suites.

---

## Project Structure

```
├── public/                 # Optimized local WebP/JPG previews and assets
├── src/                    # Native ES module storefront
│   ├── components/         # Modular UI components (Navigation, Hero, Showcase, etc.)
│   ├── data/               # Catalog and monograph copy definitions
│   ├── lib/                # Client purchase service and image utilities
│   └── styles/             # Design tokens and global CSS
├── backend/                # Commerce API service
│   ├── src/                # Express TypeScript source
│   │   ├── adapters/       # Payment gateway adapters (YouPI / Development mock)
│   │   ├── controllers/    # Order, checkout, and webhook handlers
│   │   ├── repositories/   # SQLite persistence layer
│   │   └── services/       # Order management, fulfillment, and email dispatch
│   └── tests/              # Backend regression and security test suites
├── tests/                  # Viewport, E2E commerce, and architecture test suites
├── DESIGN.md               # Authoritative VÉRRO design system tokens
└── serve.json              # Static server routing, CSP headers, and access restrictions
```

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm

### 1. Storefront

```bash
# Install root dependencies
npm install

# Start the storefront server (port 4173)
npm run dev
```

### 2. Commerce Backend

```bash
cd backend

# Install backend dependencies
npm install

# Configure environment
cp .env.example .env

# Start development server (port 4000)
npm run dev
```

---

## Testing & Quality Assurance

```bash
# Architecture integrity & security guardrails (94 checks)
npm test

# Backend commerce, adapter, and security tests (32 checks)
cd backend && npm test

# End-to-end commerce lifecycle
npm run test:e2e

# 6-viewport visual regression audit (390px to 1728px)
npm run test:viewports
```

---

## License

Private / All rights reserved © VÉRRO Atelier.
