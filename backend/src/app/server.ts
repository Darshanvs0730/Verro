/**
 * VÉRRO Commerce Backend — Server Entry Point
 */

import { createApp, assertRuntimeSecrets } from './app.js';
import { env } from '../config/env.js';
import { idempotencyRepository } from '../repositories/idempotencyRepository.js';
import { describeActivePaymentRail } from './paymentRailBanner.js';

// FAIL-CLOSED: unresolved production secrets abort startup before binding a port.
assertRuntimeSecrets();

// P-5: retention sweep. Replay records older than IDEMPOTENCY_TTL_MINUTES are removed at
// boot so a long-lived deployment cannot accumulate unbounded idempotency rows. Expired
// records are also treated as absent at read time, so a purge failure is never a replay risk.
const purgedRecords = idempotencyRepository.purgeExpired();

const app = createApp();

/**
 * F-46: report the rail that is ACTUALLY active (implementation lives in `paymentRailBanner.ts`
 * so the regression suite can assert the reported rail without binding a port).
 */
const activePaymentRail = describeActivePaymentRail();

app.listen(env.port, env.host, () => {
  console.log(`==================================================`);
  console.log(`VÉRRO Commerce Backend running at http://${env.host}:${env.port}`);
  console.log(`Environment: ${env.nodeEnv}`);
  console.log(`Database: ${env.databaseUrl}`);
  console.log(`Private Masters Storage: ${env.privateStoragePath}`);
  console.log(`Trusted proxy hops: ${env.trustProxyHops === 0 ? 'none (X-Forwarded-For is ignored)' : env.trustProxyHops}`);
  console.log(`Expired idempotency records purged at boot: ${purgedRecords}`);
  console.log(`Test fixture routes: ${env.testRoutesEnabled ? 'ENABLED (NODE_ENV=test + token guarded)' : 'disabled'}`);
  console.log(`Payment Gateway Adapter: ${activePaymentRail}`);
  console.log(`==================================================`);
});
