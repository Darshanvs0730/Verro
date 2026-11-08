/**
 * VÉRRO Commerce Backend — Automated Test Suite
 * Tests all 11 requirements from Phase 8 specification.
 *
 * The environment bootstrap import MUST come first: it sets NODE_ENV=test, the fixture
 * opt-in flag, the fixture token and an isolated database before config/env.ts loads.
 */

import './testEnvSetup.js';
import request from 'supertest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { createApp } from '../src/app/app.js';
import { DevelopmentPaymentAdapter } from '../src/adapters/developmentPaymentAdapter.js';
import { LocalPrivateStorageAdapter } from '../src/adapters/fileStorageAdapter.js';
import { orderRepository } from '../src/repositories/orderRepository.js';
import { idempotencyRepository } from '../src/repositories/idempotencyRepository.js';
import { closeDatabase, getDatabase } from '../src/repositories/database.js';
import { createFixtureTokenGuard, default as testRoutes } from '../src/routes/testRoutes.js';
import {
  env,
  resolveTrustProxyHops,
  LEGACY_DEV_DOWNLOAD_SECRET,
  LEGACY_DEV_WEBHOOK_SIGNATURE,
  MIN_TEST_FIXTURE_TOKEN_LENGTH
} from '../src/config/env.js';
import { OrderRecord } from '../src/models/order.js';

const app = createApp();

let passedCount = 0;
let failedCount = 0;

/** Produce a byte-exact webhook body plus its correct HMAC-SHA256 signature. */
function signWebhookPayload(payload: object): { raw: string; signature: string } {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', env.webhookSecret).update(raw, 'utf8').digest('hex');
  return { raw, signature };
}

/** Mint a token exactly as the vulnerable pre-fix implementation did (public secret). */
function forgeTokenWithLegacySecret(orderId: string, filename: string, purchaserTokenHash: string): string {
  const expiresAtMs = Date.now() + 15 * 60 * 1000;
  const payload = `${orderId}:${filename}:${expiresAtMs}:${purchaserTokenHash}`;
  const hmac = crypto.createHmac('sha256', LEGACY_DEV_DOWNLOAD_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

/**
 * Seed an order row directly.
 * Used by regression tests that need a specific lifecycle state without spending the
 * HTTP order-creation budget (rate limiting is verified end-to-end in the E2E suite).
 */
function seedOrder(overrides: Partial<OrderRecord> = {}): string {
  const unique = crypto.randomBytes(6).toString('hex');
  const timestamp = new Date().toISOString();
  const order: OrderRecord = {
    id: `ord_verro_seed_${Date.now()}_${unique}`,
    product_id: 'vol-01',
    amount: 39900,
    currency: 'INR',
    status: 'pending',
    customer_email: null,
    payment_reference: null,
    idempotency_key: null,
    // A real, well-formed purchaser binding hash keeps downstream guards realistic.
    customer_token_hash: crypto.createHash('sha256').update(`cst_seed_${unique}`).digest('hex'),
    request_fingerprint: null,
    created_at: timestamp,
    updated_at: timestamp,
    paid_at: null,
    fulfilled_at: null,
    ...overrides
  };

  orderRepository.create(order);
  return order.id;
}

/** Minimal Express Response stand-in for direct guard-middleware assertions. */
function createMockResponse(): any {
  return {
    statusCode: 0,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    }
  };
}

/** Count rows in the audit log for a given entity + action. */
function countAuditRows(entityId: string, action: string, payloadLike?: string): number {
  const sql = payloadLike
    ? `SELECT COUNT(*) as total FROM audit_logs WHERE entity_id = ? AND action = ? AND payload LIKE ?`
    : `SELECT COUNT(*) as total FROM audit_logs WHERE entity_id = ? AND action = ?`;
  const params = payloadLike ? [entityId, action, payloadLike] : [entityId, action];
  const row = getDatabase().prepare(sql).get(...params) as { total: number };
  return row.total;
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ PASS: ${name}`);
    passedCount++;
  } catch (err: any) {
    console.error(`✗ FAIL: ${name}`);
    console.error(`  Error: ${err.message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('=== VÉRRO Commerce Backend Test Suite ===\n');

  // Ensure database is clean or ready
  getDatabase();

  let createdOrderId = '';
  let createdCustomerToken = '';

  // 1. Valid Product Order Creation
  await test('1. Valid product order creation', async () => {
    const res = await request(app)
      .post('/api/v1/orders/create')
      .send({ productId: 'vol-01', customerEmail: 'buyer@example.com' });

    assert.equal(res.status, 201);
    assert.ok(res.body.orderId.startsWith('ord_verro_'));
    assert.equal(res.body.productId, 'vol-01');
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.currency, 'INR');
    assert.equal(res.body.amount, 39900);
    assert.equal(res.body.formattedAmount, '₹399');
    assert.ok(res.body.customerAccessToken, 'Must issue purchaser access token');

    createdOrderId = res.body.orderId;
    createdCustomerToken = res.body.customerAccessToken;
  });

  // 2. Invalid Product
  await test('2. Invalid product rejected with 404 or 400', async () => {
    const res = await request(app)
      .post('/api/v1/orders/create')
      .send({ productId: 'nonexistent-edition-99' });

    assert.ok(res.status === 400 || res.status === 404);
    assert.ok(res.body.error.includes('Invalid or inactive product ID'));
  });

  // 3. Authoritative Server-Side Price (Client-provided price tampering ignored)
  await test('3. Authoritative server-side price enforced (client tampering ignored)', async () => {
    const res = await request(app)
      .post('/api/v1/orders/create')
      .send({
        productId: 'vol-01',
        amount: 100, // Attempted tamper to ₹1
        currency: 'USD' // Attempted tamper to USD
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.amount, 39900, 'Amount must be authoritative 39900 paise (₹399)');
    assert.equal(res.body.currency, 'INR', 'Currency must be authoritative INR');
  });

  // 4. Duplicate / Idempotent Request
  await test('4. Duplicate / idempotent request replay', async () => {
    const idempotencyKey = `test_key_${Date.now()}`;

    const res1 = await request(app)
      .post('/api/v1/orders/create')
      .set('Idempotency-Key', idempotencyKey)
      .send({ productId: 'vol-01', customerEmail: 'idempotent@example.com' });

    assert.equal(res1.status, 201);
    const orderId1 = res1.body.orderId;

    const res2 = await request(app)
      .post('/api/v1/orders/create')
      .set('Idempotency-Key', idempotencyKey)
      .send({ productId: 'vol-01', customerEmail: 'idempotent@example.com' });

    assert.equal(res2.status, 201);
    assert.equal(res2.headers['x-idempotency-replay'], 'true');
    assert.equal(res2.body.orderId, orderId1, 'Replayed order ID must match initial order');
  });

  // 5. Unpaid Order Cannot Download
  await test('5. Unpaid order cannot download (403 Forbidden)', async () => {
    // Without token: rejected 403
    const resNoToken = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/download`);
    assert.equal(resNoToken.status, 403);
    assert.ok(resNoToken.body.error.includes('denied'));

    // With valid customer token but unpaid: rejected 403
    const res = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/download`)
      .set('Authorization', `Bearer ${createdCustomerToken}`);

    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('not paid'));
  });

  // 6. Paid Order Can Enter Fulfillment Path & Stream Master
  await test('6. Paid order can enter fulfillment path & stream master archive', async () => {
    // Transition order to paid authoritatively via database update
    orderRepository.updateStatus(createdOrderId, 'paid', 'ref_test_settled', new Date().toISOString());

    // Forged/unauthorized token rejected
    const forgedRes = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/download`)
      .set('Authorization', 'Bearer cst_forged_invalid_token_xyz');
    assert.equal(forgedRes.status, 403);

    // Request download authorization with genuine customer access token
    const downloadAuthRes = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/download`)
      .set('Authorization', `Bearer ${createdCustomerToken}`);

    assert.equal(downloadAuthRes.status, 200);
    assert.equal(downloadAuthRes.body.orderId, createdOrderId);
    assert.ok(downloadAuthRes.body.downloadUrl.includes('/download/file?token='));
    assert.ok(downloadAuthRes.body.expiresAt);
    assert.equal(downloadAuthRes.body.filename, 'vol-01-master.zip');

    // Follow the download stream URL
    const streamRes = await request(app)
      .get(downloadAuthRes.body.downloadUrl);

    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers['content-type'], 'application/zip');
    assert.ok(streamRes.headers['content-disposition'].includes('vol-01-master.zip'));
    assert.ok(streamRes.text.includes('VÉRRO Vol. 01 Private Digital Master Archive'));
  });

  // 7. Invalid / forged webhook signatures rejected
  await test('7. Invalid payment event rejected by webhook (401 Unauthorized)', async () => {
    const invalidSig = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', 'invalid_signature_attempt')
      .send({
        eventId: 'evt_invalid',
        orderId: createdOrderId,
        status: 'paid'
      });

    assert.equal(invalidSig.status, 401);
    assert.ok(invalidSig.body.error.includes('Invalid or unverified cryptographic signature'));

    // The publicly documented development literal must NEVER be accepted.
    const literalSig = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', LEGACY_DEV_WEBHOOK_SIGNATURE)
      .send({
        eventId: 'evt_literal_forge',
        orderId: createdOrderId,
        status: 'paid'
      });

    assert.equal(literalSig.status, 401, 'Public dev signature literal must be rejected');

    // A correctly signed but structurally invalid (missing raw body) request is rejected.
    const rawSig = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', signWebhookPayload({ eventId: 'x' }).signature)
      .send({ eventId: 'evt_missing_order', status: 'paid' });

    assert.equal(rawSig.status, 401);
  });

  // 8. Duplicate Payment Event Ignored / Replayed
  await test('8. Duplicate payment event ignored via idempotency', async () => {
    // Create new order to test webhook fulfillment
    const newOrderRes = await request(app)
      .post('/api/v1/orders/create')
      .send({ productId: 'vol-01' });

    const newOrderId = newOrderRes.body.orderId;
    const eventId = `evt_webhook_${Date.now()}`;
    const payload = {
      eventId,
      orderId: newOrderId,
      status: 'paid',
      paymentReference: 'pay_ref_webhook_01',
      amountPaise: 39900,
      currency: 'INR'
    };
    const { raw, signature } = signWebhookPayload(payload);

    // First webhook call correctly signed over the exact raw body
    const webhookRes1 = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', signature)
      .send(raw);

    assert.equal(webhookRes1.status, 200);
    assert.equal(webhookRes1.body.received, true);
    assert.equal(webhookRes1.headers['cache-control'], 'no-store');

    // Verify order was transitioned to paid
    const orderCheck = orderRepository.findById(newOrderId);
    assert.equal(orderCheck?.status, 'paid');

    // Duplicate webhook call with same event ID and valid signature
    const webhookRes2 = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', signature)
      .send(raw);

    assert.equal(webhookRes2.status, 200);
    assert.equal(webhookRes2.body.eventId, eventId);
  });

  // 9. Unknown Order Rejected
  await test('9. Unknown order rejected (404 Not Found)', async () => {
    const getRes = await request(app).get('/api/v1/orders/ord_nonexistent_99999');
    assert.equal(getRes.status, 404);

    const downloadRes = await request(app).post('/api/v1/orders/ord_nonexistent_99999/download');
    assert.equal(downloadRes.status, 404);
  });

  // 10. Nonexistent File Rejected
  await test('10. Nonexistent file rejected safely', async () => {
    // Create temporary mock order with nonexistent product package
    const fakeOrderId = `ord_fake_missing_file_${Date.now()}`;
    const token = `cst_test_missing_file_${Date.now()}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    orderRepository.create({
      id: fakeOrderId,
      product_id: 'fake_product_missing_file',
      amount: 39900,
      currency: 'INR',
      status: 'paid',
      customer_email: null,
      payment_reference: 'ref_paid',
      idempotency_key: null,
      customer_token_hash: tokenHash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      fulfilled_at: null
    });

    const res = await request(app)
      .post(`/api/v1/orders/${fakeOrderId}/download`)
      .set('Authorization', `Bearer ${token}`);
    assert.ok(res.status === 404 || res.status === 500);
  });

  // 11. Development Payment Adapter Cannot Represent Real Settlement
  await test('11. Development payment adapter cannot represent real settlement', async () => {
    const devAdapter = new DevelopmentPaymentAdapter();
    assert.equal(devAdapter.isProductionReady, false);

    const session = await devAdapter.createPaymentSession({
      id: 'ord_test',
      product_id: 'vol-01',
      amount: 39900,
      currency: 'INR',
      status: 'pending',
      customer_email: null,
      payment_reference: null,
      idempotency_key: null,
      created_at: '',
      updated_at: '',
      paid_at: null,
      fulfilled_at: null
    });

    assert.equal(session.mode, 'development_mock');
    assert.equal(session.checkoutUrl, undefined);

    const verification = await devAdapter.verifyPayment('ord_test', 'arbitrary_token');
    assert.equal(verification.isPaid, false);
    assert.equal(verification.status, 'unpaid');
  });

  // 12. F1 regression — tokens signed with the public dev secret are rejected
  await test('12. Download token signed with the public dev secret is rejected (F1)', async () => {
    const order = orderRepository.findById(createdOrderId);
    assert.ok(order?.customer_token_hash, 'Order must expose a stored purchaser token hash');

    const forged = forgeTokenWithLegacySecret(createdOrderId, 'vol-01-master.zip', order!.customer_token_hash!);
    const res = await request(app).get(`/api/v1/orders/${createdOrderId}/download/file?token=${forged}`);

    assert.equal(res.status, 403, 'Forgery using the publicly documented dev secret must be rejected');
  });

  // 13. Tampered / cross-order token claims are rejected
  await test('13. Tampered and cross-order download tokens are rejected', async () => {
    const authRes = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/download`)
      .set('Authorization', `Bearer ${createdCustomerToken}`);
    assert.equal(authRes.status, 200);

    const token = new URL(authRes.body.downloadUrl, 'http://localhost').searchParams.get('token')!;
    const parts = Buffer.from(token, 'base64url').toString('utf8').split(':');
    assert.equal(parts.length, 5, 'New token format must bind orderId:filename:expiry:purchaserHash:hmac');

    // Create a second, independent paid order to attempt a cross-order claim swap.
    const otherOrderId = `ord_verro_tamper_${Date.now()}`;
    const otherPurchaserToken = `cst_tamper_${Date.now()}`;
    orderRepository.create({
      id: otherOrderId,
      product_id: 'vol-01',
      amount: 39900,
      currency: 'INR',
      status: 'paid',
      customer_email: null,
      payment_reference: 'ref_tamper',
      idempotency_key: null,
      customer_token_hash: crypto.createHash('sha256').update(otherPurchaserToken).digest('hex'),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      fulfilled_at: null
    });

    const crossOrderToken = Buffer.from(
      `${otherOrderId}:${parts[1]}:${parts[2]}:${parts[3]}:${parts[4]}`
    ).toString('base64url');
    const crossRes = await request(app).get(`/api/v1/orders/${otherOrderId}/download/file?token=${crossOrderToken}`);
    assert.equal(crossRes.status, 403, 'Claim-swapped token must fail signature verification');

    const filenameSwapToken = Buffer.from(
      `${parts[0]}:evil-master.zip:${parts[2]}:${parts[3]}:${parts[4]}`
    ).toString('base64url');
    const filenameRes = await request(app).get(`/api/v1/orders/${createdOrderId}/download/file?token=${filenameSwapToken}`);
    assert.equal(filenameRes.status, 403, 'Filename-swapped token must be rejected');

    // A valid token for this order must not authenticate against another order.
    const crossAuth = await request(app)
      .post(`/api/v1/orders/${otherOrderId}/download`)
      .set('Authorization', `Bearer ${createdCustomerToken}`);
    assert.equal(crossAuth.status, 403, 'Another order\'s purchaser token must not authorize this order');
  });

  // 14. Storage allowlist blocks non-catalog packages and traversal
  await test('14. Storage allowlist blocks non-catalog packages and traversal', async () => {
    const adapter = new LocalPrivateStorageAdapter();

    assert.equal(adapter.isAllowedPackage('vol-01-master.zip'), true);
    assert.equal(adapter.isAllowedPackage('evil.zip'), false);
    assert.equal(adapter.isAllowedPackage('../../etc/passwd'), false);
    assert.throws(() => adapter.getFilePath('evil.zip'), /not an allowlisted delivery package/);
    assert.throws(() => adapter.getFilePath('../../../etc/passwd'), /not an allowlisted delivery package/);
  });

  // 15. Non-string productId and prototype-pollution keys rejected
  await test('15. Non-string productId and prototype-pollution keys rejected', async () => {
    const arrayRes = await request(app).post('/api/v1/orders/create').send({ productId: ['vol-01'] });
    assert.equal(arrayRes.status, 400);

    const objectRes = await request(app).post('/api/v1/orders/create').send({ productId: { id: 'vol-01' } });
    assert.equal(objectRes.status, 400);

    const protoRes = await request(app)
      .post('/api/v1/orders/create')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"amount":1},"productId":"vol-01"}');
    assert.equal(protoRes.status, 400, 'Forbidden prototype key must be rejected');
  });

  // 16. Token-bearing and master-stream responses are never cacheable
  await test('16. Sensitive responses are marked Cache-Control: no-store (F18)', async () => {
    const createRes = await request(app)
      .post('/api/v1/orders/create')
      .send({ productId: 'vol-01' });
    assert.equal(createRes.headers['cache-control'], 'no-store', 'Order creation carries a bearer token');

    const authRes = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/download`)
      .set('Authorization', `Bearer ${createdCustomerToken}`);
    assert.equal(authRes.headers['cache-control'], 'no-store', 'Download grant carries a signed token');

    const token = new URL(authRes.body.downloadUrl, 'http://localhost').searchParams.get('token')!;
    const streamRes = await request(app).get(`/api/v1/orders/${createdOrderId}/download/file?token=${token}`);
    assert.equal(streamRes.status, 200);
    assert.ok(
      /no-store/.test(streamRes.headers['cache-control'] || ''),
      'Private master stream must not be publicly cacheable'
    );
  });

  // 17. Fixture surface requires the shared fixture token (F-1)
  await test('17. Test fixture surface requires the shared fixture token (F-1)', async () => {
    const orderId = seedOrder();

    const noToken = await request(app).post(`/api/v1/test/orders/${orderId}/simulate-paid`);
    assert.equal(noToken.status, 403, 'Missing fixture token must be rejected');
    assert.ok(noToken.body.error.includes('test fixture authorization token'));
    assert.equal(noToken.headers['cache-control'], 'no-store');

    const wrongToken = await request(app)
      .post(`/api/v1/test/orders/${orderId}/simulate-paid`)
      .set('X-Test-Fixture-Token', `${String(env.testFixtureToken)}_tampered`);
    assert.equal(wrongToken.status, 403, 'A wrong fixture token must be rejected');

    assert.equal(orderRepository.findById(orderId)?.status, 'pending', 'Rejected attempts must not settle the order');
  });

  // 18. Framework fingerprint suppressed
  await test('18. Framework fingerprint header is suppressed', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  // 19. Webhook signature is bound to the exact raw body
  await test('19. Webhook signature bound to exact raw body (tamper rejected)', async () => {
    const orderRes = await request(app).post('/api/v1/orders/create').send({ productId: 'vol-01' });
    const orderId = orderRes.body.orderId;
    const eventId = `evt_tamper_${Date.now()}`;

    const signed = signWebhookPayload({
      eventId,
      orderId,
      status: 'paid',
      amount: 39900,
      currency: 'INR'
    });

    // Reuse the valid signature but send a different (tampered) body.
    const tamperedBody = JSON.stringify({
      eventId: `${eventId}_mutated`,
      orderId,
      status: 'paid',
      amount: 1,
      currency: 'INR'
    });

    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', signed.signature)
      .send(tamperedBody);

    assert.equal(res.status, 401);
    assert.equal(orderRepository.findById(orderId)?.status, 'pending', 'Tampered webhook must not settle the order');
  });

  // 20. Fixture token guard fails closed for unconfigured/weak tokens (F-1)
  await test('20. Fixture guard fails closed for unconfigured or weak tokens (F-1)', async () => {
    let nextCalls = 0;
    const next = (): void => {
      nextCalls++;
    };

    const configuredTokenLength = String(env.testFixtureToken).length;

    for (const weakToken of [undefined, '', 'short', 'a'.repeat(MIN_TEST_FIXTURE_TOKEN_LENGTH - 1)]) {
      const guard = createFixtureTokenGuard(weakToken);
      const res = createMockResponse();
      guard(
        { headers: { 'x-test-fixture-token': 'a'.repeat(configuredTokenLength) } } as any,
        res,
        next as any
      );
      assert.equal(res.statusCode, 404, 'A missing/weak configured token must behave as an absent surface');
    }

    const guard = createFixtureTokenGuard(String(env.testFixtureToken));

    const accepted = createMockResponse();
    guard({ headers: { 'x-test-fixture-token': String(env.testFixtureToken) } } as any, accepted, next as any);
    assert.equal(nextCalls, 1, 'The correct token must pass the guard');
    assert.equal(accepted.statusCode, 0, 'The guard must not write a status when it passes');

    const wrongTokens: unknown[] = [
      'a'.repeat(configuredTokenLength), // same length, different bytes
      'b'.repeat(600), // above the accepted length bound
      ['x', 'y'], // array-valued header
      ''
    ];
    for (const provided of wrongTokens) {
      const denied = createMockResponse();
      guard({ headers: { 'x-test-fixture-token': provided } } as any, denied, next as any);
      assert.equal(denied.statusCode, 403, 'Wrong fixture tokens must be denied');
      assert.ok(String(denied.payload.error).includes('test fixture authorization token'));
      assert.equal(denied.headers['Cache-Control'], 'no-store');
    }
    assert.equal(nextCalls, 1, 'Only the single correct token may pass');
  });

  // 21. Fixture router repeats the environment gate (F-1 defence in depth)
  await test('21. Fixture surface stays invisible when the opt-in gate is off (F-1)', async () => {
    const isolatedApp = express();
    isolatedApp.use('/api/v1/test', testRoutes);

    const originalFlag = env.testRoutesEnabled;
    try {
      env.testRoutesEnabled = false;
      const res = await request(isolatedApp)
        .post('/api/v1/test/orders/ord_any/simulate-paid')
        .set('X-Test-Fixture-Token', String(env.testFixtureToken));

      assert.equal(res.status, 404, 'Disabled fixture surface must look like an unknown route');
      assert.ok(String(res.body.error).includes('Resource not found'));
    } finally {
      env.testRoutesEnabled = originalFlag;
    }
  });

  // 22. Fixture surface settles only with the correct token (F-1)
  await test('22. Fixture surface settles an order only with the correct token (F-1)', async () => {
    const orderId = seedOrder();

    const res = await request(app)
      .post(`/api/v1/test/orders/${orderId}/simulate-paid`)
      .set('X-Test-Fixture-Token', String(env.testFixtureToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.simulated, true);
    assert.equal(res.body.status, 'paid');
    assert.equal(orderRepository.findById(orderId)?.status, 'paid');
  });

  // 23. Malformed webhook event ids are rejected and never share a replay bucket (F-2)
  await test('23. Malformed/absent webhook eventId is rejected without a shared bucket (F-2)', async () => {
    const orderId = seedOrder();

    const deliver = (payload: object) => {
      const signed = signWebhookPayload(payload);
      return request(app)
        .post('/api/v1/webhooks/payment')
        .set('Content-Type', 'application/json')
        .set('X-VERRO-Signature', signed.signature)
        .send(signed.raw);
    };

    for (const malformedId of ['', 'has space', 'bad/id', 'x'.repeat(129)]) {
      const res = await deliver({ eventId: malformedId, orderId, status: 'paid', amount: 39900, currency: 'INR' });
      assert.ok(
        res.status === 400 || res.status === 401,
        `Malformed eventId must never be accepted (got ${res.status})`
      );
      assert.equal(res.body.received, undefined, 'A rejected event must not be acknowledged');
    }

    // A payload with no eventId at all is not a verified event.
    const missingRes = await deliver({ orderId, status: 'paid', amount: 39900, currency: 'INR' });
    assert.equal(missingRes.status, 401);

    // The former constant fallback bucket must not exist and the order must stay pending.
    assert.equal(idempotencyRepository.get(`webhook_evt_${env.nodeEnv}_untrusted_event_id`), null);
    assert.equal(orderRepository.findById(orderId)?.status, 'pending');
  });

  // 24. Distinct event ids can never collapse into one replay bucket (F-2)
  await test('24. Distinct event ids remain independent, including across orders (F-2)', async () => {
    const firstOrderId = seedOrder();
    const secondOrderId = seedOrder();
    const sharedEventId = `evt_shared_${Date.now()}`;

    const deliver = (eventId: string, orderId: string) => {
      // Hardened contract: paise are stated explicitly (`amountPaise`) and a paid event must
      // name the payment it asserts, so the parser never has to guess either one.
      const signed = signWebhookPayload({
        eventId,
        orderId,
        status: 'paid',
        paymentReference: `utr_${Date.now()}`,
        amountPaise: 39900,
        currency: 'INR'
      });
      return request(app)
        .post('/api/v1/webhooks/payment')
        .set('Content-Type', 'application/json')
        .set('X-VERRO-Signature', signed.signature)
        .send(signed.raw);
    };

    const first = await deliver(sharedEventId, firstOrderId);
    assert.equal(first.status, 200);
    assert.equal(first.body.eventId, sharedEventId);
    assert.equal(first.body.applied, true);

    // Same event id, different order: must NOT be answered from the first order's record.
    const second = await deliver(sharedEventId, secondOrderId);
    assert.equal(second.status, 200, 'A reused event id for a different order must still be processed');
    assert.equal(second.body.orderId, secondOrderId);
    assert.equal(orderRepository.findById(secondOrderId)?.status, 'paid', 'The second order must be settled');

    // Re-delivering the first event is idempotent and never touches the other order.
    const replayForFirst = await deliver(sharedEventId, firstOrderId);
    assert.equal(replayForFirst.status, 200);
    assert.equal(replayForFirst.body.orderId, firstOrderId);
    assert.equal(orderRepository.findById(firstOrderId)?.status, 'paid');
  });

  // 25. Idempotency keys cannot be squatted with a different payload (F-3)
  await test('25. Idempotency-Key reuse with a different payload is refused (F-3)', async () => {
    const key = `ik_squat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const originalPayload = { productId: 'vol-01', customerEmail: 'squat-original@example.com' };

    const original = await request(app).post('/api/v1/orders/create').set('Idempotency-Key', key).send(originalPayload);
    assert.equal(original.status, 201);
    const originalOrderId = original.body.orderId;
    assert.ok(original.body.customerAccessToken, 'The genuine creator receives the bearer token once');

    // An attacker reuses the observed key with a different buyer identity.
    const squatted = await request(app)
      .post('/api/v1/orders/create')
      .set('Idempotency-Key', key)
      .send({ productId: 'vol-01', customerEmail: 'squat-attacker@example.com' });
    assert.equal(squatted.status, 409, 'Key reuse with a different payload must conflict');
    assert.ok(String(squatted.body.error).includes('Idempotency-Key'));
    assert.equal(squatted.body.orderId, undefined, 'No foreign order data may be disclosed');

    // A key longer than the accepted bound is rejected outright.
    const tooLong = await request(app)
      .post('/api/v1/orders/create')
      .set('Idempotency-Key', 'k'.repeat(256))
      .send(originalPayload);
    assert.equal(tooLong.status, 400);

    // The legitimate retry of the original request still replays its own order.
    const retry = await request(app).post('/api/v1/orders/create').set('Idempotency-Key', key).send(originalPayload);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers['x-idempotency-replay'], 'true');
    assert.equal(retry.body.orderId, originalOrderId);
    assert.equal(retry.body.customerAccessToken, undefined, 'Replays must never re-issue bearer tokens');

    // Exactly one order may exist for the key.
    assert.equal(orderRepository.findByIdempotencyKey(key)?.id, originalOrderId);
  });

  // 26. A signed event for an unknown order is rejected without poisoning the cache (P-4)
  await test('26. Signed event for an unknown order returns 404 and is not cached (P-4)', async () => {
    const unknownOrderId = `ord_verro_unknown_${Date.now()}`;
    const eventId = `evt_unknown_${Date.now()}`;
    const signed = signWebhookPayload({
      eventId,
      orderId: unknownOrderId,
      status: 'paid',
      paymentReference: `utr_unknown_${Date.now()}`,
      amountPaise: 39900,
      currency: 'INR'
    });

    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', signed.signature)
      .send(signed.raw);

    assert.equal(res.status, 404);
    assert.ok(String(res.body.error).includes('not found'));
    assert.equal(orderRepository.findById(unknownOrderId), null);
    assert.equal(
      idempotencyRepository.get(`webhook_evt_${env.nodeEnv}_${eventId}`),
      null,
      'Unknown-order events must stay un-cached so a genuine retry can still settle later'
    );
    assert.equal(countAuditRows(unknownOrderId, 'UNKNOWN_ORDER_REJECTED'), 1, 'Rejection must be auditable');
  });

  // 27. A settled order can never be downgraded by a late failure event (P-1)
  await test('27. Settled orders are terminal and cannot be downgraded (P-1)', async () => {
    const orderId = seedOrder();
    assert.equal(orderRepository.updateStatus(orderId, 'paid', 'ref_settled', new Date().toISOString()), true);

    const eventId = `evt_late_fail_${Date.now()}`;
    const signed = signWebhookPayload({ eventId, orderId, status: 'failed', amountPaise: 39900, currency: 'INR' });
    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-VERRO-Signature', signed.signature)
      .send(signed.raw);

    assert.equal(res.status, 200, 'The authenticated event is acknowledged');
    assert.equal(res.body.applied, false, 'But a terminal (paid) order must not be modified');
    assert.equal(res.body.orderStatus, 'paid');
    assert.equal(orderRepository.findById(orderId)?.status, 'paid', 'Paid is terminal');

    // Direct repository writes are constrained by the same policy.
    assert.equal(orderRepository.updateStatus(orderId, 'failed', 'late_signal'), false);
    assert.equal(orderRepository.findById(orderId)?.status, 'paid');
    assert.ok(countAuditRows(orderId, 'STATUS_TRANSITION_REJECTED') >= 1, 'Refusals must be audited');
  });

  // 28. Illegal transitions are refused at the single write choke point (P-1)
  await test('28. Order status policy refuses illegal transitions at the write choke point (P-1)', async () => {
    const cancelledId = seedOrder({ status: 'cancelled' });
    assert.equal(orderRepository.updateStatus(cancelledId, 'failed', 'nope'), false);
    assert.equal(orderRepository.findById(cancelledId)?.status, 'cancelled');

    const paidId = seedOrder({ status: 'paid' });
    assert.equal(orderRepository.updateStatus(paidId, 'cancelled'), false);
    assert.equal(orderRepository.findById(paidId)?.status, 'paid');

    // A settlement that arrives after a soft decline is still honoured (money moved).
    const failedId = seedOrder({ status: 'failed' });
    assert.equal(
      orderRepository.updateStatus(failedId, 'paid', 'ref_late_capture', new Date().toISOString()),
      true
    );
    assert.equal(orderRepository.findById(failedId)?.status, 'paid');

    const pendingId = seedOrder();
    assert.equal(orderRepository.updateStatus(pendingId, 'paid', 'ref_ok', new Date().toISOString()), true);
    assert.equal(
      orderRepository.updateStatus(pendingId, 'paid', 'ref_ok'),
      true,
      'Re-applying the same status is an idempotent no-op'
    );

    assert.equal(orderRepository.updateStatus(`ord_missing_${Date.now()}`, 'paid'), false, 'Unknown orders are not writable');
    assert.ok(countAuditRows(cancelledId, 'STATUS_TRANSITION_REJECTED') >= 1);
  });

  // 29. Trusted-proxy posture is explicit and opt-in (G-1)
  await test('29. Trust proxy is opt-in, hop-counted and never boolean (G-1)', async () => {
    assert.equal(env.trustProxyHops, 0, 'Default posture must be "trust no proxy"');
    assert.equal(app.get('trust proxy'), false, 'X-Forwarded-For must never be trusted by default');
    assert.notEqual(app.get('trust proxy'), true, 'Blanket proxy trust is forbidden');

    assert.equal(resolveTrustProxyHops(undefined), 0);
    assert.equal(resolveTrustProxyHops(''), 0);
    assert.equal(resolveTrustProxyHops('true'), 0, 'The literal "true" must fail closed');
    assert.equal(resolveTrustProxyHops('false'), 0);
    assert.equal(resolveTrustProxyHops('abc'), 0);
    assert.equal(resolveTrustProxyHops('-1'), 0);
    assert.equal(resolveTrustProxyHops('99'), 0, 'Hop counts above the bound fail closed');
    assert.equal(resolveTrustProxyHops('1'), 1);
    assert.equal(resolveTrustProxyHops('2'), 2);

    // The configured hop count is exactly what reaches Express.
    const originalHops = env.trustProxyHops;
    try {
      env.trustProxyHops = 2;
      assert.equal(createApp().get('trust proxy'), 2);
    } finally {
      env.trustProxyHops = originalHops;
    }
  });

  // 30. Expired replay records are treated as absent and purged (P-5)
  await test('30. Expired idempotency records expire and are purged (P-5)', async () => {
    assert.ok(env.idempotencyTtlMinutes > 0, 'Retention must be enabled for this test');

    const key = `ik_retention_${Date.now()}`;
    idempotencyRepository.save(key, 200, JSON.stringify({ ok: true }), 'fingerprint-under-test');

    const stored = idempotencyRepository.get(key);
    assert.ok(stored, 'A fresh record must be readable');
    assert.equal(stored?.requestFingerprint, 'fingerprint-under-test');

    const staleIso = new Date(Date.now() - (env.idempotencyTtlMinutes + 60) * 60 * 1000).toISOString();
    getDatabase().prepare('UPDATE idempotency_records SET created_at = ? WHERE key = ?').run(staleIso, key);

    assert.equal(idempotencyRepository.get(key), null, 'Expired records must never be replayed');

    const purged = idempotencyRepository.purgeExpired();
    assert.ok(purged >= 1, 'The boot-time purge must delete expired rows');

    const remaining = getDatabase()
      .prepare('SELECT COUNT(*) as total FROM idempotency_records WHERE key = ?')
      .get(key) as { total: number };
    assert.equal(remaining.total, 0, 'Purged rows must be physically removed');
  });

  // 31. Concurrent duplicate webhook deliveries settle the order exactly once
  await test('31. Concurrent duplicate webhook deliveries settle exactly once (concurrency)', async () => {
    const orderId = seedOrder();
    const eventId = `evt_concurrent_${Date.now()}`;
    const signed = signWebhookPayload({
      eventId,
      orderId,
      status: 'paid',
      paymentReference: `utr_concurrent_${Date.now()}`,
      amountPaise: 39900,
      currency: 'INR'
    });

    const deliver = () =>
      request(app)
        .post('/api/v1/webhooks/payment')
        .set('Content-Type', 'application/json')
        .set('X-VERRO-Signature', signed.signature)
        .send(signed.raw);

    const responses = await Promise.all(Array.from({ length: 6 }, deliver));
    for (const res of responses) {
      assert.equal(res.status, 200, 'Every duplicate delivery must receive a deterministic acknowledgement');
      assert.equal(res.body.orderId, orderId);
    }

    assert.equal(orderRepository.findById(orderId)?.status, 'paid');
    assert.equal(
      countAuditRows(orderId, 'STATUS_UPDATED', '%"status":"paid"%'),
      1,
      'Exactly one paid transition may be recorded'
    );
  });

  // 32. Concurrent duplicate order creations with one key yield exactly one order
  await test('32. Concurrent duplicate order creations yield exactly one order (concurrency)', async () => {
    const key = `ik_concurrent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = { productId: 'vol-01', customerEmail: 'concurrent@example.com' };

    const create = () => request(app).post('/api/v1/orders/create').set('Idempotency-Key', key).send(payload);

    const responses = await Promise.all(Array.from({ length: 4 }, create));
    for (const res of responses) {
      assert.equal(res.status, 201, 'Concurrent duplicates must never surface a server error');
      assert.ok(res.body.orderId, 'Every response must reference the same order');
    }

    const orderIds = new Set(responses.map((res) => res.body.orderId));
    assert.equal(orderIds.size, 1, 'Exactly one order may be created for the key');

    const rowCount = getDatabase()
      .prepare('SELECT COUNT(*) as total FROM orders WHERE idempotency_key = ?')
      .get(key) as { total: number };
    assert.equal(rowCount.total, 1, 'Exactly one order row may exist for the key');
  });

  closeDatabase();

  console.log('\n==================================================');
  console.log(`BACKEND TEST RESULTS: ${passedCount} passed, ${failedCount} failed`);
  console.log('==================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
