/**
 * VÉRRO Architecture Validation Script
 * Verifies data integrity, link validity, asset existence, and zero-drift compliance
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteData } from '../src/data/site.js';
import { vol01 } from '../src/data/vol01.js';
import { faqData } from '../src/data/faq.js';
import { renderStorefront } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let errors = [];
let passed = [];

function check(description, condition) {
  if (condition) {
    passed.push(description);
    console.log(`✓ ${description}`);
  } else {
    errors.push(description);
    console.error(`✗ FAIL: ${description}`);
  }
}

console.log('=== VÉRRO Architecture Integrity Verification ===\n');

// 1. Asset File Existence
console.log('[Check 1: Asset Path Verification]');
for (const [key, asset] of Object.entries(vol01.assets)) {
  const jpgPath = path.join(rootDir, asset.src);
  const webpPath = path.join(rootDir, asset.webp);
  check(`Asset ${key} JPG exists: ${asset.src}`, fs.existsSync(jpgPath));
  check(`Asset ${key} WebP exists: ${asset.webp}`, fs.existsSync(webpPath));
}

for (const artwork of vol01.artworks) {
  const previewPath = path.join(rootDir, artwork.preview);
  const webpPath = path.join(rootDir, artwork.webp);
  check(`Artwork ${artwork.number} preview exists: ${artwork.preview}`, fs.existsSync(previewPath));
  check(`Artwork ${artwork.number} WebP exists: ${artwork.webp}`, fs.existsSync(webpPath));
}

// 2. Asset Security Check (No downloadable masters inside public/)
console.log('\n[Check 2: Asset Security Verification]');
function findFilesRecursive(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

const publicFiles = findFilesRecursive(path.join(rootDir, 'public'));
const leakedMasters = publicFiles.filter(f => /master|high-res|downloadable|fullres/i.test(f));
check('Zero downloadable master files located inside public/', leakedMasters.length === 0);

// 3. Render HTML Verification
console.log('\n[Check 3: Render & Markup Verification]');
const html = renderStorefront();
check('Storefront rendered non-empty markup', html.length > 5000);

// Check forbidden URLs
check('Zero Google AIDA/Stitch URLs in rendered markup', !/lh3\.googleusercontent\.com|aida\//.test(html));

// Check centralized price
check('Centralized formatted price present (₹399)', html.includes(vol01.formattedPrice));
check('Product ID consumed in purchaseProduct call', html.includes(`purchaseProduct('${vol01.id}')`));

// Check Navigation ID Targets
console.log('\n[Check 4: Navigation Link Targets]');
for (const link of siteData.navLinks) {
  if (link.href.startsWith('#')) {
    const targetId = link.href.slice(1);
    const hasTarget = html.includes(`id="${targetId}"`);
    check(`Nav target id="${targetId}" exists in rendered markup`, hasTarget);
  }
}

// Check FAQ Dynamic Count
console.log('\n[Check 5: Dynamic FAQ Count]');
check(`FAQ renders all ${faqData.length} questions dynamically`, (html.match(/class="faq-item/g) || []).length === faqData.length);

// 6. Static Exposure Hardening (Red-team remediation R2)
console.log('\n[Check 6: Static Exposure Hardening]');
const serveConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'serve.json'), 'utf8'));
check('Directory listing disabled for the static storefront server', serveConfig.directoryListing === false);

const unlisted = serveConfig.unlisted || [];
for (const pattern of ['backend/**', 'storage/**', 'tests/**', 'src/**']) {
  check(`Static server unlists ${pattern}`, unlisted.includes(pattern));
}

// Guard: the storefront runtime graph is served from /src/** (src/app.js, src/styles/*.css,
// src/data/*, src/lib/*, src/components/*) because the project ships as ES modules.
// A blanket "/src/:path*" or "/public/:path*" redirect silently breaks the live page,
// so it must never be reintroduced. Only extension-scoped rules may block non-runtime files.
const redirectSourceList = (serveConfig.redirects || []).map((r) => r.source);
const blanketRuntimeRedirects = redirectSourceList.filter((source) => /^\/(src|public)\/:path\*$/.test(source));
check('No blanket redirect removes the storefront runtime asset graph (/src/**, /public/**)', blanketRuntimeRedirects.length === 0);

// Every locally referenced asset in the compiled storefront must exist on disk,
// otherwise the served page degrades silently.
const compiledHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const localAssetRefs = [...compiledHtml.matchAll(/(?:src|href)="((?!https?:|mailto:|#)[^"]+)"/g)]
  .map((match) => match[1])
  .filter((ref) => /\.(js|css|jpg|jpeg|png|webp|svg|woff2?)$/i.test(ref));
const missingLocalAssets = localAssetRefs.filter((ref) => !fs.existsSync(path.join(rootDir, ref)));
check(`All ${localAssetRefs.length} locally referenced storefront assets exist on disk`, missingLocalAssets.length === 0);
if (missingLocalAssets.length > 0) {
  for (const missing of missingLocalAssets) {
    console.error(`    missing asset: ${missing}`);
  }
}

// Sensitive non-archive extensions are blocked by a global redirect glob.
// Archives (.zip/.tar/.gz/...) are intentionally NOT global-globbed: the E2E suite
// requires decoy public paths like /public/vol-01-master.zip to return 404 rather than a
// followed redirect. Archive containment is instead proven by the redirect-blocked-root
// check below (all real archives live under backend/ and private_masters/).
const redirectSources = (serveConfig.redirects || []).map((r) => r.source).join(' ');
for (const ext of ['sqlite', 'env', 'md', 'json', 'bak', 'log']) {
  check(`Static server redirects sensitive *.${ext} requests`, redirectSources.includes(ext));
}
check('Static server redirects private_masters/ requests', redirectSources.includes('private_masters'));

const robotsExists = fs.existsSync(path.join(rootDir, 'robots.txt'));
check('robots.txt present at served root', robotsExists);
if (robotsExists) {
  const robots = fs.readFileSync(path.join(rootDir, 'robots.txt'), 'utf8');
  for (const dir of ['/backend/', '/storage/', '/tests/', '/src/']) {
    check(`robots.txt disallows ${dir}`, robots.includes(`Disallow: ${dir}`));
  }
}

// No downloadable archives may ever live inside the publicly served directory tree
const publicArchiveFiles = publicFiles.filter((f) => /\.(zip|tar|gz|rar|7z)$/i.test(f));
check('Zero archive files (.zip/.tar/.gz/.rar/.7z) inside public/', publicArchiveFiles.length === 0);

// Every archive that does exist in the served tree must sit under a redirect-blocked root
// (private_masters/ is blocked by /**/private_masters/:path* and everything under backend/).
const servedArchiveFiles = [
  ...publicFiles,
  ...findFilesRecursive(path.join(rootDir, 'backend')).filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`)),
  ...fs.readdirSync(rootDir)
    .filter((f) => /\.(zip|tar|tgz|gz|rar|7z)$/i.test(f))
    .map((f) => path.join(rootDir, f))
].filter((f) => /\.(zip|tar|tgz|gz|rar|7z)$/i.test(f));
const unblockedArchives = servedArchiveFiles.filter((f) => !f.includes(`${path.sep}private_masters${path.sep}`) && !f.includes(`${path.sep}backend${path.sep}`));
check('All archive files in the served tree live under a redirect-blocked root', unblockedArchives.length === 0);
if (unblockedArchives.length > 0) {
  for (const archive of unblockedArchives) {
    console.error(`    unblocked archive: ${path.relative(rootDir, archive)}`);
  }
}

// The root test script must target a file that actually exists (F20)
const rootManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const rootTestScript = rootManifest.scripts && rootManifest.scripts.test ? rootManifest.scripts.test : '';
const testTargetArg = rootTestScript.split(/\s+/).pop() || '';
check(`Root "npm test" targets an existing file (${testTargetArg})`, !!testTargetArg && fs.existsSync(path.join(rootDir, testTargetArg)));

// Summary
console.log('\n==================================================');
console.log(`RESULTS: ${passed.length} passed, ${errors.length} failed`);
console.log('==================================================\n');

if (errors.length > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
