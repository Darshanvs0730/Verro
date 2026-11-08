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
import { fileURLToPath } from 'node:url';

dotenv.config();

/**
 * Repository layout, derived from THIS module's location instead of `process.cwd()` (F-44).
 * `src/config/env.ts` -> `backend` -> repository root.
 */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

/** The development/production database. No test process may ever open this file. */
export const LIVE_DATABASE_PATH = path.join(BACKEND_ROOT, 'verro_commerce.sqlite');

export type DatabaseSource = 'absolute' | 'relative-resolved' | 'default';

/**
 * F-44 root cause. A RELATIVE `DATABASE_URL` used to be handed to better-sqlite3 verbatim, so
 * SQLite resolved it against `process.cwd()`: `backend/.env` ships exactly such a value, which
 * meant `npm --prefix backend run ...` opened the developer database while the same code started
 * from the repository root silently created an unrelated, empty one.
 *
 * Relative values are now resolved against the backend package root — deterministic and cwd
 * independent — and that absolute path is what the driver opens. Whether the target is ALLOWED
 * for the current `NODE_ENV` is a separate, fail-closed decision taken by
 * `evaluateDatabaseIsolation()` from `config/databaseIsolation.ts` inside `getDatabase()`.
 */
export function resolveDatabaseTarget(rawValue: string | undefined): { path: string; source: DatabaseSource } {
  const raw = rawValue?.trim();

  if (!raw) {
    return { path: LIVE_DATABASE_PATH, source: 'default' };
  }
  if (path.isAbsolute(raw)) {
    return { path: path.normalize(raw), source: 'absolute' };
  }
  return { path: path.resolve(BACKEND_ROOT, raw), source: 'relative-resolved' };
}

const DATABASE_TARGET = resolveDatabaseTarget(process.env.DATABASE_URL);

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

export type SecretStatus =
  | 'configured'
  | 'ephemeral'
  | 'legacy-value'
  | 'too-short'
  | 'development-default'
  | 'missing-in-production';

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
  /** How `databaseUrl` was derived. `default`/`relative-resolved` is surfaced as a warning (F-44). */
  databaseSource: DatabaseSource;
  /** Absolute `<repo>/backend`, resolved without consulting `process.cwd()`. */
  backendRoot: string;
  /** Absolute repository root. A test process may never write inside this tree. */
  repoRoot: string;
  /** The developer/production database that no test run may ever open. */
  liveDatabasePath: string;
  /** Directory a test run may place its throwaway database in (defaults to `os.tmpdir()`). */
  testDatabaseDir?: string;
  privateStoragePath: string;
  downloadTokenSecret: string;
  downloadTokenTtlMinutes: number;
  idempotencyTtlMinutes: number;
  paymentGatewayProvider: 'youpi' | 'development';
  paymentGatewayBaseUrl?: string;
  paymentGatewaySecret?: string;
  paymentGatewayMerchantId?: string;
  /**
   * F-46: always defined (development falls back to a documented development value), but the
   * fallback is marked in `secretDiagnostics` and production refuses to boot without an explicit
   * value — a wrong payee silently misroutes real settlement.
   */
  paymentGatewayMerchantVpa: string;
  /** F-46: payee display name published with the VPA in the UPI intent. Same fail-closed rule. */
  paymentGatewayMerchantName: string;
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

/**
 * F-46 — the merchant payment identity.
 *
 * The UPI VPA and the payee name are not secrets, but they decide WHERE A CUSTOMER'S MONEY GOES.
 * They used to be silent fallbacks: `env.ts` defaulted the VPA to a developer address, the YouPI
 * adapter defaulted it again, and the payee name was a literal in the adapter with no
 * configuration at all. In production, a missing `PAYMENT_GATEWAY_MERCHANT_VPA` therefore
 * produced payment intents pointing at the developer's personal UPI ID, with no error anywhere —
 * every settlement would have gone to the wrong payee and the order would still read `paid`.
 *
 * Both values now flow through `secretDiagnostics`, so the existing fail-closed boot check
 * (`verifyRuntimeSecrets`) refuses to start production without them.
 */
export const DEVELOPMENT_MERCHANT_VPA = 'dvs2004@slc';
export const DEVELOPMENT_MERCHANT_NAME = 'Darshan V Sunkanur';

/** Never log or report a full payment identifier; the posture lines stay truncated. */
function maskMerchantIdentifier(value: string): string {
  return value.length <= 3 ? '***' : `${value.slice(0, 3)}****`;
}

function resolveMerchantIdentity(
  rawValue: string | undefined,
  name: string,
  developmentFallback: string,
  isProd: boolean
): { value: string; diagnostic: SecretDiagnostic } {
  const trimmed = rawValue?.trim();

  if (trimmed && trimmed.length > 0) {
    return {
      value: trimmed,
      diagnostic: { name, status: 'configured', message: `${name} is explicitly configured.` }
    };
  }

  return {
    value: developmentFallback,
    diagnostic: {
      name,
      status: isProd ? 'missing-in-production' : 'development-default',
      message: isProd
        ? `${name} is not set. Production must never fall back to the public development value (${maskMerchantIdentifier(developmentFallback)}).`
        : `${name} is not set; using the documented development fallback (${maskMerchantIdentifier(developmentFallback)}).`
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
const merchantVpa = resolveMerchantIdentity(
  process.env.PAYMENT_GATEWAY_MERCHANT_VPA,
  'PAYMENT_GATEWAY_MERCHANT_VPA',
  DEVELOPMENT_MERCHANT_VPA,
  isProduction
);
const merchantName = resolveMerchantIdentity(
  process.env.PAYMENT_GATEWAY_MERCHANT_NAME,
  'PAYMENT_GATEWAY_MERCHANT_NAME',
  DEVELOPMENT_MERCHANT_NAME,
  isProduction
);

const secretDiagnostics: SecretDiagnostic[] = [
  downloadSecret.diagnostic,
  webhookSecret.diagnostic,
  gatewaySecret.diagnostic,
  merchantVpa.diagnostic,
  merchantName.diagnostic
];

if (isProduction) {
  // Any diagnostic that is not `configured` is fatal in production, whatever the reason
  // (ephemeral, a published legacy literal, too short, missing, or a development default that was
  // never replaced). Listing the names explicitly made this easy to forget when a new
  // production-critical value was added — which is precisely what happened to the merchant
  // identity (F-46).
  for (const diagnostic of secretDiagnostics) {
    if (diagnostic.status !== 'configured') {
      diagnostic.status = 'missing-in-production';
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
  databaseUrl: DATABASE_TARGET.path,
  databaseSource: DATABASE_TARGET.source,
  backendRoot: BACKEND_ROOT,
  repoRoot: REPO_ROOT,
  liveDatabasePath: LIVE_DATABASE_PATH,
  testDatabaseDir: process.env.VERRO_TEST_DB_DIR?.trim() || undefined,
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
  paymentGatewayMerchantVpa: merchantVpa.value,
  paymentGatewayMerchantName: merchantName.value,
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

/**
 * F-44: make the resolution visible. A relative `DATABASE_URL` is no longer a silent,
 * cwd-dependent coin flip, but the operator should still know which file was chosen.
 */
if (env.databaseSource !== 'absolute') {
  console.warn(
    `[VÉRRO env] DATABASE_URL was ${
      env.databaseSource === 'default' ? 'not set' : 'relative'
    }; resolved against the backend package root to ${env.databaseUrl}.`
  );
}

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

// F-47: `getSecretPosture()` used to be exported and returned from the unauthenticated `/health`
// endpoint. It never exposed a secret VALUE, but it published which secrets were missing,
// short, legacy or ephemeral. That is a free reconnaissance oracle for anyone who can reach the
// port: it says whether webhook signing is running on an ephemeral key, and which deployments are
// misconfigured — before an attacker spends a single request probing for the consequences.
//
// The posture is still reported, but only where an operator sees it: `verifyRuntimeSecrets()`
// logs the full block at boot and throws in production. Nothing about it belongs on a public
// endpoint, so the accessor is gone entirely rather than merely unplumbed.
