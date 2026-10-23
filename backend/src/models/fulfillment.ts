/**
 * VÉRRO Commerce Backend — Fulfillment & Delivery Models
 */

export interface DownloadTokenPayload {
  orderId: string;
  productId: string;
  packageFilename: string;
  expiresAt: number; // Unix timestamp in ms
  issuedAt: number;
}

export interface FulfillmentResponseDTO {
  orderId: string;
  productId: string;
  downloadUrl: string;
  expiresAt: string; // ISO 8601 string
  filename: string;
}
