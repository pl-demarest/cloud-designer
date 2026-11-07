/**
 * The sphere primitive's volume: a sphere or axis-aligned ellipsoid, optionally cut to the half
 * above its centre.
 */

import type { SphereDef } from '../../types/cloud';

/** Signed distance to a sphere/ellipsoid surface (approximate for ellipsoids).
 *  Matches the containment test insideSphere() below. */
export function sphereSDF(x: number, y: number, z: number, sw: SphereDef): number {
  let dx = x - sw.position[0];
  let dy = y - sw.position[1];
  let dz = z - sw.position[2];

  if (sw.shape === 'ellipsoid') {
    const sx = sw.scale?.[0] ?? 1;
    const sy = sw.scale?.[1] ?? 1;
    const sz = sw.scale?.[2] ?? 1;
    dx /= sx;
    dy /= sy;
    dz /= sz;
  }

  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let d = dist - sw.radius;

  // Half-sphere: intersection with y >= center.y plane (in local space before ellipsoid scale)
  if (sw.half) {
    const planeD = -(y - sw.position[1]); // positive below equator
    d = Math.max(d, planeD);
  }

  return d;
}

/** Hard geometric test against a sphere's visible sphere (or ellipsoid).
 *  Matches what the user sees in the editor — independent of metaball field falloff.
 *  With self-exclusion in the caller, inset=1.0 produces zero-gap seams. */
export function insideSphere(x: number, y: number, z: number, sw: SphereDef, inset: number): boolean {
  let dx = x - sw.position[0];
  let dy = y - sw.position[1];
  let dz = z - sw.position[2];
  if (sw.half && dy < 0) return false;
  if (sw.shape === 'ellipsoid') {
    dx /= sw.scale[0];
    dy /= sw.scale[1];
    dz /= sw.scale[2];
  }
  const dist2 = dx * dx + dy * dy + dz * dz;
  const r = sw.radius * inset;
  return dist2 < r * r;
}
