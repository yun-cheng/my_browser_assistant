/**
 * Check if two numbers are approximately equal within a threshold.
 */
export function isApproximately(value, target, threshold = 0.01) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) {
    return false;
  }
  return Math.abs(value - target) <= threshold;
}

/**
 * Normalise a keyboard event.key to a lowercase single-key string.
 */
export function normalizeKey(key) {
  if (typeof key !== 'string') {
    return '';
  }
  return key.toLowerCase();
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}