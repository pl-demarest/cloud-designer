/**
 * Structural equality for preset data (numbers, strings, booleans, arrays and plain objects):
 * whether two definitions would build the same geometry. Numbers compare with Object.is, so 0 and
 * -0 differ (the geometry can keep the sign) and NaN equals NaN.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!sameValue(a[i], b[i])) return false;
    }
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(rb, key) || !sameValue(ra[key], rb[key])) return false;
  }
  return true;
}
