/**
 * Axis-aligned boxes, for lower bounds that let a distance evaluation skip a primitive that
 * cannot change the result.
 */

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** A box holding nothing; expandBox grows it. */
export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
}

/** Grows `b` to hold the cube of half-size `pad` about (x, y, z). */
export function expandBox(b: Box, x: number, y: number, z: number, pad = 0): void {
  b.minX = Math.min(b.minX, x - pad);
  b.minY = Math.min(b.minY, y - pad);
  b.minZ = Math.min(b.minZ, z - pad);
  b.maxX = Math.max(b.maxX, x + pad);
  b.maxY = Math.max(b.maxY, y + pad);
  b.maxZ = Math.max(b.maxZ, z + pad);
}

/** Euclidean distance from (x, y, z) to the box: 0 inside it, Infinity for an empty box. */
export function boxDistance(b: Box, x: number, y: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dy = Math.max(b.minY - y, 0, y - b.maxY);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Slack added before a lower bound rules a primitive out: far above the rounding error of the
 * distances compared (a few units in the last place of coordinates of order 10), far below
 * anything a grid resolves. A primitive is skipped only when its bound exceeds the value it is
 * compared with by more than this, so the skip never changes a minimum.
 */
export const BOUND_SLACK = 1e-9;
