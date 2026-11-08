/**
 * Axis-aligned boxes: the region a marching-cubes grid must cover, and lower bounds that let a
 * distance evaluation skip a primitive that cannot change the result.
 */

import type { FlowCloudSettings, SphereDef } from '../model/types';
import type { TailSample } from './primitives/tail';

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
 * Grows `box` to hold the flow cloud's metaball isosurface (field >= threshold), moved by
 * `offset`. The flow-cloud worker meshes the isosurface in this box (offset 0) and the
 * surface-mesh worker unions it in place (offset flowCloud.position).
 *
 * The field is a sum of n positive terms: falloff * r^2 / d^2 for each sphere, d measured in its
 * rotated frame and, for an ellipsoid, scaled by 1 / scale, so at least the world distance over
 * the largest scale; and, when tailStrength > 0, tailStrength * w^2 / d^2 for the tail, d the
 * distance to the spine and w the width at its nearest point. Where every term is below
 * threshold / n the field is below threshold, so the surface lies within r s sqrt(n falloff /
 * threshold) of each sphere's centre (s the ellipsoid's largest scale, 1 for a sphere) or within
 * w sqrt(n tailStrength / threshold) of the spine. Each centre and each spine sample is padded by
 * that reach, and a centre by at least the radius times largest scale plus 1.5 used before, so
 * settings that box already held keep their grid.
 */
export function expandFlowCloudBounds(
  box: Box,
  spheres: SphereDef[],
  tailSpine: TailSample[],
  flowCloud: Pick<FlowCloudSettings, 'threshold' | 'tailStrength'>,
  offset: readonly [number, number, number],
): void {
  const { threshold, tailStrength } = flowCloud;
  const tail = tailStrength > 0 && tailSpine.length >= 2;
  const terms = spheres.length + (tail ? 1 : 0);
  // At a threshold of 0 or below the field reaches it everywhere, and no box holds the surface.
  const reach = (strength: number) => (threshold > 0 ? Math.sqrt((terms * Math.max(strength, 0)) / threshold) : 0);

  for (const sw of spheres) {
    const largestScale = Math.max(sw.scale[0], sw.scale[1], sw.scale[2]);
    const radius = sw.radius * (sw.shape === 'ellipsoid' ? largestScale : 1);
    const pad = Math.max(sw.radius * largestScale + 1.5, radius * reach(sw.falloff));
    expandBox(box, sw.position[0] + offset[0], sw.position[1] + offset[1], sw.position[2] + offset[2], pad);
  }
  if (tail) {
    const k = reach(tailStrength);
    for (const s of tailSpine) expandBox(box, s.px + offset[0], s.py + offset[1], s.pz + offset[2], s.width * k);
  }
}
