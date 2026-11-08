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

// 7. Commerce Security Remediation Guards (Phase 12)
//
// These are static guards for invariants that a runtime test cannot cheaply reach (the
// storefront is not executed here, and the backend suites cover behaviour). They exist so the
// specific shapes that produced the audit findings cannot be quietly re-introduced.
console.log('\n[Check 7: Commerce Security Remediation Guards]');

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

/** Extract a method/function body by name using brace matching from its first `{`. */
function extractBlock(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const purchaseServiceSource = readSource('src/lib/purchaseService.js');
const orderControllerSource = readSource('backend/src/controllers/orderController.ts');

// F-03: settlement reconciliation is purchaser-scoped. The pre-fix storefront POSTed to
// /verify with no credential at all.
const settleBlock = extractBlock(purchaseServiceSource, 'async verifyAndSettleOrder(');
check('Storefront reconciliation sends a purchaser credential (no unauthenticated /verify call)', /Authorization/.test(settleBlock) && /getPurchaserToken\(/.test(settleBlock));
check('Storefront reconciles through the shared purchaser-token accessor', /getPurchaserToken\(orderId\)/.test(purchaseServiceSource));

// F-2x: the checkout iframe message surface must validate BOTH origin and source window.
const checkoutModalBlock = extractBlock(purchaseServiceSource, '_injectDirectCheckoutModal(');
check('Checkout postMessage handler validates the sender origin', /has\(e\.origin\)/.test(checkoutModalBlock));
check('Checkout postMessage handler validates the sender window', /e\.source !== iframe\.contentWindow/.test(checkoutModalBlock));

// F-05: references the backend itself used to synthesise must never reappear on either side.
const syntheticReferences = ['youpi_reconciled', 'youpi_settlement', 'dev_ref'];
const storefrontSources = [
  purchaseServiceSource,
  readSource('src/components/PaymentModal.js'),
  orderControllerSource,
  readSource('backend/src/services/orderService.ts'),
  readSource('backend/src/controllers/webhookController.ts')
].join('\n');
for (const synthetic of syntheticReferences) {
  check(`No producer fabricates the retired settlement reference "${synthetic}"`, !storefrontSources.includes(`= '${synthetic}'`) && !storefrontSources.includes(`'${synthetic}'`));
}

// F-20: reconciliation must be driven by the server-persisted session id, never by a
// client-supplied one or by the order id.
check('Backend reconciliation reads the persisted payment session id', /order\.payment_session_id/.test(extractBlock(orderControllerSource, 'async verifyPaymentStatus(')));
check('Backend reconciliation is authorized before any settlement attempt', (() => {
  const block = extractBlock(orderControllerSource, 'async verifyPaymentStatus(');
  const guard = block.indexOf('access.authorized');
  const settle = block.indexOf('processVerifiedPayment');
  return guard !== -1 && settle !== -1 && guard < settle;
})());

// F-01/F-02: the unauthenticated multi-rail webhook surface is gone for good.
const webhookRoutesSource = readSource('backend/src/routes/webhookRoutes.ts');
check('No unauthenticated /webhooks/sms route exists', !/['"]\/sms['"]/.test(webhookRoutesSource));
check('No unauthenticated /webhooks/email route exists', !/['"]\/email['"]/.test(webhookRoutesSource));

// F-40: the migration that added the session column must remain additive.
const databaseSource = readSource('backend/src/repositories/database.ts');
check('Session column is added by an additive migration', /ALTER TABLE orders ADD COLUMN payment_session_id/.test(databaseSource));
check('Session column migration is isolated so legacy databases still boot', /for \(const migration of \[/.test(databaseSource) && /ALTER TABLE orders ADD COLUMN payment_session_id TEXT;/.test(databaseSource) && /\} catch \{\n\s*\/\/ Column already exists/.test(databaseSource));
check('Session column is indexed for reconciliation lookups', /CREATE INDEX IF NOT EXISTS idx_orders_payment_session ON orders\(payment_session_id\)/.test(databaseSource));

// CSP: the static server must forbid plugin/worker embedding and pin the payment frame origin.
const cspValue = (serveConfig.headers || [])
  .flatMap((rule) => rule.headers || [])
  .find((header) => header.key === 'Content-Security-Policy')?.value || '';
check('Storefront CSP forbids plugin embedding (object-src none)', /object-src 'none'/.test(cspValue));
check('Storefront CSP pins the checkout frame origin (frame-src)', /frame-src [^;]*127\.0\.0\.1:7000/.test(cspValue));
check('Storefront CSP forbids framing by other origins', /frame-ancestors 'none'/.test(cspValue));

// F-42: client-side identifiers must be CSPRNG-derived, and server-provided strings must be
// escaped before they reach innerHTML.
check('Idempotency keys are generated from a CSPRNG (not Math.random)', /generateOpaqueId\('ik'\)/.test(purchaseServiceSource) && /crypto\.getRandomValues\(new Uint8Array\(16\)\)/.test(purchaseServiceSource) && !/ik_\$\{Date\.now\(\)\}/.test(purchaseServiceSource));
check('Storefront notifications escape server-provided text', /escapeHtml\(message\)/.test(purchaseServiceSource));
check('Payment modal escapes order fields before interpolating markup', /escapeHtml\(order\.orderId\)/.test(readSource('src/components/PaymentModal.js')));
// ---------------------------------------------------------------------------------------
// F-43: checkout must reconcile the persisted session BEFORE it can mint another one, and only
// a definitively dead attempt may authorise a replacement (compare-and-swap).
// ---------------------------------------------------------------------------------------
const checkoutBlock = extractBlock(orderControllerSource, 'async createCheckout(');
const orderServiceSource = readSource('backend/src/services/orderService.ts');
const sessionMintIndex = checkoutBlock.indexOf('const session = await adapter.createPaymentSession(');
const reconciliationIndex = checkoutBlock.indexOf('reconcilePersistedSession(');
check(
  'Checkout reconciles the persisted session before any new session is created',
  reconciliationIndex !== -1 && sessionMintIndex !== -1 && reconciliationIndex < sessionMintIndex
);
check(
  'Checkout only continues to session creation when the old attempt is superseded',
  /outcome !== 'superseded'/.test(checkoutBlock)
);
check(
  'Checkout replaces the session key by compare-and-swap, never by blind overwrite',
  /orderService\.supersedePaymentSession\(/.test(checkoutBlock)
);
check(
  'Only gateway-reported terminal statuses authorise replacing an attempt',
  /{?unpaid'?, ?'failed'?, ?'expired'?, ?'cancelled'?}?/.test(orderControllerSource) &&
    /TERMINALLY_DEAD_PAYMENT_STATUSES\.has\(verification\.status\)/.test(orderControllerSource) &&
    !/'pending'[^\n]*TERMINALLY_DEAD_PAYMENT_STATUSES/.test(orderControllerSource)
);
check(
  'A contended session binding is never advertised as payable',
  /reconciliation: 'session_binding_contended'/.test(checkoutBlock) &&
    (() => {
      const contended = extractBlock(checkoutBlock.slice(checkoutBlock.indexOf('if (!bound)')), 'if (!bound)');
      return contended.length > 0 && !/checkoutUrl/.test(contended);
    })()
);
check(
  'Supersede is a real compare-and-swap in the repository',
  /payment_session_id = \?/.test(
    extractBlock(readSource('backend/src/repositories/orderRepository.ts'), 'supersedePaymentSession(')
  )
);

// F-45: identical evidence bursts collapse; the FIRST occurrence of every distinct outcome stands.
// The evidence method spans from its declaration to the next public method.
const evidenceBlock = orderServiceSource.slice(
  orderServiceSource.indexOf('  recordPaymentEvidence('),
  orderServiceSource.indexOf('  attachPaymentSession(')
);
check(
  'Payment evidence is deduplicated inside a bounded window',
  /OrderService\.EVIDENCE_DEDUPE_WINDOW_MS/.test(evidenceBlock) &&
    /if \(orderRepository\.countRecentPaymentAttempts\(orderId, outcome, source, windowStart\) > 0\)/.test(evidenceBlock) &&
    /return;\s*\}/.test(evidenceBlock)
);
check(
  'Evidence deduplication consults the repository BEFORE inserting a row',
  evidenceBlock.length > 0 &&
    evidenceBlock.indexOf('countRecentPaymentAttempts(') !== -1 &&
    evidenceBlock.indexOf('countRecentPaymentAttempts(') < evidenceBlock.indexOf('recordPaymentAttempt(')
);

// F-44: the viewport suite must not report a commerce assertion it did not make, and must exit
// non-zero when an assertion fails.
const viewportSource = readSource('tests/viewport-test.js');
check(
  'Viewport suite probes the backend and skips (not fails) the commerce check when it is down',
  /isBackendReachable/.test(viewportSource) &&
    /\[QA 8\] Commerce Lifecycle State: SKIPPED/.test(viewportSource) &&
    /backendReachable \?/.test(viewportSource)
);
check(
  'Viewport suite exits non-zero when an assertion fails',
  /process\.exitCode = 1/.test(viewportSource) && /recordFailure\(/.test(viewportSource)
);
check(
  'Suite harness records the viewport exit code instead of asserting PASS by hand',
  /run_viewport/.test(readSource('backend/scripts/run-suites.sh')) &&
    /test:viewport/.test(readSource('backend/scripts/run-suites.sh')) &&
    !/^viewport\s+PASS/m.test(readSource('backend/scripts/run-suites.sh'))
);

// F-44 (harness half): recording per-suite exit codes is not enough if the harness itself always
// exits 0. A run in which `npm audit` failed was still reported as "SUITES-FINISHED", so any
// automation reading only the harness status would treat a red run as green.
const harnessSource = readSource('backend/scripts/run-suites.sh');
check(
  'Suite harness aggregates per-suite exit codes and fails the run when any suite failed',
  /FAILED_SUITES\+=/.test(harnessSource) && /-gt 0/.test(harnessSource) && /exit 1/.test(harnessSource)
);

// F-47: the lockfile must never resolve a dependency inside a published vulnerable range. The
// advisory database moves under our feet, so this pins the resolution rather than the manifest.
const backendLock = JSON.parse(fs.readFileSync(path.join(rootDir, 'backend', 'package-lock.json'), 'utf8'));
const bodyParserVersion =
  ((backendLock.packages || {})['node_modules/body-parser'] || {}).version || '';
const [bodyParserMajor, bodyParserMinor] = bodyParserVersion.split('.').map(Number);
check(
  `Lockfile keeps body-parser outside the GHSA-27r3-jxmh-p828 range (>=2.4.0; found ${bodyParserVersion || 'absent'})`,
  !bodyParserVersion || bodyParserMajor > 2 || (bodyParserMajor === 2 && bodyParserMinor >= 4)
);

// ---------------------------------------------------------------------------------------
// F-44 (data-integrity half): a routine backend test run must never be able to write into the
// developer database. Every suite therefore loads the isolated-environment bootstrap BEFORE any
// `../src/...` import, because config/env.ts resolves DATABASE_URL exactly once at module load.
// ---------------------------------------------------------------------------------------
const suiteSources = [
  readSource('backend/tests/backend.test.ts'),
  readSource('backend/tests/youpiAdapter.test.ts'),
  readSource('backend/tests/security.test.ts')
];
check(
  'Every backend suite loads the isolated-env bootstrap before any app/env import',
  suiteSources.every((source) => {
    const bootstrap = source.indexOf("import './testEnvSetup.js'");
    const firstAppImport = source.search(/import .*'\.\.\/src\//);
    return bootstrap !== -1 && firstAppImport !== -1 && bootstrap < firstAppImport;
  })
);
const testEnvSetupSource = readSource('backend/tests/testEnvSetup.ts');
check(
  'The test bootstrap redirects DATABASE_URL to a throwaway database it deletes first',
  /process\.env\.DATABASE_URL = testDatabasePath/.test(testEnvSetupSource) &&
    /verro_commerce\.test\.sqlite/.test(testEnvSetupSource) &&
    /fs\.rmSync\(\s*`\$\{testDatabasePath\}\$\{suffix\}`/.test(testEnvSetupSource)
);
const e2eHarnessSource = readSource('tests/e2e-commerce.test.js');
check(
  'The e2e harness spawns its backend against an isolated throwaway database',
  /verro_commerce\.e2e\.sqlite/.test(e2eHarnessSource) && /DATABASE_URL: databasePath/.test(e2eHarnessSource)
);

// F-46: the boot banner must report the resolved rail, never a hard-coded dev-safe claim.
const serverSource = readSource('backend/src/app/server.ts');
const bannerSource = readSource('backend/src/app/paymentRailBanner.ts');
check('Boot banner no longer hard-codes the mock rail', !/Inactive \/ Dev-Safe/.test(serverSource));
check(
  'Boot banner reports the resolved adapter name and production readiness',
  /describeActivePaymentRail/.test(serverSource) &&
    /adapter\.adapterName/.test(bannerSource) &&
    /adapter\.isProductionReady/.test(bannerSource)
);
check('An unresolvable production rail aborts startup (fail-closed)', /env\.isProduction\)? \{?\s*throw adapterErr/.test(bannerSource));



// ---------------------------------------------------------------------------------------
// F-44 (Phase 1): the isolation policy itself. These guards pin the SHAPE of the fix, so a
// future edit that relaxes it fails the architecture suite instead of silently reopening the
// write path into the developer database.
// ---------------------------------------------------------------------------------------
// `databaseSource` (repositories/database.ts), `harnessSource` (scripts/run-suites.sh) and
// `serveConfig` are already declared earlier in this file, so they are reused rather than
// redeclared.
const isolationPolicySource = readSource('backend/src/config/databaseIsolation.ts');
const envSource = readSource('backend/src/config/env.ts');

check(
  'The isolation policy covers all four refusal classes',
  [
    'TEST_DB_IS_LIVE_DATABASE',
    'TEST_DB_INSIDE_REPOSITORY',
    'TEST_DB_OUTSIDE_TEMPORARY_ROOT',
    'NON_TEST_DB_IS_TEMPORARY'
  ].every((code) => isolationPolicySource.includes(code))
);
check(
  'The database guard runs BEFORE the driver is constructed',
  databaseSource.indexOf('assertDatabaseTarget()') !== -1 &&
    databaseSource.indexOf('assertDatabaseTarget()') < databaseSource.indexOf('new Database(')
);
check(
  'The database default no longer resolves against process.cwd()',
  !/DATABASE_URL\s*\|\|\s*path\.resolve\(process\.cwd\(\)/.test(envSource) &&
    /path\.resolve\(BACKEND_ROOT, raw\)/.test(envSource)
);
check(
  'The test bootstrap creates its database in a per-run temporary directory',
  /mkdtempSync\(path\.join\(os\.tmpdir\(\)/.test(testEnvSetupSource) &&
    /VERRO_TEST_DB_DIR/.test(testEnvSetupSource) &&
    !/process\.cwd\(\)/.test(testEnvSetupSource)
);
check(
  'The e2e harness creates its database in a per-run temporary directory',
  /mkdtempSync\(path\.join\(os\.tmpdir\(\)/.test(e2eHarnessSource) &&
    /VERRO_TEST_DB_DIR/.test(e2eHarnessSource) &&
    !/path\.join\(BACKEND_DIR, 'verro_commerce\.e2e\.sqlite'\)/.test(e2eHarnessSource)
);
check(
  'The suite harness uses a temporary database and refuses a backend it did not start',
  /mktemp -d/.test(harnessSource) &&
    /VIEWPORT_DB="\$VIEWPORT_DB_DIR\/verro_commerce\.suite\.sqlite"/.test(harnessSource) &&
    /refusing to drive QA 8 against a backend this harness did not start/.test(harnessSource)
);
check(
  'A held write lock is waited for, not failed on (busy_timeout configured)',
  /busy_timeout = 5000/.test(databaseSource)
);
check(
  'The live-database assertion tool exists and opens the database read-only',
  fs.existsSync(path.join(rootDir, 'backend', 'scripts', 'assert-live-db-untouched.mjs')) &&
    /readonly: true/.test(readSource('backend/scripts/assert-live-db-untouched.mjs'))
);
check(
  'The static server denies the evidence directory (qa-artifacts)',
  (serveConfig.unlisted || []).some((entry) => entry.startsWith('qa-artifacts')) &&
    (serveConfig.redirects || []).some((rule) => String(rule.source).includes('qa-artifacts'))
);

// Summary
console.log('\n==================================================');
console.log(`RESULTS: ${passed.length} passed, ${errors.length} failed`);
console.log('==================================================\n');

if (errors.length > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
