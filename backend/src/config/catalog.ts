/**
 * VÉRRO Commerce Backend — Authoritative Product Catalog
 * The server is the sole source of truth for pricing, currency, and packages.
 * Client-submitted prices are NEVER trusted.
 */

export interface ProductCatalogItem {
  id: string;
  collection: string;
  title: string;
  pricePaise: number; // Smallest currency unit (39900 paise = ₹399)
  formattedPrice: string;
  currency: string;
  deliveryPackage: string; // Filename in private master storage
  isActive: boolean;
  formats: string[];
}

export const PRODUCT_CATALOG: Record<string, ProductCatalogItem> = {
  'vol-01': {
    id: 'vol-01',
    collection: 'VOL. 01',
    title: 'NO DEFAULTS.',
    pricePaise: 39900,
    formattedPrice: '₹399',
    currency: 'INR',
    deliveryPackage: 'vol-01-master.zip',
    isActive: true,
    formats: ['Mac Desktop (Landscape)', 'iPhone Mobile (Portrait)']
  }
};

/**
 * Retrieve product definition authoritatively from server catalog
 * @param productId 
 */
export function getAuthoritativeProduct(productId: string): ProductCatalogItem | null {
  // Only own, plain string keys are eligible — prevents prototype-chain lookups
  // (e.g. "constructor", "__proto__", "toString") from resolving as products.
  if (typeof productId !== 'string' || !Object.prototype.hasOwnProperty.call(PRODUCT_CATALOG, productId)) {
    return null;
  }
  const product = PRODUCT_CATALOG[productId];
  if (!product || !product.isActive) {
    return null;
  }
  return product;
}

/**
 * Server-side allowlist of delivery packages that may ever be read from private storage.
 * Anything outside this list is rejected before touching the filesystem.
 */
export function getDeliveryPackages(): string[] {
  return Object.values(PRODUCT_CATALOG)
    .filter((product) => product.isActive)
    .map((product) => product.deliveryPackage);
}
