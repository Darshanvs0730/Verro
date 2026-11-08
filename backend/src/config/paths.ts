/**
 * VÉRRO Commerce Backend — Path canonicalisation helpers.
 *
 * Used by the database isolation policy (F-44). Kept free of any configuration import so that
 * `config/env.ts` and `config/databaseIsolation.ts` can both use it without an import cycle.
 *
 * WHY CANONICALISATION IS NOT OPTIONAL
 * On macOS `os.tmpdir()` returns `/var/folders/...`, which is a symlink to
 * `/private/var/folders/...`. Comparing a freshly created temp directory against the raw temp
 * path therefore fails even when the directory really is inside the temporary root. Every
 * comparison here is made on canonical paths, and a path that does not exist yet (a database
 * file about to be created) is canonicalised through its deepest existing ancestor.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Collapse symlinks for the deepest existing ancestor, then re-append missing segments. */
export function canonicalPath(candidate: string): string {
  const absolute = path.resolve(candidate);
  const missingSegments: string[] = [];
  let cursor = absolute;

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }

  let real = cursor;
  try {
    real = fs.realpathSync.native(cursor);
  } catch {
    real = cursor;
  }

  return path.resolve(real, ...missingSegments);
}

/**
 * True when `child` is `parent` itself or lives beneath it.
 * macOS and Windows default to case-insensitive filesystems, so the comparison follows suit.
 */
export function isPathInside(child: string, parent: string): boolean {
  const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
  const normalise = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const target = normalise(canonicalPath(child));
  const root = normalise(canonicalPath(parent));

  return target === root || target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}