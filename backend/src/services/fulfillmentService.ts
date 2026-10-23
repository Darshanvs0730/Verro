/**
 * VÉRRO Commerce Backend — Fulfillment Service
 * Handles authorization and access generation for purchased digital master packages.
 * Enforces zero access for unpaid orders.
 */

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

    // 6. Record Fulfillment in Order Record
    const fulfilledAt = new Date().toISOString();
    orderRepository.markFulfilled(order.id, fulfilledAt);

    // 7. Dispatch Access Email if Customer Email is Present
    if (order.customer_email) {
      await this.emailService.sendDownloadAccess(
        order.customer_email,
        order.id,
        access.downloadUrl,
        access.expiresAt
      );
    }

    return {
      orderId: order.id,
      productId: product.id,
      downloadUrl: access.downloadUrl,
      expiresAt: access.expiresAt,
      filename: product.deliveryPackage
    };
  }

  /**
   * Verify temporary download token and return master file path for streaming
   */
  async verifyDownloadRequest(token: string): Promise<{ authorized: boolean; filePath?: string; filename?: string; error?: string }> {
    const tokenVerification = this.fileStorage.verifyDownloadToken(token);

    if (!tokenVerification.isValid) {
      if (tokenVerification.expired) {
        return { authorized: false, error: 'Download authorization token has expired.' };
      }
      return { authorized: false, error: 'Invalid or forged download authorization token.' };
    }

    const { orderId, filename, purchaserTokenHash } = tokenVerification;
    if (!orderId || !filename || !purchaserTokenHash) {
      return { authorized: false, error: 'Malformed token claims.' };
    }

    // Verify the filename is an allowlisted catalog delivery package
    if (!this.fileStorage.isAllowedPackage(filename)) {
      return { authorized: false, error: 'Requested package is not part of the authorized catalog.' };
    }

    // Verify order is still paid
    const order = orderRepository.findById(orderId);
    if (!order || order.status !== 'paid') {
      return { authorized: false, error: 'Order is not in paid status.' };
    }

    // CRITICAL BINDING CHECK: the token must reference the exact package that the
    // catalog associates with THIS order's product. Prevents cross-product reuse.
    const product = getAuthoritativeProduct(order.product_id);
    if (!product || product.deliveryPackage !== filename) {
      return { authorized: false, error: 'Download token does not match the purchased product package.' };
    }

    // CRITICAL BINDING CHECK: the token must be bound to the purchaser access token
    // registered on the order at creation time.
    if (!order.customer_token_hash || order.customer_token_hash !== purchaserTokenHash) {
      return { authorized: false, error: 'Download token is not bound to the order purchaser.' };
    }

    const filePath = this.fileStorage.getFilePath(filename);
    const metadata = await this.fileStorage.getFileMetadata(filename);

    if (!metadata.exists) {
      return { authorized: false, error: 'Requested file is not available on storage.' };
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
