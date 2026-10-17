/**
 * Storage key safety for the brainy_files bucket.
 *
 * Supabase accepts only a limited character set in object keys, and its client
 * treats '#' as a URL fragment: an upload with '#' in the key silently lands under
 * a truncated name that can never be signed or removed. Everything that uploads
 * goes through these helpers.
 */

// Supabase's documented safe set, minus '?' (also breaks URLs).
const UNSAFE_FILENAME_CHARS = /[^\w !\-.*'()&$@=;:+,]/g;
const UNSAFE_KEY_CHAR = /[^\w !\-.*'()&$@=;:+,/]/;

// Drop '#' (as in "Invoice #123") and replace any other unsafe character,
// including path separators and non-ASCII, with '_'.
function storageSafeFilename(filename) {
  return filename.replace(/#/g, '').replace(UNSAFE_FILENAME_CHARS, '_');
}

// Pre-upload guard: a key that slipped past sanitizing fails loudly here
// instead of being stored somewhere it can't be found again.
function assertSafeStorageKey(key) {
  const bad = key.match(UNSAFE_KEY_CHAR);
  if (bad) {
    throw new Error(
      `Unsafe storage key '${key}': character '${bad[0]}' would break storage URLs. ` +
      'Pass the filename through storageSafeFilename() first.',
    );
  }
}

module.exports = { storageSafeFilename, assertSafeStorageKey };
