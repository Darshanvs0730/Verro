/**
 * VÉRRO Commerce Backend — Security Remediation Regression Suite
 *
 * This suite pins the SECURITY contract introduced by the Phase 12 adversarial audit.
 * Every test here corresponds to a finding that was reproduced against the pre-remediation
 * baseline (tag `pre-remediation`), so a regression is reported as a failure rather than
 * being silently reintroduced.
 *
 * Findings covered:
 *   F-01/F-02  Unauthenticated multi-rail webhook settlement surface (/webhooks/sms, /webhooks/email)
 *
 * The environment bootstrap import MUST come first: it sets NODE_ENV=test, the fixture
 * opt-in flag, the fixture token and an isolated `verro_commerce.test.sqlite` database
 * before config/env.ts resolves its frozen environment.
 */

import './testEnvSetup.js';
import request from 'supertest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app/app.js';
import { webhookController } from '../src/controllers/webhookController.js';
import { orderRepository } from '../src/repositories/orderRepository.js';
import { closeDatabase, getDatabase, checkDatabaseTarget } from '../src/repositories/database.js';
import { env, resolveDatabaseTarget } from '../src/config/env.js';
import { evaluateDatabaseIsolation } from '../src/config/databaseIsolation.js';
import { setPaymentAdapter, resetPaymentAdapter } from '../src/adapters/paymentAdapterFactory.js';
import { toAmountPaise, mapGatewayEventStatus } from '../src/adapters/youpiPaymentAdapter.js';
import { OrderService } from '../src/services/orderService.js';
import { LocalPrivateStorageAdapter } from '../src/adapters/fileStorageAdapter.js';
import { OrderRecord } from '../src/models/order.js';
import { describeActivePaymentRail } from '../src/app/paymentRailBanner.js';
import type {
  PaymentSessionResult,
  PaymentVerificationResult
} from '../src/adapters/paymentGatewayAdapter.js';

const app = createApp();
const orderService = new OrderService();

/**
 * Minimal gateway stub for reconciliation tests.
 *
 * It reports a settlement ONLY for the session id the server itself persisted
 * (`sess_paid`), which is what lets the suite prove that a client-supplied reference cannot
 * steer reconciliation (F-20) and that a purchaser claim cannot settle an order (F-05).
 */
const reconciliationStub = {
  adapterName: 'security-test-stub',
  isProductionReady: false,
  async createPaymentSession(): Promise<never> {
    throw new Error('createPaymentSession is not exercised by this suite');
  },
  async verifyPayment(_orderId: string, sessionId: string) {
    return sessionId === 'sess_paid'
      ? { isPaid: true, paymentReference: 'utr_412345678901', amount: 39900, currency: 'INR', status: 'paid' as const }
      : { isPaid: false, amount: 0, currency: 'INR', status: 'unpaid' as const };
  },
  async handleWebhook(): Promise<never> {
    throw new Error('handleWebhook is not exercised by this suite');
  }
};

let passedCount = 0;
let failedCount = 0;

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

/**
 * Seed an order row directly and return both the order id and the purchaser token whose
 * SHA-256 hash was bound to the row, so authenticated paths can be exercised realistically
 * without depending on rate-limited HTTP order creation.
 */
function seedOrder(overrides: Partial<OrderRecord> = {}, plainToken?: string): {
  orderId: string;
  customerToken: string;
} {
  const unique = crypto.randomBytes(6).toString('hex');
  const timestamp = new Date().toISOString();
  const customerToken = plainToken || `cst_security_${unique}`;

  const order: OrderRecord = {
    id: `ord_verro_sec_${Date.now()}_${unique}`,
    product_id: 'vol-01',
    amount: 39900,
    currency: 'INR',
    status: 'pending',
    customer_email: null,
    payment_reference: null,
    idempotency_key: null,
    customer_token_hash: crypto.createHash('sha256').update(customerToken).digest('hex'),
    request_fingerprint: null,
    created_at: timestamp,
    updated_at: timestamp,
    paid_at: null,
    fulfilled_at: null,
    ...overrides
  };

  orderRepository.create(order);
  return { orderId: order.id, customerToken };
}

/** Count audit-log rows for a given entity + action. */
function countAuditRows(entityId: string, action: string): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) as total FROM audit_logs WHERE entity_id = ? AND action = ?')
    .get(entityId, action) as { total: number };
  return row.total;
}

async function runTests() {
  console.log('=== VÉRRO Security Remediation Regression Suite ===\n');

  // ---------------------------------------------------------------------------------------
  // F-01 / F-02 — Unauthenticated multi-rail webhook settlement surface (REMOVED)
  //
  // Pre-fix behaviour reproduced on the baseline build: a single unauthenticated POST of a
  // free-text "bank SMS / email" body was enough to move an arbitrary pending order to
  // 'paid'. The handler parsed an attacker-chosen amount, scanned for the newest pending
  // order matching that amount (`findRecentPending`) or a fuzzy id fragment
  // (`findByReferenceSuffix`), and then called processVerifiedPayment — a full payment
  // bypass with zero cryptographic proof and zero purchaser binding.
  // ---------------------------------------------------------------------------------------

  await test('F-01: POST /api/v1/webhooks/sms is no longer routed (404, no enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/sms')
      .send({ message: 'Your a/c is credited by Rs.399 UTR 412345678901 ref VERROABC123' });

    assert.equal(res.status, 404, 'The removed SMS rail must not resolve to a handler');
    assert.equal(res.body.error, 'Resource not found.');
  });

  await test('F-02: POST /api/v1/webhooks/email is no longer routed (404, no enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/email')
      .send({ body: 'INR 399.00 credited to your account' });

    assert.equal(res.status, 404, 'The removed email rail must not resolve to a handler');
    assert.equal(res.body.error, 'Resource not found.');
  });

  await test('F-01/F-02: legacy settlement handler and order-guessing helpers are gone', async () => {
    // Defence in depth: deleting the routes alone is not enough. If the handler or its
    // "pick a pending order for me" helpers reappear, the bypass is one line away.
    assert.equal(
      typeof (webhookController as any).handleSmsOrEmailWebhook,
      'undefined',
      'handleSmsOrEmailWebhook must not exist on the controller surface'
    );
    assert.equal(
      typeof (orderRepository as any).findRecentPending,
      'undefined',
      'findRecentPending must not exist on the repository surface'
    );
    assert.equal(
      typeof (orderRepository as any).findByReferenceSuffix,
      'undefined',
      'findByReferenceSuffix must not exist on the repository surface'
    );
  });

  await test('F-01: the exact baseline-exploit payload mutates no order state', async () => {
    // Seed a pending order that the removed handler would have selected: same amount,
    // newest pending row, id fragment discoverable from the payload.
    const { orderId } = seedOrder({ amount: 39900, status: 'pending' });
    const idFragment = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();

    const exploitPayloads: unknown[] = [
      { message: 'Rs.399 credited to your account UTR 412345678901' },
      { message: `Your a/c is credited by Rs.399 ref VERRO${idFragment}` },
      `credits: INR 399.00 deposited ref VERRO${idFragment}`,
      { text: 'transferred 399.00 INR' },
      { body: 'Bank alert: credited Rs 399' }
    ];

    for (const payload of exploitPayloads) {
      const res = await request(app).post('/api/v1/webhooks/sms').send(payload as any);
      assert.equal(res.status, 404, `Exploit payload must be unreachable: ${JSON.stringify(payload)}`);
    }

    const after = orderRepository.findById(orderId);
    assert.ok(after, 'Seeded order must still exist');
    assert.equal(after!.status, 'pending', 'Order must NOT be settled by an unauthenticated rail');
    assert.equal(after!.payment_reference, null, 'No payment reference may be fabricated');
    assert.equal(after!.paid_at, null, 'No paid timestamp may be written');
    assert.equal(
      countAuditRows(orderId, 'STATUS_UPDATED'),
      0,
      'No status transition may be attempted for the order'
    );
  });

  await test('F-01/F-02: no unauthenticated rail remains anywhere under /api/v1/webhooks', async () => {
    const probes = [
      '/api/v1/webhooks/sms',
      '/api/v1/webhooks/email',
      '/api/v1/webhooks/wallet',
      '/api/v1/webhooks/sms/inbound'
    ];

    for (const path of probes) {
      const res = await request(app).post(path).send({ message: 'credited Rs 399' });
      assert.equal(res.status, 404, `${path} must not exist`);
    }
  });

  await test('F-01: the HMAC-verified gateway webhook remains the single intake surface', async () => {
    // The remediation must remove the bypass WITHOUT breaking the legitimate rail:
    // an unsigned body is still rejected before any order state is touched.
    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'SUCCESS', orderId: 'ord_verro_unsigned', amountPaise: 39900 }));

    assert.equal(res.status, 401, 'Unsigned gateway events must be rejected');
    assert.equal(
      String(res.body.error).includes('signature'),
      true,
      'Rejection must be attributed to signature verification'
    );
  });

  // ---------------------------------------------------------------------------------------
  // F-03 / F-05 / F-20 / F-22 — Purchaser-scoped settlement, server-persisted session
  // identity, and a payment reference that is evidence rather than authority.
  //
  // Pre-fix behaviour reproduced on the baseline build: POST /orders/:id/verify required no
  // credential at all, leaked payment_reference in both branches, fell back to the order id
  // as the gateway lookup key, substituted `order.amount` whenever the gateway reported a
  // falsy amount, and stamped the synthetic literal `youpi_reconciled` into the order as
  // proof of payment. POST /orders/:id/checkout likewise treated authorization as optional.
  // ---------------------------------------------------------------------------------------

  setPaymentAdapter(reconciliationStub as any);

  await test('F-03: /verify requires a purchaser token (no BOLA, no reference leak)', async () => {
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending', payment_session_id: 'sess_paid' });

    const anonymous = await request(app).post(`/api/v1/orders/${orderId}/verify`);
    assert.equal(anonymous.status, 403, 'Reconciliation without a token must be refused');
    assert.equal(anonymous.body.paymentReference, undefined, 'No payment reference may leak');

    const forged = await request(app)
      .post(`/api/v1/orders/${orderId}/verify`)
      .set('Authorization', 'Bearer cst_forged_token_that_nobody_issued');
    assert.equal(forged.status, 403, 'A forged token must be refused identically');
    assert.equal(forged.body.paymentReference, undefined, 'No payment reference may leak');

    const untouched = orderRepository.findById(orderId);
    assert.equal(untouched?.status, 'payment_pending', 'The order must remain untouched');
    assert.equal(untouched?.payment_reference, null, 'No reference may be written');

    // The rightful purchaser (and only them) gets an authoritative answer.
    const owner = await request(app)
      .post(`/api/v1/orders/${orderId}/verify`)
      .set('Authorization', `Bearer ${customerToken}`);

    assert.equal(owner.status, 200);
    assert.equal(owner.body.status, 'paid');
    assert.equal(owner.body.settled, true);
    assert.equal(orderRepository.findById(orderId)?.payment_reference, 'utr_412345678901');
  });

  await test('F-05: a client-supplied reference can never settle an order', async () => {
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending' });

    // The caller names the very reference the gateway would use for a genuinely paid session.
    // With no server-persisted session, this must settle nothing at all.
    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/verify`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ paymentReference: 'utr_412345678901' });

    assert.equal(res.status, 200);
    assert.equal(res.body.settled, false, 'A claimed reference must never settle an order');
    assert.equal(res.body.status, 'payment_pending');

    const unchanged = orderRepository.findById(orderId);
    assert.equal(unchanged?.status, 'payment_pending');
    assert.equal(unchanged?.payment_reference, null, 'A claim must never become proof of payment');

    // The claim IS recorded — as unverified evidence, which is what makes review possible.
    const attempts = orderRepository.listPaymentAttempts(orderId);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].source, 'purchaser_claim');
    assert.equal(attempts[0].outcome, 'unverified_claim_recorded');
  });

  await test('F-20: settlement is driven only by the server-persisted session id', async () => {
    // An order whose persisted session the gateway does not recognise must NOT settle, even
    // when the caller names a session that IS paid.
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending', payment_session_id: 'sess_unknown' });

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/verify`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ paymentSessionId: 'sess_paid', paymentReference: 'utr_412345678901' });

    assert.equal(res.status, 200);
    assert.equal(res.body.settled, false, 'A client-supplied session id must be ignored');
    assert.equal(orderRepository.findById(orderId)?.status, 'payment_pending');

    // The persisted session id is authoritative and is never overwritten by a later caller.
    assert.equal(orderRepository.attachPaymentSession(orderId, 'sess_paid'), false);
    assert.equal(orderRepository.findById(orderId)?.payment_session_id, 'sess_unknown');
  });

  await test('F-22: /checkout refuses anonymous callers', async () => {
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending' });

    const anonymous = await request(app).post(`/api/v1/orders/${orderId}/checkout`);
    assert.equal(anonymous.status, 403, 'Session creation must be purchaser-scoped');
    assert.equal(anonymous.body.sessionId, undefined, 'No session may be issued anonymously');

    const forged = await request(app)
      .post(`/api/v1/orders/${orderId}/checkout`)
      .set('X-Customer-Token', 'cst_forged');
    assert.equal(forged.status, 403, 'A forged token must be refused identically');
    assert.equal(forged.body.sessionId, undefined);

    // The rightful purchaser still reaches the gateway rail. The stub deliberately cannot
    // create sessions, so failing loudly is the correct outcome — never a fabricated session.
    const owner = await request(app)
      .post(`/api/v1/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${customerToken}`);
    assert.ok(owner.status >= 400, 'A gateway that cannot issue a session must not be faked');
    assert.equal(owner.body.sessionId, undefined, 'Never fabricate a session id');
    assert.equal(orderRepository.findById(orderId)?.payment_session_id, null, 'Nothing may be persisted');
  });

  await test('F-24: amount parsing is deterministic and refuses ambiguity', async () => {
    // Explicit paise are authoritative.
    assert.equal(toAmountPaise(39900, undefined), 39900);
    assert.equal(toAmountPaise('39900', undefined), 39900);
    // Decimal currency strings follow the documented gateway contract.
    assert.equal(toAmountPaise(undefined, '399.00'), 39900);
    assert.equal(toAmountPaise(undefined, '399'), 39900);
    assert.equal(toAmountPaise(undefined, 399.5), 39950);
    // The retired `amount > 1000 ? amount : amount * 100` guess is gone: a bare number is read
    // as a decimal currency amount, so paise sent as a bare integer can no longer be silently
    // misinterpreted by 100x in either direction (which decided settlements before).
    assert.equal(toAmountPaise(undefined, 500), 50000);
    assert.equal(toAmountPaise(undefined, 1500), 150000);
    // Unusable input fails closed instead of being guessed at.
    assert.equal(toAmountPaise(undefined, '399.999'), null);
    assert.equal(toAmountPaise(undefined, 'abc'), null);
    assert.equal(toAmountPaise(0, undefined), null);
    assert.equal(toAmountPaise(-100, undefined), null);
    assert.equal(toAmountPaise(undefined, undefined), null);
  });

  await test('F-25: gateway outcomes map to four distinct states', async () => {
    assert.equal(mapGatewayEventStatus('SUCCESS'), 'paid');
    assert.equal(mapGatewayEventStatus('paid'), 'paid');
    assert.equal(mapGatewayEventStatus('FAILED'), 'failed');
    assert.equal(mapGatewayEventStatus('DECLINED'), 'failed');
    assert.equal(mapGatewayEventStatus('EXPIRED'), 'expired');
    assert.equal(mapGatewayEventStatus('CANCELLED'), 'cancelled');
    // An unknown status is NOT coerced into a decline.
    assert.equal(mapGatewayEventStatus('SOMETHING_NEW'), null);
  });

  await test('F-25: a mismatch never writes "failed" and never stamps a reference', async () => {
    const { orderId } = seedOrder({ status: 'payment_pending', amount: 39900 });

    let threw = false;
    try {
      await orderService.processVerifiedPayment(orderId, 'utr_412345678901', 100, 'INR');
    } catch {
      threw = true;
    }

    assert.equal(threw, true, 'An unverifiable assertion must be rejected');
    const after = orderRepository.findById(orderId);
    assert.equal(after?.status, 'payment_pending', 'A mismatch must leave the order payable, not failed');
    assert.equal(after?.payment_reference, null, 'No unverified reference may be stamped');
    assert.equal(
      orderRepository.listPaymentAttempts(orderId).slice(-1)[0].outcome,
      'rejected_amount_mismatch'
    );

    // A missing amount is refused too: the old `verification.amount || order.amount` fallback
    // let a zero/falsy amount silently inherit the order's own price.
    let amountThrew = false;
    try {
      await orderService.processVerifiedPayment(orderId, 'utr_412345678901', 0, 'INR');
    } catch {
      amountThrew = true;
    }
    assert.equal(amountThrew, true);
    assert.equal(orderRepository.findById(orderId)?.status, 'payment_pending');

    // Same for a currency mismatch — the order stays payable.
    let currencyThrew = false;
    try {
      await orderService.processVerifiedPayment(orderId, 'utr_412345678901', 39900, 'USD');
    } catch {
      currencyThrew = true;
    }
    assert.equal(currencyThrew, true);
    assert.equal(orderRepository.findById(orderId)?.status, 'payment_pending');
  });

  await test('F-05: retired synthetic references are refused as settlement evidence', async () => {
    const { orderId } = seedOrder({ status: 'payment_pending' });

    for (const synthetic of ['youpi_reconciled', 'youpi_settlement']) {
      let threw = false;
      try {
        await orderService.processVerifiedPayment(orderId, synthetic, 39900, 'INR');
      } catch {
        threw = true;
      }
      assert.equal(threw, true, `${synthetic} must never settle an order`);
    }

    const after = orderRepository.findById(orderId);
    assert.equal(after?.status, 'payment_pending');
    assert.equal(after?.payment_reference, null);
  });

  await test('F-40: the schema migration is additive and preserves every pre-existing column', async () => {
    const columns = getDatabase().prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);
    assert.ok(columnNames.includes('payment_session_id'), 'orders.payment_session_id must exist');
    assert.ok(columnNames.includes('customer_token_hash'), 'Pre-existing columns must survive');
    assert.ok(columnNames.includes('request_fingerprint'), 'Pre-existing columns must survive');
    assert.ok(columnNames.includes('payment_reference'), 'Pre-existing columns must survive');

    const tables = getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((table) => table.name);
    assert.ok(tableNames.includes('payment_attempts'), 'payment_attempts must exist');
    assert.ok(tableNames.includes('orders'), 'Existing tables must be untouched');
  });

  // ---------------------------------------------------------------------------------------
  // F-41 — Single-use download grants + idempotent notification dispatch
  //
  // Pre-fix, a minted download URL remained replayable for its whole TTL and every
  // POST /download re-sent the access email, so a leaked URL was a reusable capability and a
  // single purchaser token could be looped to amplify outbound mail.
  // ---------------------------------------------------------------------------------------
  await test('F-41: a download grant is single-use while fresh links keep working', async () => {
    const { orderId, customerToken } = seedOrder({
      status: 'paid',
      paid_at: new Date().toISOString(),
      customer_email: 'collector@verro.test'
    });

    const authorize = async (): Promise<string> => {
      const res = await request(app)
        .post(`/api/v1/orders/${orderId}/download`)
        .set('Authorization', `Bearer ${customerToken}`);
      assert.equal(res.status, 200, 'A paid order with a valid purchaser token must authorize');
      const token = new URL(res.body.downloadUrl, 'http://localhost').searchParams.get('token');
      assert.ok(token, 'Download URL must carry a signed token');
      return token as string;
    };

    const firstToken = await authorize();
    const first = await request(app).get(`/api/v1/orders/${orderId}/download/file?token=${firstToken}`);
    assert.equal(first.status, 200, 'The first use of a grant must stream the master archive');

    const replay = await request(app).get(`/api/v1/orders/${orderId}/download/file?token=${firstToken}`);
    assert.equal(replay.status, 410, 'A replayed grant must be refused with 410 Gone');
    assert.match(replay.body.error, /already been used|fresh download link/);
    assert.equal(replay.text.includes('VÉRRO Vol. 01 Private Digital Master Archive'), false, 'A replay must not stream any master bytes');

    // Replay must be a one-shot refusal, not a permanent denial of sale: a new link works.
    const secondToken = await authorize();
    const second = await request(app).get(`/api/v1/orders/${orderId}/download/file?token=${secondToken}`);
    assert.equal(second.status, 200, 'A freshly minted link must settle the same order again');

    const grant = getDatabase()
      .prepare('SELECT COUNT(*) as total FROM download_grants WHERE order_id = ? AND consumed_at IS NOT NULL')
      .get(orderId) as { total: number };
    assert.equal(grant.total, 2, 'Each consumed grant must be recorded exactly once');
  });

  await test('F-41: a token with no grant row is refused rather than replayed', async () => {
    const { orderId, customerToken } = seedOrder({
      status: 'paid',
      paid_at: new Date().toISOString()
    });

    // Structurally valid token minted straight from the storage adapter: exactly what a
    // pre-migration (legacy) or otherwise unregistered link looks like to the server.
    const adapter = new LocalPrivateStorageAdapter();
    const unregistered = await adapter.generateDownloadAccess(
      orderId,
      'vol-01-master.zip',
      crypto.createHash('sha256').update(customerToken).digest('hex')
    );

    const res = await request(app).get(`/api/v1/orders/${orderId}/download/file?token=${unregistered.token}`);
    assert.equal(res.status, 410, 'An unregistered token must not be accepted as a live capability');
    assert.match(res.body.error, /fresh download link/);
  });

  await test('F-41: download access email is dispatched at most once per order', async () => {
    const { orderId, customerToken } = seedOrder({
      status: 'paid',
      paid_at: new Date().toISOString(),
      customer_email: 'collector@verro.test'
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await request(app)
        .post(`/api/v1/orders/${orderId}/download`)
        .set('Authorization', `Bearer ${customerToken}`);
      assert.equal(res.status, 200, `Authorization attempt ${attempt + 1} must succeed`);
    }

    const dispatches = getDatabase()
      .prepare('SELECT COUNT(*) as total FROM notification_dispatches WHERE order_id = ? AND template = ?')
      .get(orderId, 'download_access') as { total: number };
    assert.equal(dispatches.total, 1, 'Repeated downloads must not re-send the access email');
  });

  // ---------------------------------------------------------------------------------------
  // F-43 — Repeated checkout minted a SECOND payable gateway session for one order
  //
  // Pre-fix, POST /api/v1/orders/:orderId/checkout called adapter.createPaymentSession(order)
  // unconditionally and (first-wins) attached whatever came back. A page refresh, retry or
  // double-submit therefore produced two live payable sessions for the same order, while
  // reconciliation (F-20) only ever reads the FIRST persisted session — so a payment made on the
  // duplicate was invisible to the storefront's own settlement path.
  //
  // The contract now: reconcile the persisted session first. A settled session is settled (never
  // replaced); an unverifiable/pending one is reused; only a DEFINITIVELY dead attempt
  // (unpaid/failed/expired/cancelled) may be superseded, via compare-and-swap.
  // ---------------------------------------------------------------------------------------
  function countingAdapter(verificationFor: (sessionId: string) => PaymentVerificationResult) {
    const calls = { createPaymentSession: 0 };
    const issuedSessionId = `sess_minted_${crypto.randomBytes(4).toString('hex')}`;
    return {
      issuedSessionId,
      calls,
      adapter: {
        adapterName: 'f43-counting-stub',
        isProductionReady: false,
        async createPaymentSession(order: OrderRecord): Promise<PaymentSessionResult> {
          calls.createPaymentSession += 1;
          return {
            sessionId: issuedSessionId,
            checkoutUrl: `https://gateway.test/${issuedSessionId}`,
            amount: order.amount,
            currency: order.currency,
            mode: 'production' as const
          };
        },
        async verifyPayment(_orderId: string, sessionId: string): Promise<PaymentVerificationResult> {
          return verificationFor(sessionId);
        },
        async handleWebhook(): Promise<never> {
          throw new Error('handleWebhook is not exercised by this suite');
        }
      }
    };
  }

  const PENDING: PaymentVerificationResult = { isPaid: false, amount: 0, currency: 'INR', status: 'pending' };
  const DEAD: PaymentVerificationResult = { isPaid: false, amount: 0, currency: 'INR', status: 'unpaid' };

  await test('F-43: an unverifiable (pending) attempt is reused — checkout mints no second session', async () => {
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending', payment_session_id: 'sess_open' });
    const { adapter, calls } = countingAdapter(() => PENDING);
    setPaymentAdapter(adapter as any);

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${customerToken}`);

    assert.equal(res.status, 200);
    assert.equal(calls.createPaymentSession, 0, 'A possibly-paid session must never be replaced');
    assert.equal(res.body.sessionId, 'sess_open', 'The persisted session must be handed back');
    assert.equal(res.body.reusedSession, true);
    assert.equal(res.body.settled, false);
    assert.equal(res.body.paymentStatusUncertain, true);
    assert.equal(orderRepository.findById(orderId)?.payment_session_id, 'sess_open');

    // A transport failure is reported as unverifiable evidence, not as a dead attempt.
    assert.equal(orderRepository.listPaymentAttempts(orderId).slice(-1)[0].outcome, 'reused_open_payment_session');
  });


  resetPaymentAdapter();

  closeDatabase();

  console.log('\n==================================================');
  await test('F-43: a session the gateway reports as paid is settled, not replaced', async () => {
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending', payment_session_id: 'sess_paid' });
    const { adapter, calls } = countingAdapter((sessionId) =>
      sessionId === 'sess_paid'
        ? { isPaid: true, paymentReference: 'utr_412345678901', amount: 39900, currency: 'INR', status: 'paid' }
        : PENDING
    );
    setPaymentAdapter(adapter as any);

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${customerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.settled, true, 'A paid session must be reconciled, never re-minted');
    assert.equal(calls.createPaymentSession, 0);
    assert.equal(orderRepository.findById(orderId)?.status, 'paid');
    assert.equal(orderRepository.findById(orderId)?.payment_reference, 'utr_412345678901');
    assert.equal(orderRepository.listPaymentAttempts(orderId).slice(-1)[0].outcome, 'settled_on_reused_session');
  });

  await test('F-43: only a definitively dead attempt may be superseded, via compare-and-swap', async () => {
    const { orderId, customerToken } = seedOrder({ status: 'payment_pending', payment_session_id: 'sess_dead' });
    const { adapter, calls, issuedSessionId } = countingAdapter((sessionId) =>
      sessionId === 'sess_dead' ? DEAD : PENDING
    );
    setPaymentAdapter(adapter as any);

    const first = await request(app)
      .post(`/api/v1/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${customerToken}`);

    assert.equal(first.status, 200);
    assert.equal(calls.createPaymentSession, 1, 'Exactly one replacement session for a dead attempt');
    assert.equal(first.body.sessionId, issuedSessionId);
    assert.equal(first.body.reusedSession, false);
    assert.equal(orderRepository.findById(orderId)?.payment_session_id, issuedSessionId);

    // The dead attempt stays reviewable and the key move is audited.
    assert.ok(
      orderRepository.listPaymentAttempts(orderId).some((a) => a.outcome === 'payment_session_superseded_unpaid'),
      'The superseded attempt must remain in the evidence trail'
    );
    assert.equal(countAuditRows(orderId, 'PAYMENT_SESSION_SUPERSEDED'), 1);

    // Re-checking out again must NOT churn out yet another payable session.
    const second = await request(app)
      .post(`/api/v1/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${customerToken}`);

    assert.equal(second.status, 200);
    assert.equal(calls.createPaymentSession, 1, 'Repeated checkouts must not mint additional sessions');
  // ---------------------------------------------------------------------------------------
  // F-45 — Payment-attempt evidence amplification
  //
  // Every refused/duplicate probe wrote an unbounded evidence row, so an attacker (or a retrying
  // client) could inflate an order's evidence trail and the audit log without bound.
  // ---------------------------------------------------------------------------------------
  await test('F-45: an identical probe burst collapses to a bounded evidence trail', async () => {
    const { orderId } = seedOrder({ status: 'payment_pending' });

    for (let probe = 0; probe < 12; probe++) {
      const res = await request(app).post(`/api/v1/orders/${orderId}/verify`);
      assert.equal(res.status, 403, 'Every unauthenticated probe must still be refused');
    }

    const attempts = orderRepository.listPaymentAttempts(orderId);
    assert.equal(attempts.length, 1, `12 identical probes must collapse to 1 row (recorded ${attempts.length})`);
    assert.equal(attempts[0].outcome, 'rejected_unauthorized_reconciliation');

    // The first occurrence of a DIFFERENT outcome is still recorded: dedupe must never hide a
    // distinct security event.
    orderService.recordPaymentEvidence(orderId, 'unverified_claim_recorded', 'distinct outcome control', {
      source: 'purchaser_claim'
    });
    assert.equal(orderRepository.listPaymentAttempts(orderId).length, 2);
  });

  // ---------------------------------------------------------------------------------------
  // F-46 — The boot banner hard-coded "Inactive / Dev-Safe (mock rail)"
  // ---------------------------------------------------------------------------------------
  await test('F-46: the boot banner reports the adapter that is actually active', async () => {
    setPaymentAdapter({
      adapterName: 'YouPI-PG Sovereign Payment Gateway',
      isProductionReady: true,
      async createPaymentSession(): Promise<never> {
        throw new Error('unused');
      },
      async verifyPayment(): Promise<never> {
        throw new Error('unused');
      },
      async handleWebhook(): Promise<never> {
        throw new Error('unused');
      }
    } as any);

    const banner = describeActivePaymentRail();
    assert.match(banner, /YouPI-PG Sovereign Payment Gateway/, 'The real rail name must be printed');
    assert.match(banner, /production-ready/, 'A production-capable rail must be labelled as such');
    assert.doesNotMatch(banner, /mock rail/i, 'The hard-coded dev-safe banner text must be gone');
  });


    assert.equal(second.body.sessionId, issuedSessionId);
    assert.equal(second.body.reusedSession, true);
  });


  // ---------------------------------------------------------------------------------------
  // F-44 (Phase 1, P1-2): database isolation is fail-closed, and the decision is made BEFORE
  // the driver opens the file. These assertions pin the policy itself, so a future edit that
  // relaxes it fails here instead of in someone's developer database.
  // ---------------------------------------------------------------------------------------
  await test('F-44: a test process is refused the developer database', async () => {
    const verdict = evaluateDatabaseIsolation({
      databasePath: env.liveDatabasePath,
      nodeEnv: 'test',
      repoRoot: env.repoRoot,
      liveDatabasePath: env.liveDatabasePath
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'TEST_DB_IS_LIVE_DATABASE');
  });

  await test('F-44: a test database inside the repository is refused', async () => {
    const verdict = evaluateDatabaseIsolation({
      databasePath: `${env.backendRoot}/verro_commerce.suite.sqlite`,
      nodeEnv: 'test',
      repoRoot: env.repoRoot,
      liveDatabasePath: env.liveDatabasePath
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'TEST_DB_INSIDE_REPOSITORY');
  });

  await test('F-44: a test database under the temporary root is allowed', async () => {
    const verdict = evaluateDatabaseIsolation({
      databasePath: '/tmp/verro-test-allowed.sqlite',
      nodeEnv: 'test',
      repoRoot: env.repoRoot,
      liveDatabasePath: env.liveDatabasePath,
      temporaryRoot: '/tmp'
    });
    assert.equal(verdict.ok, true);
  });

  await test('F-44: a development process pointed at a temporary database is refused', async () => {
    const verdict = evaluateDatabaseIsolation({
      databasePath: '/tmp/verro-should-be-refused.sqlite',
      nodeEnv: 'development',
      repoRoot: env.repoRoot,
      liveDatabasePath: env.liveDatabasePath,
      temporaryRoot: '/tmp'
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'NON_TEST_DB_IS_TEMPORARY');
  });

  await test('F-44: this suite itself runs against a temporary database outside the repository', async () => {
    // The guard must ACCEPT the configuration the suite is actually using — a policy that only
    // rejects things is untested where it matters.
    assert.equal(checkDatabaseTarget().ok, true);
    assert.equal(env.databaseUrl.includes(env.repoRoot), false);
    assert.ok(env.databaseUrl.endsWith('verro_commerce.test.sqlite'));
  });

  await test('F-44: a relative DATABASE_URL resolves against the backend root, not the cwd', async () => {
    // The exact value `backend/.env` ships. Before the fix this resolved against process.cwd(),
    // so the same configuration opened two different files depending on where the process started.
    const resolved = resolveDatabaseTarget('verro_commerce.sqlite');
    assert.equal(resolved.source, 'relative-resolved');
    assert.equal(resolved.path, env.liveDatabasePath);
    assert.equal(resolveDatabaseTarget('./verro_commerce.sqlite').path, env.liveDatabasePath);
  });

  await test('F-44: the connection waits for a held write lock instead of failing instantly', async () => {
    const busyTimeout = getDatabase().pragma('busy_timeout', { simple: true });
    assert.equal(busyTimeout, 5000);
  });

  console.log(`SECURITY TEST RESULTS: ${passedCount} passed, ${failedCount} failed`);
  console.log('==================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});