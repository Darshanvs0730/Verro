/**
 * VÉRRO Commerce Backend — YouPI-PG Integration & Security Verification Suite
 *
 * Validates:
 * 1. YouPiPaymentAdapter session initiation (POST /api/v1/payments contract)
 * 2. YouPiPaymentAdapter settlement verification (GET /api/v1/payments/:id contract)
 * 3. Inbound YouPI-PG webhook verification with HMAC-SHA256 (X-Gateway-Signature header: sha256=...)
 * 4. Rejection of tampered signatures, tampered payloads, and legacy dev literals
 * 5. Full lifecycle settlement via YouPI-PG webhook delivery into order state machine
 * 6. Authoritative reconciliation endpoint (POST /api/v1/orders/:orderId/verify)
 * 7. Checkout session retrieval endpoint (POST /api/v1/orders/:orderId/checkout)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { createApp } from '../src/app/app.js';
import { YouPiPaymentAdapter } from '../src/adapters/youpiPaymentAdapter.js';
import { setPaymentAdapter, resetPaymentAdapter } from '../src/adapters/paymentAdapterFactory.js';
import { orderRepository } from '../src/repositories/orderRepository.js';
import { OrderRecord } from '../src/models/order.js';
import { env, LEGACY_DEV_WEBHOOK_SIGNATURE } from '../src/config/env.js';

// Setup isolated test webhook secret and mock YouPI server
const TEST_WEBHOOK_SECRET = 'youpi_test_webhook_secret_32_characters_minimum_len';
const TEST_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

test('YouPI-PG Payment Gateway Integration Suite', async (t) => {
  let mockYouPiServer: http.Server;
  let mockPort: number;
  let youpiAdapter: YouPiPaymentAdapter;
  const recordedRequests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: any }> = [];

  // Start ephemeral Mock YouPI Gateway Server
  await new Promise<void>((resolve) => {
    mockYouPiServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let parsedBody = null;
        try {
          parsedBody = raw ? JSON.parse(raw) : null;
        } catch {}

        recordedRequests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body: parsedBody
        });

        // 1. POST /api/v1/payments — Create payment session
        if (req.method === 'POST' && req.url === '/api/v1/payments') {
          const paymentId = 'c7942127-14e3-469a-9e4a-9359a16f903a';
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              paymentId,
              orderId: parsedBody?.orderId,
              amount: parsedBody?.amount,
              amountPaise: parsedBody?.amount ? String(Math.round(parseFloat(parsedBody.amount) * 100)) : '39900',
              currency: 'INR',
              status: 'INITIATED',
              checkoutUrl: `http://localhost:7000/checkout/${paymentId}`
            })
          );
          return;
        }

        // 2. GET /api/v1/payments/:id — Status inquiry
        if (req.method === 'GET' && req.url?.startsWith('/api/v1/payments/')) {
          const id = req.url.replace('/api/v1/payments/', '');
          if (id === 'paid_youpi_session') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                paymentId: id,
                orderId: 'ord_youpi_test_reconcile',
                amount: '399.00',
                amountPaise: 39900,
                currency: 'INR',
                status: 'SUCCESS',
                method: 'UPI',
                completedAt: new Date().toISOString()
              })
            );
            return;
          }

          if (id === 'failed_youpi_session') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                paymentId: id,
                amount: '399.00',
                amountPaise: 39900,
                currency: 'INR',
                status: 'FAILED',
                method: 'UPI'
              })
            );
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              paymentId: id,
              amount: '399.00',
              amountPaise: 39900,
              currency: 'INR',
              status: 'ACTIVE'
            })
          );
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });
    });

    mockYouPiServer.listen(0, '127.0.0.1', () => {
      const address = mockYouPiServer.address() as any;
      mockPort = address.port;
      resolve();
    });
  });

  youpiAdapter = new YouPiPaymentAdapter({
    apiUrl: `http://127.0.0.1:${mockPort}`,
    portalUrl: 'http://localhost:7000',
    merchantId: TEST_MERCHANT_ID,
    webhookSecret: TEST_WEBHOOK_SECRET,
    returnUrl: 'http://localhost:4173/#order-success'
  });

  setPaymentAdapter(youpiAdapter);
  const app = createApp();

  t.after(() => {
    resetPaymentAdapter();
    mockYouPiServer.close();
  });

  // Test 1: createPaymentSession creates authentic YouPI session
  await t.test('1. createPaymentSession calls YouPI-PG POST /api/v1/payments and returns checkoutUrl', async () => {
    const dummyOrder: OrderRecord = {
      id: 'ord_verro_youpi_test_01',
      product_id: 'vol-01',
      amount: 39900, // ₹399.00 in paise
      currency: 'INR',
      status: 'pending',
      customer_email: 'collector@example.com',
      payment_reference: null,
      idempotency_key: 'ik_youpi_test_01',
      customer_token_hash: 'hash',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: null,
      fulfilled_at: null
    };

    const session = await youpiAdapter.createPaymentSession(dummyOrder);

    assert.equal(session.sessionId, 'c7942127-14e3-469a-9e4a-9359a16f903a');
    assert.equal(session.checkoutUrl, 'http://localhost:7000/checkout/c7942127-14e3-469a-9e4a-9359a16f903a');
    assert.equal(session.amount, 39900);
    assert.equal(session.currency, 'INR');
    assert.equal(session.mode, 'production');

    // Verify outbound request sent to YouPI
    const lastReq = recordedRequests[recordedRequests.length - 1];
    assert.equal(lastReq.method, 'POST');
    assert.equal(lastReq.url, '/api/v1/payments');
    assert.equal(lastReq.headers['x-merchant-id'], TEST_MERCHANT_ID);
    assert.equal(lastReq.headers['idempotency-key'], 'ik_youpi_test_01');
    assert.equal(lastReq.body.orderId, 'ord_verro_youpi_test_01');
    assert.equal(lastReq.body.amount, '399.00'); // Formatted Rupee string
  });

  // Test 2: verifyPayment correctly maps YouPI outcomes
  await t.test('2. verifyPayment maps YouPI SUCCESS to isPaid=true and FAILED to isPaid=false', async () => {
    const paidResult = await youpiAdapter.verifyPayment('ord_1', 'paid_youpi_session');
    assert.equal(paidResult.isPaid, true);
    assert.equal(paidResult.status, 'paid');
    assert.equal(paidResult.amount, 39900);

    const failedResult = await youpiAdapter.verifyPayment('ord_2', 'failed_youpi_session');
    assert.equal(failedResult.isPaid, false);
    assert.equal(failedResult.status, 'failed');

    const pendingResult = await youpiAdapter.verifyPayment('ord_3', 'active_youpi_session');
    assert.equal(pendingResult.isPaid, false);
    assert.equal(pendingResult.status, 'pending');
  });

  // Test 3: handleWebhook with valid YouPI HMAC signature
  await t.test('3. handleWebhook validates official YouPI X-Gateway-Signature (sha256=...) header', async () => {
    const rawPayload = JSON.stringify({
      event: 'SUCCESS',
      paymentId: 'c7942127-14e3-469a-9e4a-9359a16f903a',
      orderId: 'ord_verro_webhook_01',
      amount: '399.00',
      amountPaise: 39900,
      currency: 'INR',
      method: 'UPI',
      utr: '123456789012',
      completedAt: new Date().toISOString()
    });

    const signature = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawPayload).digest('hex');

    const result = await youpiAdapter.handleWebhook(rawPayload, `sha256=${signature}`);
    assert.equal(result.isValid, true);
    assert.equal(result.status, 'paid');
    assert.equal(result.orderId, 'ord_verro_webhook_01');
    assert.equal(result.eventId, 'c7942127-14e3-469a-9e4a-9359a16f903a');
    assert.equal(result.amount, 39900);
    assert.equal(result.paymentReference, '123456789012');
  });

  // Test 4: handleWebhook rejects forged or tampered signatures
  await t.test('4. handleWebhook rejects forged or tampered signatures', async () => {
    const rawPayload = JSON.stringify({
      event: 'SUCCESS',
      paymentId: 'c7942127-14e3-469a-9e4a-9359a16f903a',
      orderId: 'ord_verro_webhook_02'
    });

    // Wrong secret signature
    const badSig = crypto.createHmac('sha256', 'wrong_secret_key_32_chars_minimum').update(rawPayload).digest('hex');
    const resBad = await youpiAdapter.handleWebhook(rawPayload, `sha256=${badSig}`);
    assert.equal(resBad.isValid, false);

    // Missing signature header
    const resNone = await youpiAdapter.handleWebhook(rawPayload, undefined);
    assert.equal(resNone.isValid, false);

    // Legacy dev literal
    const resLegacy = await youpiAdapter.handleWebhook(rawPayload, LEGACY_DEV_WEBHOOK_SIGNATURE);
    assert.equal(resLegacy.isValid, false);
  });

  // Test 5: End-to-End order creation and webhook settlement
  await t.test('5. End-to-End: POST /api/v1/orders/create returns YouPI checkoutUrl and webhook settles order', async () => {
    // 1. Create order through Express API
    const createRes = await request(app)
      .post('/api/v1/orders/create')
      .send({ productId: 'vol-01', customerEmail: 'collector@atelier.art' });

    assert.equal(createRes.status, 201);
    const orderId = createRes.body.orderId;
    const customerToken = createRes.body.customerAccessToken;

    assert.ok(orderId.startsWith('ord_verro_'));
    assert.ok(createRes.body.checkoutUrl.includes('/checkout/c7942127-14e3-469a-9e4a-9359a16f903a'));
    assert.equal(createRes.body.paymentSession?.mode, 'production');

    // 2. Order is initially pending
    const statusBefore = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    assert.equal(statusBefore.body.status, 'pending');

    // 3. Webhook arrives from YouPI-PG with SUCCESS event
    const webhookPayload = JSON.stringify({
      event: 'SUCCESS',
      paymentId: `youpi_pay_${Date.now()}`,
      orderId,
      amount: '399.00',
      amountPaise: 39900,
      currency: 'INR',
      method: 'UPI',
      utr: '987654321098'
    });

    const sig = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(webhookPayload).digest('hex');

    const hookRes = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-Gateway-Signature', `sha256=${sig}`)
      .send(webhookPayload);

    assert.equal(hookRes.status, 200);
    assert.equal(hookRes.body.received, true);
    assert.equal(hookRes.body.status, 'paid');

    // 4. Order is now authoritatively settled as 'paid'
    const statusAfter = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    assert.equal(statusAfter.body.status, 'paid');
    assert.equal(statusAfter.body.paymentReference, '987654321098');
  });

  // Test 6: POST /api/v1/orders/:orderId/checkout endpoint
  await t.test('6. POST /api/v1/orders/:orderId/checkout returns payment session for pending order', async () => {
    const orderId = `ord_verro_chk_${Date.now()}`;
    const dummy: OrderRecord = {
      id: orderId,
      product_id: 'vol-01',
      amount: 39900,
      currency: 'INR',
      status: 'pending',
      customer_email: 'buyer@example.com',
      payment_reference: null,
      idempotency_key: null,
      customer_token_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: null,
      fulfilled_at: null
    };
    orderRepository.create(dummy);

    const res = await request(app).post(`/api/v1/orders/${orderId}/checkout`);
    assert.equal(res.status, 200);
    assert.equal(res.body.orderId, orderId);
    assert.ok(res.body.checkoutUrl.includes('checkout/c7942127-14e3-469a-9e4a-9359a16f903a'));
  });

  // Test 7: POST /api/v1/orders/:orderId/verify endpoint
  await t.test('7. POST /api/v1/orders/:orderId/verify reconciles payment with YouPI server', async () => {
    const orderId = `ord_verro_rec_${Date.now()}`;
    const dummy: OrderRecord = {
      id: orderId,
      product_id: 'vol-01',
      amount: 39900,
      currency: 'INR',
      status: 'pending',
      customer_email: 'reconcile@example.com',
      payment_reference: 'paid_youpi_session',
      idempotency_key: null,
      customer_token_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: null,
      fulfilled_at: null
    };
    orderRepository.create(dummy);

    const verifyRes = await request(app).post(`/api/v1/orders/${orderId}/verify`);
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.status, 'paid');

    const confirmed = orderRepository.findById(orderId);
    assert.equal(confirmed?.status, 'paid');
  });
});
