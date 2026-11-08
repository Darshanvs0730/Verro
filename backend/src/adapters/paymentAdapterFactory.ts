/**
 * VÉRRO Commerce Backend — Payment Adapter Factory (Fail-Closed)
 *
 * Red-team remediation R1.5.
 * The development/mock adapter may ONLY be selected in non-production environments.
 * Any production boot without a real, configured payment rail fails hard instead of
 * silently falling back to a mock that can be driven by a public constant.
 */

import { env } from '../config/env.js';
import { PaymentGatewayAdapter } from './paymentGatewayAdapter.js';
import { DevelopmentPaymentAdapter } from './developmentPaymentAdapter.js';
import { YouPiPaymentAdapter } from './youpiPaymentAdapter.js';

let selectedAdapter: PaymentGatewayAdapter | null = null;

export class PaymentAdapterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentAdapterConfigurationError';
  }
}

/**
 * Resolve the active payment gateway adapter for this process.
 *
 * Fail-closed rules:
 *  - production + no real gateway configured -> throw (never mock).
 *  - production + mock adapter selected       -> throw.
 *  - provider === 'youpi'                     -> YouPiPaymentAdapter.
 *  - development/test (mock default)         -> explicit mock adapter with a warning.
 */
export function getPaymentAdapter(): PaymentGatewayAdapter {
  if (selectedAdapter) {
    return selectedAdapter;
  }

  // 1. YouPI-PG Sovereign Gateway Selection
  if (env.paymentGatewayProvider === 'youpi') {
    if (env.isProduction) {
      if (!env.paymentGatewayBaseUrl) {
        throw new PaymentAdapterConfigurationError(
          'FATAL: PAYMENT_GATEWAY_BASE_URL must be configured when running YouPI payment rail in production.'
        );
      }
      const webhookDiag = env.secretDiagnostics.find((d) => d.name === 'WEBHOOK_SECRET');
      if (!webhookDiag || webhookDiag.status !== 'configured') {
        throw new PaymentAdapterConfigurationError(
          'FATAL: A strong WEBHOOK_SECRET (>= 32 chars) must be explicitly configured for YouPI payment rail in production.'
        );
      }
      // F-46: fail closed on the merchant payment IDENTITY too. `verifyRuntimeSecrets()` already
      // refuses to boot, and this guard keeps the invariant if an adapter is ever built through
      // another entrypoint (a script, a worker, a test harness). Getting this wrong does not throw
      // — it silently pays the wrong person.
      for (const identity of ['PAYMENT_GATEWAY_MERCHANT_VPA', 'PAYMENT_GATEWAY_MERCHANT_NAME']) {
        const identityDiag = env.secretDiagnostics.find((d) => d.name === identity);
        if (!identityDiag || identityDiag.status !== 'configured') {
          throw new PaymentAdapterConfigurationError(
            `FATAL: ${identity} must be explicitly configured for the YouPI payment rail in production. ` +
              'The development fallback would route real settlement to the wrong payee.'
          );
        }
      }
    }

    selectedAdapter = new YouPiPaymentAdapter({
      apiUrl: env.paymentGatewayBaseUrl || 'http://localhost:6100',
      portalUrl: env.paymentGatewayPortalUrl || 'http://localhost:7000',
      merchantId: env.paymentGatewayMerchantId,
      payeeVpa: env.paymentGatewayMerchantVpa,
      payeeName: env.paymentGatewayMerchantName,
      webhookSecret: env.webhookSecret,
      // F-32: the OUTBOUND merchant credential is deliberately a separate value from the
      // INBOUND webhook signing key. Sharing one secret for both directions meant that
      // anything able to observe the outbound header (proxy logs, gateway dashboards, a
      // compromised gateway) also gained the ability to forge inbound settlement events.
      merchantKey: env.paymentGatewaySecret,
      returnUrl: env.paymentGatewayReturnUrl
    });
    return selectedAdapter;
  }

  // 2. Production fail-closed check
  if (env.isProduction) {
    throw new PaymentAdapterConfigurationError(
      'FATAL: no production payment gateway adapter is implemented. ' +
        'Implement and register a real PaymentGatewayAdapter before starting in production. ' +
        'The development mock adapter will never be selected in production.'
    );
  }

  // 3. Safe development mock adapter
  console.warn(
    '[PaymentAdapterFactory]: Selecting DevelopmentPaymentAdapter (mock). ' +
      'This rail cannot represent real settlement and must not be used in production.'
  );
  selectedAdapter = new DevelopmentPaymentAdapter();
  return selectedAdapter;
}

/** Test hook — allows setting an explicit adapter (e.g. for testing) */
export function setPaymentAdapter(adapter: PaymentGatewayAdapter | null): void {
  selectedAdapter = adapter;
}

/** Test hook — allows assertions on adapter selection without cross-test leakage. */
export function resetPaymentAdapter(): void {
  selectedAdapter = null;
}