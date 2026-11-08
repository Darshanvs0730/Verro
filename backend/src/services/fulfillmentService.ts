/**
 * VÉRRO Commerce Backend — Fulfillment Service
 * Handles authorization and access generation for purchased digital master packages.
 * Enforces zero access for unpaid orders.
 */

import crypto from 'node:crypto';
import { orderRepository } from '../repositories/orderRepository.js';
import { getAuthoritativeProduct } from '../config/catalog.js';
import { FileStorageAdapter, LocalPrivateStorageAdapter } from '../adapters/fileStorageAdapter.js';
import { FulfillmentResponseDTO } from '../models/fulfillment.js';
import { DevelopmentEmailService, EmailService } from './emailService.js';
import { OrderService } from './orderService.js';

export class FulfillmentService {
  private fileStorage: FileStorageAdapter;
  private emailService: EmailService;
  private orderService: OrderService;

  constructor(
    fileStorage: FileStorageAdapter = new LocalPrivateStorageAdapter(),
    emailService: EmailService = new DevelopmentEmailService(),
    orderService: OrderService = new OrderService(emailService)
  ) {
    this.fileStorage = fileStorage;
    this.emailService = emailService;
    this.orderService = orderService;
  }

  /**
   * Authorize and generate temporary download access for a paid order
   * Strictly verifies customer purchaser access token
   */
  async authorizeDownload(orderId: string, customerAccessToken?: string): Promise<FulfillmentResponseDTO> {
    // 1. Purchaser Authorization Check (CRITICAL SECURITY BOUNDARY)
    const auth = this.orderService.verifyCustomerAccess(orderId, customerAccessToken);
    if (!auth.authorized || !auth.order) {
      throw new Error(`Customer authorization denied: ${auth.reason}`);
    }
    const order = auth.order;

    // 2. Strict Payment Verification Check (CRITICAL FINANCIAL GUARD)
    if (order.status !== 'paid') {
      throw new Error(`Fulfillment authorization denied: Order "${orderId}" is not paid (current status: "${order.status}")`);
    }

    // 3. Product Catalog Resolution
    const product = getAuthoritativeProduct(order.product_id);
    if (!product) {
      throw new Error(`Associated product definition missing for order: "${orderId}"`);
    }

    // 4. Verify Master File Exists in Private Storage
    const metadata = await this.fileStorage.getFileMetadata(product.deliveryPackage);
    if (!metadata.exists) {
      throw new Error(`Private master file "${product.deliveryPackage}" is not present in storage.`);
    }

    // 5. Generate Short-Lived Signed Download Access (bound to purchaser identity)
    const purchaseBinding = this.orderService.getPurchaserBindingHash(orderId, customerAccessToken);
    if (!purchaseBinding) {
      throw new Error(`Fulfillment authorization denied: unable to bind order "${orderId}" to the purchaser identity.`);
    }
    const access = await this.fileStorage.generateDownloadAccess(order.id, product.deliveryPackage, purchaseBinding);

    // 6. Register the minted token as a single-use grant (F-41). Only the digest is stored,
    // so the table cannot be used to reconstruct a usable URL. From here on, exactly one GET
    // may claim it; every subsequent attempt is refused as a replay.
    orderRepository.registerDownloadGrant(
      this.hashDownloadToken(access.token),
      order.id,
      product.deliveryPackage,
      new Date().toISOString(),
      access.expiresAt
    );

    // 7. Record Fulfillment in Order Record
    const fulfilledAt = new Date().toISOString();
    orderRepository.markFulfilled(order.id, fulfilledAt);

    // 8. Dispatch Access Email if Customer Email is Present — at most once per order.
    // The HTTP response is the authoritative delivery channel (it carries a live link);
    // the email is a record, so a repeated /download call must not re-send it (F-41).
    if (order.customer_email) {
      const claimed = orderRepository.claimNotificationDispatch(
        `download_access:${order.id}`,
        order.id,
        'download_access',
        order.customer_email,
        new Date().toISOString()
      );

      if (claimed) {
        await this.emailService.sendDownloadAccess(
          order.customer_email,
          order.id,
          access.downloadUrl,
          access.expiresAt
        );
      }
    }

    return {
      orderId: order.id,
      productId: product.id,
      downloadUrl: access.downloadUrl,
      expiresAt: access.expiresAt,
      filename: product.deliveryPackage
    };
  }

  /** Digest used as the single-use grant key (and as an audit-safe token identifier). */
  private hashDownloadToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Verify temporary download token and return master file path for streaming.
   * The grant is claimed exactly once (F-41): a replayed URL is refused even inside its TTL.
   */
  async verifyDownloadRequest(token: string): Promise<{ authorized: boolean; filePath?: string; filename?: string; error?: string; reason?: 'forged' | 'expired' | 'replayed' | 'denied' }> {
    const tokenVerification = this.fileStorage.verifyDownloadToken(token);

    if (!tokenVerification.isValid) {
      if (tokenVerification.expired) {
        return { authorized: false, error: 'Download authorization token has expired.', reason: 'expired' };
      }
      return { authorized: false, error: 'Invalid or forged download authorization token.', reason: 'forged' };
    }

    const { orderId, filename, purchaserTokenHash } = tokenVerification;
    if (!orderId || !filename || !purchaserTokenHash) {
      return { authorized: false, error: 'Malformed token claims.', reason: 'forged' };
    }

    // Verify the filename is an allowlisted catalog delivery package
    if (!this.fileStorage.isAllowedPackage(filename)) {
      return { authorized: false, error: 'Requested package is not part of the authorized catalog.', reason: 'denied' };
    }

    // Verify order is still paid
    const order = orderRepository.findById(orderId);
    if (!order || order.status !== 'paid') {
      return { authorized: false, error: 'Order is not in paid status.', reason: 'denied' };
    }

    // CRITICAL BINDING CHECK: the token must reference the exact package that the
    // catalog associates with THIS order's product. Prevents cross-product reuse.
    const product = getAuthoritativeProduct(order.product_id);
    if (!product || product.deliveryPackage !== filename) {
      return { authorized: false, error: 'Download token does not match the purchased product package.', reason: 'denied' };
    }

    // CRITICAL BINDING CHECK: the token must be bound to the purchaser access token
    // registered on the order at creation time.
    if (!order.customer_token_hash || order.customer_token_hash !== purchaserTokenHash) {
      return { authorized: false, error: 'Download token is not bound to the order purchaser.', reason: 'denied' };
    }

    const filePath = this.fileStorage.getFilePath(filename);
    const metadata = await this.fileStorage.getFileMetadata(filename);

    if (!metadata.exists) {
      return { authorized: false, error: 'Requested file is not available on storage.', reason: 'denied' };
    }

    // SINGLE-USE CLAIM (F-41) — the last step, so a request that fails any authorization
    // check above never burns the grant. Unknown tokens are refused: grants issued before
    // this migration (or already consumed) can only be replaced by requesting a fresh link
    // from POST /download, which is never rate-limited into a dead end.
    const grant = orderRepository.findDownloadGrant(this.hashDownloadToken(token));
    if (!grant) {
      return {
        authorized: false,
        error: 'Download authorization is no longer valid. Please request a fresh download link.',
        reason: 'replayed'
      };
    }

    if (!orderRepository.consumeDownloadGrant(grant.token_hash, new Date().toISOString())) {
      return {
        authorized: false,
        error: 'This download link has already been used. Please request a fresh download link.',
        reason: 'replayed'
      };
    }

    // NOTE: filePath is intentionally NOT returned to the client; it is used only
    // for server-side streaming via res.sendFile().
    return {
      authorized: true,
      filePath,
      filename
    };
  }
}
