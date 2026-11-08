/**
 * VÉRRO Commerce Backend — Express Application Setup
 */

import express, { Express, Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import { env, verifyRuntimeSecrets } from '../config/env.js';
import orderRoutes from '../routes/orderRoutes.js';
import webhookRoutes from '../routes/webhookRoutes.js';
import testRoutes from '../routes/testRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

export function createApp(webhookRawParser?: RequestHandler): Express {
  const app = express();

  // Do not advertise the server framework
  app.disable('x-powered-by');

  // G-1 — Trusted proxy posture.
  // Only an explicit hop count is ever configured. `trust proxy = true` is deliberately
  // NOT supported: it would make req.ip (and therefore every rate-limit bucket and
  // brute-force bound) attacker-controlled through a spoofed X-Forwarded-For header.
  if (env.trustProxyHops > 0) {
    app.set('trust proxy', env.trustProxyHops);
  }

  // Controlled CORS — violations are answered with 403, never an unhandled 500
  const allowedOrigins = [
    env.corsOrigin,
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4000',
    'http://127.0.0.1:4000'
  ];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server, health probes)
      if (!origin) return callback(null, true);

      if (env.isProduction) {
        if (origin === env.corsOrigin) {
          return callback(null, true);
        }
        return callback(null, false);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Deny without throwing so the failure surfaces as a controlled 403 response
      return callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Idempotency-Key',
      'X-Customer-Token',
      'X-VERRO-Signature',
      'X-Gateway-Signature',
      'X-Gateway-Delivery-Id',
      'X-Gateway-Event',
      'X-Gateway-Timestamp',
      'X-Merchant-Id',
      'X-Merchant-Key',
      'X-Test-Fixture-Token'
    ]
  }));

  // Baseline Security Headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (env.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    next();
  });

  // Strict Request Body Size Limits.
  // The webhook path is EXCLUDED so its raw bytes remain available for HMAC verification.
  const jsonParser = express.json({ limit: '100kb' });
  app.use((req: Request, res: Response, next) => {
    if (req.path.startsWith('/api/v1/webhooks')) {
      return next();
    }
    return jsonParser(req, res, next);
  });

  // Health & Service Metadata Check.
  // F-47: the response carries liveness metadata ONLY. It used to include a `secretPosture` array
  // (configured / ephemeral / too-short / missing-in-production per secret name), which handed any
  // unauthenticated caller a configuration oracle — e.g. "this deployment signs webhooks with an
  // auto-generated key" — with no benefit to a load balancer. Operators get that posture from the
  // boot log (`verifyRuntimeSecrets`), which is where it belongs.
  app.get('/health', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'operational',
      service: 'verro-commerce-backend',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString()
    });
  });

  // API Routes
  app.use('/api/v1/orders', orderRoutes);

  // Webhooks must receive the EXACT raw bytes for HMAC verification.
  // express.raw() is injected for testability (supertest cannot always replay a
  // pre-serialized body signature), defaulting to a 100kb utf-8 buffer.
  const rawParser = webhookRawParser || express.raw({ type: () => true, limit: '100kb' });
  app.use('/api/v1/webhooks', rawParser, webhookRoutes);

  // Test Fixtures — INVERTED ALLOWLIST (F-1).
  // env.testRoutesEnabled is true only when NODE_ENV === "test", ENABLE_TEST_ROUTES=true
  // and a strong TEST_FIXTURE_TOKEN are ALL present. Default posture is "not mounted",
  // and the router itself adds a timing-safe token guard plus a second environment check.
  if (env.testRoutesEnabled) {
    app.use('/api/v1/test', testRoutes);
  }

  // 404 for unknown API surface (no route enumeration)
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: 'Resource not found.' });
  });

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}

/** Boot-time assertion used by the server entrypoint. */
export function assertRuntimeSecrets(): void {
  verifyRuntimeSecrets();
}
