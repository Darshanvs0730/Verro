/**
 * VÉRRO Commerce Backend — Active Payment Rail Banner (F-46)
 *
 * Kept out of `server.ts` so the reported rail can be asserted by the regression suite without
 * binding a port (importing `server.ts` starts a listener as a side effect).
 */

import { env } from '../config/env.js';
import { getPaymentAdapter } from '../adapters/paymentAdapterFactory.js';

/**
 * F-46: report the rail that is ACTUALLY active.
 *
 * The boot banner previously hard-coded "Inactive / Dev-Safe (mock rail)" even when YouPI-PG was
 * the live settlement rail, so an operator reading the log could not tell which adapter was
 * issuing and verifying payments. Resolution failures stay fail-closed: in production a rail that
 * cannot be resolved aborts startup instead of silently serving orders that can never settle.
 */
export function describeActivePaymentRail(): string {
  try {
    const adapter = getPaymentAdapter();
    return adapter.isProductionReady
      ? `${adapter.adapterName} [production-ready]`
      : `${adapter.adapterName} [NON-PRODUCTION]`;
  } catch (adapterErr: any) {
    if (env.isProduction) {
      throw adapterErr;
    }
    return `unresolved — ${adapterErr.message}`;
  }
}
