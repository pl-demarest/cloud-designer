/**
 * Axis-aligned boxes: the region a marching-cubes grid must cover, and lower bounds that let a
 * distance evaluation skip a primitive that cannot change the result.
 */

import type { SphereDef } from '../model/types';

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

/**
 * Grows `box` to hold the flow cloud's metaball isosurface, moved by `offset`: each sphere's
 * centre padded by its radius times its largest scale, plus 1.5. The flow-cloud worker meshes
 * the isosurface in this box (offset 0) and the surface-mesh worker unions it in place (offset
 * flowCloud.position).
 */
export function expandFlowCloudBounds(box: Box, spheres: SphereDef[], offset: readonly [number, number, number]): void {
  for (const sw of spheres) {
    const pad = sw.radius * Math.max(sw.scale[0], sw.scale[1], sw.scale[2]) + 1.5;
    expandBox(box, sw.position[0] + offset[0], sw.position[1] + offset[1], sw.position[2] + offset[2], pad);
  }
}
