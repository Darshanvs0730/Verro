/**
 * VÉRRO Commerce Backend — Environment Configuration
 * Validates and exposes environment variables.
 *
 * SECURITY POSTURE (red-team remediation R1.1):
 * - Production is FAIL-CLOSED: missing/weak/legacy secrets abort startup.
 * - Development/test NEVER fall back to a public literal secret; if no secret is
 *   supplied an ephemeral per-process random secret is generated so tokens minted
 *   with publicly-known development constants can never be accepted.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';

dotenv.config();

/** Publicly documented development constants — must never be trusted. */
export const LEGACY_DEV_DOWNLOAD_SECRET = 'verro_atelier_dev_secret_download_key_32_bytes';
export const LEGACY_DEV_WEBHOOK_SIGNATURE = 'TEST_DEV_WEBHOOK_SIGNATURE';

/** Minimum acceptable secret length for symmetric signing keys. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Minimum acceptable length for the test-fixture authorization token (F-1).
 * Short/literal fixture tokens would make the settlement fixture brute-forceable.
 */
export const MIN_TEST_FIXTURE_TOKEN_LENGTH = 16;

export type SecretStatus = 'configured' | 'ephemeral' | 'legacy-value' | 'too-short' | 'missing-in-production';

export interface SecretDiagnostic {
  name: string;
  status: SecretStatus;
  message: string;
}

export interface EnvironmentConfig {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  host: string;
  corsOrigin: string;
  databaseUrl: string;
  privateStoragePath: string;
  downloadTokenSecret: string;
  downloadTokenTtlMinutes: number;
  idempotencyTtlMinutes: number;
  paymentGatewayProvider: 'youpi' | 'development';
  paymentGatewayBaseUrl?: string;
  paymentGatewaySecret?: string;
  paymentGatewayMerchantId?: string;
  paymentGatewayMerchantVpa?: string;
  paymentGatewayPortalUrl?: string;
  paymentGatewayReturnUrl?: string;
  webhookSecret: string;
  /**
   * Test fixture routes stay unmounted unless NODE_ENV=test, ENABLE_TEST_ROUTES=true
   * AND a sufficiently long TEST_FIXTURE_TOKEN are ALL present (F-1, fail-closed).
   */
  testRoutesEnabled: boolean;
  /** Shared secret required in the X-Test-Fixture-Token header of fixture routes. */
  testFixtureToken?: string;
  /**
   * Number of trusted reverse-proxy hops in front of this process (G-1).
   * 0 (default) disables proxy trust entirely so X-Forwarded-For cannot spoof req.ip.
   */
  trustProxyHops: number;
  secretDiagnostics: SecretDiagnostic[];
}

function resolveSecret(
  rawValue: string | undefined,
  name: string,
  legacyValues: string[] = []
): { value: string; diagnostic: SecretDiagnostic } {
  const trimmed = rawValue?.trim();

  if (trimmed && trimmed.length > 0) {
    if (legacyValues.includes(trimmed)) {
      return {
        value: trimmed,
        diagnostic: {
          name,
          status: 'legacy-value',
          message: `${name} is set to a publicly documented development value and is not acceptable for production.`
        }
      };
    }
    if (trimmed.length < MIN_SECRET_LENGTH) {
      return {
        value: trimmed,
        diagnostic: {
          name,
          status: 'too-short',
          message: `${name} must be at least ${MIN_SECRET_LENGTH} characters.`
        }
      };
    }
    return {
      value: trimmed,
      diagnostic: { name, status: 'configured', message: `${name} is explicitly configured.` }
    };
  }

  // Fail-closed for production; ephemeral (never a public literal) for dev/test.
  const ephemeral = crypto.randomBytes(32).toString('hex');
  return {
    value: ephemeral,
    diagnostic: {
      name,
      status: 'ephemeral',
      message: `${name} was not provided. Generated an ephemeral random secret for this process only.`
    }
  };
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const downloadSecret = resolveSecret(process.env.DOWNLOAD_TOKEN_SECRET, 'DOWNLOAD_TOKEN_SECRET', [
  LEGACY_DEV_DOWNLOAD_SECRET
]);
const webhookSecret = resolveSecret(process.env.WEBHOOK_SECRET, 'WEBHOOK_SECRET');
const gatewaySecret = resolveSecret(process.env.PAYMENT_GATEWAY_SECRET, 'PAYMENT_GATEWAY_SECRET');

const secretDiagnostics: SecretDiagnostic[] = [
  downloadSecret.diagnostic,
  webhookSecret.diagnostic,
  gatewaySecret.diagnostic
];

if (isProduction) {
  for (const name of ['DOWNLOAD_TOKEN_SECRET', 'WEBHOOK_SECRET', 'PAYMENT_GATEWAY_SECRET']) {
    const diag = secretDiagnostics.find((d) => d.name === name);
    if (diag && diag.status !== 'configured') {
      diag.status = 'missing-in-production';
    }
  }
}

const enableTestRoutesFlag = (process.env.ENABLE_TEST_ROUTES || '').trim().toLowerCase() === 'true';
const rawTestFixtureToken = (process.env.TEST_FIXTURE_TOKEN || '').trim();
const testFixtureToken = rawTestFixtureToken.length > 0 ? rawTestFixtureToken : undefined;

/**
 * Parse a bounded, non-negative integer (G-1).
 * Invalid or out-of-range input falls back to the fail-closed default instead of
 * silently widening the trusted-proxy posture. The literal "true" is intentionally
 * rejected: trusting every hop lets any client forge X-Forwarded-For and evade
 * every per-IP control (rate limits, brute-force bounds).
 */
export function resolveTrustProxyHops(rawValue: string | undefined, fallback = 0, maxHops = 10): number {
  const trimmed = (rawValue || '').trim();
  if (trimmed.length === 0) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== trimmed || parsed < 0 || parsed > maxHops) {
    console.warn(
      `[VÉRRO env] TRUST_PROXY_HOPS="${trimmed}" is not a valid hop count (0-${maxHops}); failing closed to ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

export const env: EnvironmentConfig = {
  nodeEnv,
  isProduction,
  isTest,
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '127.0.0.1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:4173',
  databaseUrl: process.env.DATABASE_URL || path.resolve(process.cwd(), 'verro_commerce.sqlite'),
  privateStoragePath: process.env.PRIVATE_STORAGE_PATH || path.resolve(process.cwd(), 'storage/private_masters'),
  downloadTokenSecret: downloadSecret.value,
  downloadTokenTtlMinutes: parseInt(process.env.DOWNLOAD_TOKEN_TTL_MINUTES || '15', 10),
  idempotencyTtlMinutes: parseInt(process.env.IDEMPOTENCY_TTL_MINUTES || '1440', 10),
  paymentGatewayProvider: (process.env.PAYMENT_GATEWAY_PROVIDER?.trim().toLowerCase() === 'youpi' ||
    (isProduction && process.env.PAYMENT_GATEWAY_PROVIDER?.trim().toLowerCase() !== 'development'))
    ? 'youpi'
    : 'development',
  paymentGatewayBaseUrl: process.env.PAYMENT_GATEWAY_BASE_URL,
  paymentGatewaySecret: process.env.PAYMENT_GATEWAY_SECRET,
  paymentGatewayMerchantId: process.env.PAYMENT_GATEWAY_MERCHANT_ID,
  paymentGatewayMerchantVpa: process.env.PAYMENT_GATEWAY_MERCHANT_VPA || 'dvs2004@slc',
  paymentGatewayPortalUrl: process.env.PAYMENT_GATEWAY_PORTAL_URL || 'http://localhost:7000',
  paymentGatewayReturnUrl: process.env.PAYMENT_GATEWAY_RETURN_URL,
  webhookSecret: webhookSecret.value,
  // F-1: inverted allowlist. Fixture routes require ALL of:
  //   1. NODE_ENV === "test" (never development, never production),
  //   2. ENABLE_TEST_ROUTES=true,
  //   3. a non-trivial TEST_FIXTURE_TOKEN for the X-Test-Fixture-Token header guard.
  // Missing any one of them leaves the surface completely unmounted (404, not 403).
  testRoutesEnabled:
    enableTestRoutesFlag &&
    isTest &&
    testFixtureToken !== undefined &&
    testFixtureToken.length >= MIN_TEST_FIXTURE_TOKEN_LENGTH,
  testFixtureToken,
  // G-1: explicit trusted hop count; 0 means no proxy trust at all.
  trustProxyHops: resolveTrustProxyHops(process.env.TRUST_PROXY_HOPS, 0, 10),
  secretDiagnostics
};

if (enableTestRoutesFlag && !env.testRoutesEnabled) {
  const reason = !isTest
    ? `NODE_ENV must be exactly "test" (current: "${nodeEnv}")`
    : testFixtureToken === undefined
      ? 'TEST_FIXTURE_TOKEN is not set'
      : `TEST_FIXTURE_TOKEN must be at least ${MIN_TEST_FIXTURE_TOKEN_LENGTH} characters`;
  console.warn(
    `[VÉRRO env] ENABLE_TEST_ROUTES=true was requested but the fixture routes stay UNMOUNTED: ${reason}.`
  );
}

/**
 * Fail-closed secret validation invoked at process boot.
 * Production throws; non-production logs an explicit warning block.
 */
export function verifyRuntimeSecrets(): void {
  const problems = env.secretDiagnostics.filter((d) => d.status !== 'configured');

  if (env.isProduction && problems.length > 0) {
    const detail = problems.map((p) => `  - ${p.message}`).join('\n');
    throw new Error(
      `FATAL: refusing to start in production with unresolved secrets:\n${detail}\n` +
        'Provide strong (>= 32 char) secrets via the environment or a secret manager.'
    );
  }

  if (problems.length > 0) {
    console.warn('==================================================');
    console.warn('VÉRRO secret posture warning (non-production)');
    for (const problem of problems) {
      console.warn(`  - [${problem.status}] ${problem.message}`);
    }
    console.warn('  Ephemeral secrets rotate on every process restart.');
    console.warn('==================================================');
  }
}

/**
 * Secret posture report surfaced by the /health diagnostics endpoint.
 */
export function getSecretPosture(): Array<{ name: string; status: SecretStatus }> {
  return env.secretDiagnostics.map((d) => ({ name: d.name, status: d.status }));
}
