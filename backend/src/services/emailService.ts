/**
 * VÉRRO Commerce Backend — Email Service Abstraction
 * Logs intended email dispatch without pretending delivery until provider is connected.
 */

export interface EmailDispatchPayload {
  to: string;
  subject: string;
  orderId: string;
  template: string;
  data: Record<string, unknown>;
}

export interface EmailService {
  sendOrderConfirmation(to: string, orderId: string, details: Record<string, unknown>): Promise<boolean>;
  sendDownloadAccess(to: string, orderId: string, downloadUrl: string, expiresAt: string): Promise<boolean>;
}

export class DevelopmentEmailService implements EmailService {
  async sendOrderConfirmation(to: string, orderId: string, details: Record<string, unknown>): Promise<boolean> {
    const payload: EmailDispatchPayload = {
      to,
      subject: `[VÉRRO] Order Confirmation — #${orderId}`,
      orderId,
      template: 'order_confirmation',
      data: details
    };

    console.info(`[EmailService (Dev Mock)]: Prepared Order Confirmation email for "${to}":`, JSON.stringify(payload));
    return true;
  }

  async sendDownloadAccess(to: string, orderId: string, downloadUrl: string, expiresAt: string): Promise<boolean> {
    const payload: EmailDispatchPayload = {
      to,
      subject: `[VÉRRO] Your Digital Chapter Download Access — #${orderId}`,
      orderId,
      template: 'download_access',
      data: { downloadUrl, expiresAt }
    };

    console.info(`[EmailService (Dev Mock)]: Prepared Download Access email for "${to}":`, JSON.stringify(payload));
    return true;
  }
}
