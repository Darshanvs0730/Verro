/**
 * VÉRRO Digital Art Gallery — Image Utilities & Graceful Fallbacks
 */

/**
 * Handle missing or pending artwork previews with architectural fallback plaque
 * @param {HTMLImageElement} img 
 * @param {string} assetKey 
 */
export function handleImageError(img, assetKey) {
  console.warn(`[VÉRRO Asset System Notice]: Image failed to load or pending: ${img.src} (${assetKey})`);
  img.classList.add('hidden');
  const parent = img.closest('.image-container') || img.parentElement;
  if (parent) {
    parent.classList.add('verro-asset-fallback');
  }
}

/**
 * Helper to render responsive picture tags with WebP source and JPG fallback
 * @param {object} options
 * @param {string} options.webp - WebP path
 * @param {string} options.src - JPG fallback path
 * @param {string} options.alt - Alt text
 * @param {string} options.className - CSS classes for img
 * @param {number} options.width - Intrinsic width
 * @param {number} options.height - Intrinsic height
 * @param {string} [options.loading='lazy'] - 'lazy' or 'eager'
 * @param {string} [options.fetchpriority] - 'high', 'low', or undefined
 * @param {string} [options.errorKey] - Asset key for error handler
 * @returns {string}
 */
export function renderPicture({
  webp,
  src,
  alt,
  className = 'w-full h-full object-cover',
  width = 512,
  height = 286,
  loading = 'lazy',
  fetchpriority = null,
  errorKey = 'ASSET'
}) {
  const priorityAttr = fetchpriority ? `fetchpriority="${fetchpriority}"` : '';
  const loadingAttr = loading ? `loading="${loading}"` : '';
  const errorAttr = `onerror="handleImageError(this, '${errorKey}')"`;

  return `
<picture>
  <source srcset="${webp}" type="image/webp"/>
  <img alt="${alt}" class="${className}" decoding="async" height="${height}" width="${width}" ${loadingAttr} ${priorityAttr} ${errorAttr} src="${src}"/>
</picture>`.trim();
}

// Bind to window for global inline accessibility
if (typeof window !== 'undefined') {
  window.handleImageError = handleImageError;
}
