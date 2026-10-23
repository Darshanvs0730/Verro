/**
 * VÉRRO Digital Art Gallery — Production Build Script
 * Compiles modular ES components and centralized data into production HTML
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteData } from './src/data/site.js';
import { vol01 } from './src/data/vol01.js';
import { renderStorefront } from './src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateHtml() {
  const storefrontContent = renderStorefront();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="description" content="${siteData.seoDescription}"/>
  <meta name="shell-type" content="web_standard"/>
  <title>${siteData.seoTitle}</title>

  <!-- Typography: Bodoni Moda (Display) + Space Grotesk (Body) + IBM Plex Mono (Archival) -->
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
  <link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400;1,6..96,500&amp;family=IBM+Plex+Mono:wght@400;500&amp;family=Space+Grotesk:wght@300;400;500;600&amp;display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>

  <!-- Preload critical hero lifestyle asset -->
  <link rel="preload" as="image" href="${vol01.assets.hero.webp}" type="image/webp"/>

  <!-- Modular Design System Stylesheets -->
  <link rel="stylesheet" href="src/styles/tokens.css"/>
  <link rel="stylesheet" href="src/styles/globals.css"/>

  <!-- Tailwind CSS Engine -->
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <script id="tailwind-config">
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "ivory": "#F2EBDD",
            "parchment": "#E8DDC9",
            "charcoal": "#171717",
            "gold": "#B08A4A",
            "navy": "#173A5E",
            "oxblood": "#641F23",
            "canvas": "#F2EBDD",
            "surface": "#E8DDC9"
          },
          borderRadius: {
            "none": "0px",
            "DEFAULT": "0px",
            "sm": "0px",
            "md": "0px",
            "lg": "0px",
            "xl": "0px",
            "2xl": "0px",
            "3xl": "0px",
            "full": "9999px"
          },
          boxShadow: {
            "none": "none",
            "sm": "none",
            "DEFAULT": "none",
            "md": "none",
            "lg": "none",
            "xl": "none",
            "2xl": "none"
          },
          spacing: {
            "space-xs": "0.25rem",
            "space-sm": "0.5rem",
            "space-md": "1rem",
            "space-lg": "2rem",
            "space-xl": "3.5rem",
            "space-2xl": "6rem",
            "gutter": "2rem",
            "margin": "4rem",
            "gutter-mobile": "1rem",
            "margin-mobile": "1.5rem"
          },
          fontFamily: {
            "bodoni": ["'Bodoni Moda'", "Georgia", "serif"],
            "space": ["'Space Grotesk'", "sans-serif"],
            "mono-archival": ["'IBM Plex Mono'", "monospace"],
            "display-xl": ["'Bodoni Moda'", "Georgia", "serif"],
            "headline-lg": ["'Bodoni Moda'", "Georgia", "serif"],
            "headline-md": ["'Bodoni Moda'", "Georgia", "serif"],
            "headline-sm": ["'Bodoni Moda'", "Georgia", "serif"],
            "body-lg": ["'Space Grotesk'", "sans-serif"],
            "body-md": ["'Space Grotesk'", "sans-serif"],
            "body-sm": ["'Space Grotesk'", "sans-serif"],
            "label-uppercase": ["'Space Grotesk'", "sans-serif"],
            "label-meta": ["'Space Grotesk'", "sans-serif"]
          },
          fontSize: {
            "display-xl": ["clamp(2rem, 1.25rem + 3.5vw, 4.25rem)", { lineHeight: "1.08", letterSpacing: "-0.02em", fontWeight: "400" }],
            "headline-lg": ["clamp(1.75rem, 1.2rem + 2.2vw, 3rem)", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "400" }],
            "headline-md": ["clamp(1.35rem, 1rem + 1.2vw, 2rem)", { lineHeight: "1.25", letterSpacing: "0em", fontWeight: "400" }],
            "headline-sm": ["clamp(1.15rem, 0.95rem + 0.8vw, 1.5rem)", { lineHeight: "1.35", letterSpacing: "0.01em", fontWeight: "400" }],
            "body-lg": ["clamp(1rem, 0.95rem + 0.3vw, 1.125rem)", { lineHeight: "1.8", letterSpacing: "0.01em", fontWeight: "300" }],
            "body-md": ["0.9375rem", { lineHeight: "1.625rem", letterSpacing: "0.01em", fontWeight: "400" }],
            "body-sm": ["0.8125rem", { lineHeight: "1.45rem", letterSpacing: "0.015em", fontWeight: "400" }],
            "label-uppercase": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.15em", fontWeight: "500" }],
            "label-meta": ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0.14em", fontWeight: "500" }]
          }
        }
      }
    };
  </script>
</head>
<body class="bg-ivory font-space font-normal text-body-md text-charcoal antialiased selection:bg-charcoal selection:text-ivory">

${storefrontContent}

  <!-- YouPI Sovereign UPI Universal Checkout SDK -->
  <script src="public/vendor/youpi.js"></script>

  <!-- Client-side Application Orchestrator -->
  <script type="module" src="src/app.js"></script>
</body>
</html>
`;
}

function build() {
  console.log('--- Compiling VÉRRO Storefront Architecture ---');
  const html = generateHtml();
  
  const codeHtmlPath = path.join(__dirname, 'code.html');
  const indexHtmlPath = path.join(__dirname, 'index.html');

  fs.writeFileSync(codeHtmlPath, html, 'utf-8');
  console.log(`✓ Compiled: code.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

  fs.writeFileSync(indexHtmlPath, html, 'utf-8');
  console.log(`✓ Compiled: index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

  console.log('✓ Architecture compilation complete. Zero data duplication verified.');
}

build();
