/**
 * VÉRRO Commerce Backend — Private File Storage Adapter
 * Securely manages master high-resolution assets isolated completely outside the public web root.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getDeliveryPackages } from '../config/catalog.js';

export interface FileMetadata {
  exists: boolean;
  filename: string;
  sizeBytes?: number;
  fullPath?: string;
}

export interface TemporaryDownloadAccess {
  downloadUrl: string;
  expiresAt: string; // ISO timestamp
  token: string;
}

export interface DownloadTokenVerification {
  isValid: boolean;
  orderId?: string;
  filename?: string;
  /** SHA-256 hash of the purchaser access token bound into the signature. */
  purchaserTokenHash?: string;
  expired?: boolean;
}

export interface FileStorageAdapter {
  getFileMetadata(filename: string): Promise<FileMetadata>;
  generateDownloadAccess(orderId: string, filename: string, purchaserTokenHash: string): Promise<TemporaryDownloadAccess>;
  verifyDownloadToken(token: string): DownloadTokenVerification;
  getFilePath(filename: string): string;
  /** True only when the filename is an allowlisted catalog delivery package. */
  isAllowedPackage(filename: string): boolean;
}

export class LocalPrivateStorageAdapter implements FileStorageAdapter {
  private baseDirectory: string;
  private tokenSecret: string;
  private ttlMinutes: number;
  private allowedPackages: Set<string>;

  constructor(
    baseDirectory = env.privateStoragePath,
    tokenSecret = env.downloadTokenSecret,
    ttlMinutes = env.downloadTokenTtlMinutes,
    allowedPackages: string[] = getDeliveryPackages()
  ) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.tokenSecret = tokenSecret;
    this.ttlMinutes = ttlMinutes;
    // Server-side allowlist: only catalog delivery packages may ever be read.
    this.allowedPackages = new Set(allowedPackages);
  }

  /** Reject any filename that is not a catalog-listed delivery package. */
  isAllowedPackage(filename: string): boolean {
    return typeof filename === 'string' && this.allowedPackages.has(path.basename(filename));
  }

  getFilePath(filename: string): string {
    // Prevent directory traversal attacks
    const sanitized = path.basename(filename);
    if (!this.allowedPackages.has(sanitized)) {
      throw new Error(`Storage access denied: "${sanitized}" is not an allowlisted delivery package.`);
    }
    return path.join(this.baseDirectory, sanitized);
  }

  async getFileMetadata(filename: string): Promise<FileMetadata> {
    const fullPath = this.getFilePath(filename);
    try {
      const stat = await fs.promises.stat(fullPath);
      return {
        exists: stat.isFile(),
        filename: path.basename(filename),
        sizeBytes: stat.size,
        fullPath
      };
    } catch {
      return {
        exists: false,
        filename: path.basename(filename)
      };
    }
  }

  /**
   * Mint a short-lived download token bound to BOTH the order and the purchaser
   * access token. Knowing an order ID alone is never sufficient to produce a
   * valid signature.
   */
  async generateDownloadAccess(
    orderId: string,
    filename: string,
    purchaserTokenHash: string
  ): Promise<TemporaryDownloadAccess> {
    if (!purchaserTokenHash || !/^[a-f0-9]{64}$/i.test(purchaserTokenHash)) {
      throw new Error('Download access denied: a valid purchaser token hash is required to mint a token.');
    }

    const expiresAtMs = Date.now() + this.ttlMinutes * 60 * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    // Bound payload: orderId : filename : expiresAt : sha256(customerAccessToken)
    const payload = `${orderId}:${filename}:${expiresAtMs}:${purchaserTokenHash}`;
    const hmac = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');
    const token = Buffer.from(`${payload}:${hmac}`).toString('base64url');

    // Local temporary authorized route (streamed securely on the server, not a static file)
    const downloadUrl = `/api/v1/orders/${orderId}/download/file?token=${token}`;

    return {
      downloadUrl,
      expiresAt: expiresAtIso,
      token
    };
  }

  verifyDownloadToken(token: string): DownloadTokenVerification {
    try {
      if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
        return { isValid: false };
      }

      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      if (parts.length !== 5) {
        return { isValid: false };
      }

      const [orderId, filename, expiresAtStr, purchaserTokenHash, receivedHmac] = parts;

      if (!/^[0-9]+$/.test(expiresAtStr)) {
        return { isValid: false };
      }

      const expiresAtMs = parseInt(expiresAtStr, 10);

      // Verify HMAC signature over the identity-bound payload
      const payload = `${orderId}:${filename}:${expiresAtMs}:${purchaserTokenHash}`;
      const expectedHmac = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');

      // Compare as equal-length buffers of hex bytes (never raw ASCII) with a length guard.
      const receivedBuffer = Buffer.from(receivedHmac, 'hex');
      const expectedBuffer = Buffer.from(expectedHmac, 'hex');
      if (
        receivedBuffer.length !== expectedBuffer.length ||
        receivedBuffer.length !== 32 ||
        !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
      ) {
        return { isValid: false };
      }

      // Verify expiration
      if (Date.now() > expiresAtMs) {
        return { isValid: false, expired: true, orderId, filename };
      }

      return {
        isValid: true,
        orderId,
        filename,
        purchaserTokenHash,
        expired: false
      };
    } catch {
      return { isValid: false };
    }
  }
}
