/**
 * VÉRRO Phase 9 — End-to-End Commerce & Security Verification Suite
 *
 * Validates:
 * 1. Storefront ↔ Backend connection (http://127.0.0.1:4000)
 * 2. Complete 15-step non-payment commerce lifecycle
 * 3. Strict security boundary: purchaser access token enforcement
 * 4. Zero client price authority
 * 5. Private master isolation from static web root
 * 6. Edge cases: tampering, enumeration, unauthorized access, token expiration
 * 7. Hardening regressions: F-1 fixture-token gate, F-2 malformed webhook event ids,
 *    F-3 idempotency-key squatting, P-4 unknown-order webhooks
 *
 * SELF-MANAGED HARNESS (F-1):
 * The settlement fixture is fail-closed and only exists when NODE_ENV=test,
 * ENABLE_TEST_ROUTES=true and a strong TEST_FIXTURE_TOKEN are ALL present. This suite
 * therefore starts its own backend with those values plus an ephemeral webhook secret
 * (and the static storefront when it is not already listening), then tears them down.
 *
 *   Run with:  node tests/e2e-commerce.test.js    (or: npm run test:e2e)
 *
 * If a backend is already running on port 4000, either stop it or export the same
 * TEST_FIXTURE_TOKEN it was started with so the harness can reuse it.
 */

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');

const BACKEND_URL = 'http://127.0.0.1:4000';
const STOREFRONT_URL = 'http://localhost:4173/';

/**
 * F-1: fixture-route authorization token.
 * A fresh random value is generated per run and handed to the backend this harness
 * starts, so no usable literal ever lives in source control. Set TEST_FIXTURE_TOKEN to
 * reuse an already-running backend that was started with the same value.
 */
const TEST_FIXTURE_TOKEN = process.env.TEST_FIXTURE_TOKEN || `e2e_${crypto.randomBytes(24).toString('hex')}`;

/**
 * The harness also starts the backend with a known webhook secret so the signed-callback
 * surfaces (F-2 malformed event ids, P-4 unknown orders) can be exercised over real HTTP.
 */
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

const childProcesses = [];

/**
 * Ports this harness actually claimed for the servers it spawned. Only these are force-released
 * during teardown, so a backend/storefront the operator started themselves is never killed.
 */
const ownedPorts = new Set();

/** Best-effort HTTP probe used for readiness polling. */
async function isReachable(url, timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become reachable at ${url} within ${timeoutMs}ms`);
}

function spawnChild(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group: the backend is launched through the tsx loader, which spawns an inner
    // child of its own, so signalling the direct child alone can leave the real server bound to
    // the port and break the next run.
    detached: true
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${options.label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${options.label}] ${chunk}`));
  childProcesses.push(child);
  return child;
}

/** Signal a whole detached process group, tolerating an already-dead group. */
function signalProcessGroup(pid, signal) {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Resolve true when the child has exited, or false once the grace period lapses. */
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Last-resort release of a port this harness claimed, in case a grandchild survived its group. */
function releaseOwnedPorts() {
  for (const port of ownedPorts) {
    let pids = [];
    try {
      pids = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);
    } catch {
      // No listener on this port: nothing to release.
    }
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Deterministic teardown. Every child is terminated as a group (SIGTERM, then SIGKILL) and we
 * await its exit before returning, because the stdout/stderr pipes keep the event loop alive and
 * a merely-signalled `tsx` child can outlive `process.exit()` and hold port 4000.
 */
async function stopChildProcesses() {
  await Promise.all(
    childProcesses.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const pid = child.pid;
      signalProcessGroup(pid, 'SIGTERM');
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited.
      }
      if (await waitForExit(child, 5000)) return;
      signalProcessGroup(pid, 'SIGKILL');
      try {
        child.kill('SIGKILL');
      } catch {
        // Already exited.
      }
      await waitForExit(child, 2000);
    })
  );
  releaseOwnedPorts();
}

process.on('SIGINT', async () => {
  await stopChildProcesses();
  process.exit(130);
});
process.on('SIGTERM', async () => {
  await stopChildProcesses();
  process.exit(143);
});
/**
 * Last-resort synchronous safety net for an unexpected exit path (`exit` cannot await, so the
 * groups are hard-killed and any port this harness claimed is released).
 */
process.on('exit', () => {
  for (const child of childProcesses) {
    if (child.exitCode === null && child.signalCode === null) signalProcessGroup(child.pid, 'SIGKILL');
  }
  releaseOwnedPorts();
});

/**
 * Start the backend the suite exercises.
 *
 * F-1 requires NODE_ENV=test + ENABLE_TEST_ROUTES=true + a strong TEST_FIXTURE_TOKEN for
 * the settlement fixture to exist at all, so the harness supplies all three itself and
 * uses a dedicated throwaway database.
 */
async function ensureBackend() {
  if (await isReachable(`${BACKEND_URL}/health`)) {
    if (process.env.TEST_FIXTURE_TOKEN) {
      console.log('[harness] Reusing the already-running backend with TEST_FIXTURE_TOKEN from the environment.\n');
      return;
    }
    throw new Error(
      `A backend is already listening on ${BACKEND_URL}. The fixture route is token-guarded, so a ` +
        `pre-existing process cannot be reused unless its TEST_FIXTURE_TOKEN is exported to this ` +
        `harness. Stop it (or export TEST_FIXTURE_TOKEN) and re-run the suite.`
    );
  }

  const databasePath = path.join(BACKEND_DIR, 'verro_commerce.e2e.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }

  spawnChild(path.join(BACKEND_DIR, 'node_modules', '.bin', 'tsx'), ['src/app/server.ts'], {
    cwd: BACKEND_DIR,
    label: 'backend',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '4000',
      HOST: '127.0.0.1',
      DATABASE_URL: databasePath,
      ENABLE_TEST_ROUTES: 'true',
      TEST_FIXTURE_TOKEN,
      WEBHOOK_SECRET,
      // The suite issues well over the per-IP thresholds; the limiter itself is verified
      // by the unit suite, not by abusing this harness.
      RATE_LIMIT_TEST_BYPASS: 'true'
    }
  });
  ownedPorts.add(4000);

  await waitForHttp(`${BACKEND_URL}/health`, 45000, 'Backend');
}

/** Start the static storefront (same command as `npm run dev`) when it is not running. */
async function ensureStorefront() {
  if (await isReachable(STOREFRONT_URL)) return;

  spawnChild('npx', ['-y', 'serve', '.', '-l', '4173'], {
    cwd: ROOT_DIR,
    label: 'storefront',
    env: process.env
  });
  ownedPorts.add(4173);

  await waitForHttp(STOREFRONT_URL, 90000, 'Storefront');
}

/**
 * Deliver a correctly signed payment webhook (HMAC-SHA256 over the exact raw bytes),
 * exactly as the development payment rail would.
 */
async function postSignedWebhook(payload) {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');

  return fetch(`${BACKEND_URL}/api/v1/webhooks/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VERRO-Signature': signature
    },
    body: raw
  });
}

let passedCount = 0;
let failedCount = 0;

async function test(stepNumber, description, fn) {
  try {
    await fn();
    console.log(`✓ PASS [Step ${stepNumber}]: ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`✗ FAIL [Step ${stepNumber}]: ${description}`);
    console.error(`  Error: ${err.message}`);
    failedCount++;
    throw err;
  }
}

async function runE2ESuite() {
  console.log('==================================================');
  console.log('VÉRRO Phase 9 E2E Commerce & Security Test Suite');
  console.log('==================================================\n');

  // F-1 harness: the fixture route is token-guarded, so this suite starts its own backend
  // with NODE_ENV=test + ENABLE_TEST_ROUTES=true + an ephemeral TEST_FIXTURE_TOKEN, and
  // starts the static storefront when it is not already running.
  await ensureBackend();
  await ensureStorefront();

  // Step 1: Verify backend is running
  await test(1, 'Backend is running and operational', async () => {
    const res = await fetch(`${BACKEND_URL}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'operational');
    assert.equal(body.service, 'verro-commerce-backend');
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let capturedCreateRequest = null;
  let capturedCreateResponse = null;

  // Intercept network requests to verify protocol contract
  page.on('request', req => {
    if (req.url().includes('/api/v1/orders/create') && req.method() === 'POST') {
      capturedCreateRequest = {
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postDataJSON()
      };
    }
  });

  page.on('response', async res => {
    if (res.url().includes('/api/v1/orders/create') && res.request().method() === 'POST') {
      capturedCreateResponse = {
        status: res.status(),
        body: await res.json()
      };
    }
  });

  // Step 2: Open storefront
  await test(2, 'Open VÉRRO storefront in headless browser', async () => {
    await page.goto(STOREFRONT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const title = await page.title();
    assert.ok(title.includes('VÉRRO'), `Title must include VÉRRO, got: "${title}"`);
  });

  // Step 3: Click Acquire Vol. 01 CTA button
  await test(3, 'Click "Acquire Vol. 01" CTA button', async () => {
    // Find the CTA button
    const ctaBtn = page.locator('button:has-text("ACQUIRE VOL. 01"), button:has-text("GET VOL. 01")').first();
    await ctaBtn.waitFor({ state: 'visible' });

    // Click the CTA button to initiate order creation
    const responsePromise = page.waitForResponse(res => res.url().includes('/api/v1/orders/create'), { timeout: 10000 });
    await ctaBtn.click();
    await responsePromise;
    await page.waitForTimeout(500);
  });

  // Step 4: Verify POST /api/v1/orders/create occurs
  await test(4, 'POST /orders/create occurs on centralized service', async () => {
    assert.ok(capturedCreateRequest, 'POST /orders/create request must be intercepted');
    assert.equal(capturedCreateRequest.method, 'POST');
    assert.ok(capturedCreateRequest.headers['idempotency-key'], 'Must supply Idempotency-Key header');
  });

  // Step 5: Verify productId is vol-01 and no client price is sent
  await test(5, 'Verify productId is "vol-01" with zero client price authority', async () => {
    assert.equal(capturedCreateRequest.postData.productId, 'vol-01');
    assert.equal(capturedCreateRequest.postData.price, undefined, 'Client must not send price');
    assert.equal(capturedCreateRequest.postData.amount, undefined, 'Client must not send amount');
  });

  // Step 6: Verify backend determines ₹399 (39900 paise, INR)
  await test(6, 'Backend authoritatively sets price to ₹399 (39900 paise)', async () => {
    assert.ok(capturedCreateResponse);
    assert.equal(capturedCreateResponse.status, 201);
    assert.equal(capturedCreateResponse.body.amount, 39900);
    assert.equal(capturedCreateResponse.body.formattedAmount, '₹399');
    assert.equal(capturedCreateResponse.body.currency, 'INR');
  });

  // Step 7: Receive real orderId & purchaser customerAccessToken
  let createdOrderId = '';
  let customerAccessToken = '';
  await test(7, 'Receive real orderId and purchaser access token from backend', async () => {
    createdOrderId = capturedCreateResponse.body.orderId;
    customerAccessToken = capturedCreateResponse.body.customerAccessToken;

    assert.ok(createdOrderId.startsWith('ord_verro_'), `Invalid orderId format: ${createdOrderId}`);
    assert.ok(customerAccessToken.startsWith('cst_'), `Invalid customerAccessToken format: ${customerAccessToken}`);
    assert.equal(capturedCreateResponse.body.status, 'pending');
  });

  // Step 8: UI enters payment-pending state
  await test(8, 'UI enters payment-pending state and updates CTA label', async () => {
    const ctaText = await page.evaluate(() => {
      const btn = document.querySelector('button[onclick*="purchaseProduct"]');
      return btn ? btn.innerText.trim() : '';
    });

    assert.ok(ctaText.includes('PAYMENT PENDING'), `CTA button must show PAYMENT PENDING, got: "${ctaText}"`);

    // Verify archival toast was rendered
    const toastText = await page.evaluate(() => {
      const toast = document.getElementById('verro-commerce-toast');
      return toast ? toast.innerText.trim() : '';
    });
    assert.ok(toastText.includes('PAYMENT PENDING'), `Toast must indicate PAYMENT PENDING, got: "${toastText}"`);
    assert.ok(toastText.toLowerCase().includes(createdOrderId.toLowerCase()), `Toast must reference real order ID: "${toastText}"`);
  });

  // Step 9: Verify no fake payment success appears
  await test(9, 'Verify no fake payment success or simulated checkout appears', async () => {
    const pageHtml = await page.content();
    assert.ok(!pageHtml.includes('Payment Successful'), 'Must not claim payment successful');
    assert.ok(!pageHtml.includes('Payment Complete'), 'Must not claim payment complete');
    assert.ok(!pageHtml.includes('Fake Checkout'), 'Must not contain fake checkout');
  });

  // Step 10: Verify unpaid order cannot download (403 Forbidden)
  await test(10, 'Verify unpaid order cannot download (403 Forbidden)', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customerAccessToken}`
      }
    });

    assert.equal(res.status, 403, 'Unpaid order download must return HTTP 403');
    const body = await res.json();
    assert.ok(body.error.includes('not paid'), `Error message must state order is not paid: "${body.error}"`);
  });

  // Step 11: Verify unauthorized order access is rejected
  await test(11, 'Verify unauthorized order access is rejected (boundary audit)', async () => {
    // 1. Download request without customer access token
    const resNoToken = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(resNoToken.status, 403, 'Request without token must be rejected');

    // 2. Download request with forged token
    const resForged = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer cst_forged_invalid_attacker_token'
      }
    });
    assert.equal(resForged.status, 403, 'Request with forged token must be rejected');

    // 3. Status inspection without token must redact customer email/payment references
    const resPublicStatus = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}`);
    assert.equal(resPublicStatus.status, 200);
    const publicBody = await resPublicStatus.json();
    assert.equal(publicBody.customerEmail, undefined, 'PII must be redacted for unauthenticated calls');
    assert.equal(publicBody.paymentReference, undefined, 'Payment references must be redacted');
  });

  // Step 12: Use the token-guarded development fixture to mark the test order paid (F-1)
  await test(12, 'Use token-guarded test fixture to simulate authoritative server payment', async () => {
    const fixtureUrl = `${BACKEND_URL}/api/v1/test/orders/${createdOrderId}/simulate-paid`;

    // F-1: unauthenticated and wrongly-authenticated calls must be refused outright.
    const unauthenticated = await fetch(fixtureUrl, { method: 'POST' });
    assert.equal(unauthenticated.status, 403, 'Fixture calls without the shared token must be refused');

    const forged = await fetch(fixtureUrl, {
      method: 'POST',
      headers: { 'X-Test-Fixture-Token': `${TEST_FIXTURE_TOKEN}_forged` }
    });
    assert.equal(forged.status, 403, 'Fixture calls with a wrong token must be refused');

    const stillPending = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}`);
    assert.equal((await stillPending.json()).status, 'pending', 'Refused fixture calls must not settle the order');

    const res = await fetch(fixtureUrl, {
      method: 'POST',
      headers: { 'X-Test-Fixture-Token': TEST_FIXTURE_TOKEN }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'paid');
    assert.equal(body.simulated, true);

    // Verify order is now authoritatively paid in database
    const verifyRes = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}`);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.status, 'paid');
  });

  // Step 13: Verify authorized paid order can request fulfillment
  let downloadUrl = '';
  let downloadFilename = '';
  await test(13, 'Verify authorized paid order can request fulfillment', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/${createdOrderId}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customerAccessToken}`
      }
    });

    assert.equal(res.status, 200, 'Authorized paid order must return HTTP 200');
    const body = await res.json();
    assert.equal(body.orderId, createdOrderId);
    assert.ok(body.downloadUrl.includes('/download/file?token='));
    assert.ok(body.expiresAt);
    assert.equal(body.filename, 'vol-01-master.zip');

    downloadUrl = body.downloadUrl;
    downloadFilename = body.filename;
  });

  // Step 14: Verify temporary download mechanism streams master file
  await test(14, 'Verify temporary download mechanism streams master archive', async () => {
    const streamRes = await fetch(`${BACKEND_URL}${downloadUrl}`);
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get('content-type'), 'application/zip');
    assert.ok(streamRes.headers.get('content-disposition').includes(downloadFilename));

    const content = await streamRes.text();
    assert.ok(content.includes('VÉRRO Vol. 01 Private Digital Master Archive'), 'Archive stream must deliver private master');
  });

  // Step 15: Verify private master is NOT publicly reachable
  await test(15, 'Verify private master archive is NOT publicly accessible via static web root', async () => {
    const forbiddenPublicUrls = [
      `${STOREFRONT_URL}public/vol-01-master.zip`,
      `${STOREFRONT_URL}public/images/vol-01-master.zip`,
      `${STOREFRONT_URL}static/vol-01-master.zip`,
      `${STOREFRONT_URL}vol-01-master.zip`
    ];

    for (const url of forbiddenPublicUrls) {
      const res = await fetch(url);
      assert.equal(res.status, 404, `Public URL must return 404: ${url}`);
    }

    // Direct backend storage request through static server must be blocked (302 redirect or 404)
    const backendStorageRes = await fetch(`${STOREFRONT_URL}backend/storage/private_masters/vol-01-master.zip`, { redirect: 'manual' });
    assert.ok(backendStorageRes.status === 302 || backendStorageRes.status === 404, 'Direct storage path must not return 200');
    assert.notEqual(backendStorageRes.headers.get('content-type'), 'application/zip', 'Must never yield application/zip via static server');
  });

  console.log('\n--------------------------------------------------');
  console.log('SECURITY & ADVERSARIAL ATTACK TEST SUITE');
  console.log('--------------------------------------------------\n');

  // Security Test 1: Client price tampering
  await test('SEC-1', 'Client price tampering ignored (catalog remains authoritative)', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: 'vol-01',
        amount: 100, // Attacker tries to set ₹1
        currency: 'USD' // Attacker tries to set USD
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.amount, 39900, 'Tampered amount must be overridden to 39900');
    assert.equal(body.currency, 'INR', 'Tampered currency must be overridden to INR');
  });

  // Security Test 2: Forged paid status during order creation
  await test('SEC-2', 'Forged status="paid" during order creation ignored', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: 'vol-01',
        status: 'paid' // Attacker attempts to mark order paid on creation
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'pending', 'Order status must remain pending');
  });

  // Security Test 3: Invalid product ID
  await test('SEC-3', 'Invalid product ID rejected (HTTP 400)', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'invalid_volume_999' })
    });
    assert.equal(res.status, 400);
  });

  // Security Test 4: Random order ID enumeration
  await test('SEC-4', 'Random order ID enumeration safely returns HTTP 404', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/ord_random_enumeration_attempt_99`);
    assert.equal(res.status, 404);
  });

  // Security Test 5: Malformed download token
  await test('SEC-5', 'Malformed download token rejected with HTTP 403', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/any/download/file?token=malformed_payload`);
    assert.equal(res.status, 403);
  });

  // Security Test 6: Expired download token
  await test('SEC-6', 'Expired download token rejected with HTTP 403', async () => {
    // Construct expired base64 token payload: orderId:file:pastTimestamp:sig
    const pastTimestamp = Date.now() - 3600000; // 1 hour ago
    const expiredPayload = Buffer.from(`ord_test:vol-01-master.zip:${pastTimestamp}:invalidsig`).toString('base64');
    const res = await fetch(`${BACKEND_URL}/api/v1/orders/any/download/file?token=${expiredPayload}`);
    assert.equal(res.status, 403);
  });

  // Security Test 7: Duplicate idempotency key replay
  await test('SEC-7', 'Idempotency key prevents duplicate charge/order creation', async () => {
    const key = `ik_e2e_test_${Date.now()}`;
    const res1 = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify({ productId: 'vol-01' })
    });
    const body1 = await res1.json();

    const res2 = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify({ productId: 'vol-01' })
    });
    const body2 = await res2.json();

    assert.equal(res2.headers.get('x-idempotency-replay'), 'true');
    assert.equal(body1.orderId, body2.orderId, 'Replayed orderId must match');
  });

  // Security Test 8: Idempotency-Key squatting with a different payload (F-3)
  await test('SEC-8', 'Idempotency key reuse with a different payload is refused (409)', async () => {
    const key = `ik_e2e_squat_${Date.now()}`;

    const first = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ productId: 'vol-01', customerEmail: 'e2e-original@example.com' })
    });
    assert.equal(first.status, 201, 'The first claim on a key must succeed');

    const squatted = await fetch(`${BACKEND_URL}/api/v1/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ productId: 'vol-01', customerEmail: 'e2e-attacker@example.com' })
    });
    assert.equal(squatted.status, 409, 'A reused key with a different payload must conflict');

    const squattedBody = await squatted.json();
    assert.equal(squattedBody.orderId, undefined, 'No foreign order data may be disclosed');
  });

  // Security Test 9: Signed webhook carrying a malformed event id (F-2)
  await test('SEC-9', 'Signed webhook with a malformed eventId is rejected (F-2)', async () => {
    const res = await postSignedWebhook({
      eventId: 'bad event id',
      orderId: 'ord_verro_any',
      status: 'paid',
      amount: 39900,
      currency: 'INR'
    });

    assert.ok(res.status === 400 || res.status === 401, `Malformed eventId must never be accepted (got ${res.status})`);
    const body = await res.json();
    assert.equal(body.received, undefined, 'A rejected event must not be acknowledged');
  });

  // Security Test 10: Signed webhook referencing an unknown order (P-4)
  await test('SEC-10', 'Signed webhook for an unknown order is rejected (P-4)', async () => {
    const res = await postSignedWebhook({
      eventId: `evt_e2e_unknown_${Date.now()}`,
      orderId: `ord_verro_unknown_${Date.now()}`,
      status: 'paid',
      amount: 39900,
      currency: 'INR'
    });

    assert.equal(res.status, 404, 'Unknown-order settlements must fail loudly instead of being silently acknowledged');
  });

  await page.close();
  await browser.close();

  console.log('\n==================================================');
  console.log(`E2E COMMERCE RESULTS: ${passedCount} passed, ${failedCount} failed`);
  console.log('==================================================\n');

  // Deterministic teardown: the child stdout/stderr pipes hold the event loop open, so the
  // harness must stop the backend/storefront it started (as process groups, awaiting exit) and
  // exit explicitly. Servers it merely reused were never added to ownedPorts and are untouched.
  await stopChildProcesses();
  process.exit(failedCount > 0 ? 1 : 0);
}

runE2ESuite().catch(err => {
  console.error('\nE2E Suite Terminated with Error:', err);
  process.exit(1);
});
