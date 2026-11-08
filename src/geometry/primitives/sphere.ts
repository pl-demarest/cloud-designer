/**
 * The sphere primitive's volume as SphereMesh draws it: a sphere or ellipsoid, optionally only
 * its upper half (the dome above its local y = 0 plane), rotated by Euler XYZ about its centre.
 * Points are taken into the sphere's local frame by the inverse rotation, then the inverse scale
 * of an ellipsoid; the half test reads local y.
 */

import type { SphereDef } from '../../model/types';
import { eulerXYZ } from '../mat3';

/** A sphere prepared for evaluation at many points: its rotation computed once. */
export interface SphereFrame {
  def: SphereDef;
  /** The rotation SphereMesh applies (eulerXYZ of def.rotation), row-major. */
  m: Float64Array;
}

export function sphereFrame(def: SphereDef): SphereFrame {
  return { def, m: eulerXYZ(def.rotation[0], def.rotation[1], def.rotation[2]) };
}

/** Scratch for toLocal: the scaled local x, y, z, then the local y before scaling. */
const local = new Float64Array(4);

/** (x, y, z) in the sphere's frame, written to `local`. On the drawn surface the first three
 *  have length def.radius; local[3] is the signed distance above the dome's base plane. */
function toLocal(x: number, y: number, z: number, f: SphereFrame): void {
  const { def, m } = f;
  const dx = x - def.position[0];
  const dy = y - def.position[1];
  const dz = z - def.position[2];
  // The inverse of a rotation is its transpose.
  let lx = m[0] * dx + m[3] * dy + m[6] * dz;
  let ly = m[1] * dx + m[4] * dy + m[7] * dz;
  let lz = m[2] * dx + m[5] * dy + m[8] * dz;
  local[3] = ly;
  if (def.shape === 'ellipsoid') {
    lx /= def.scale[0];
    ly /= def.scale[1];
    lz /= def.scale[2];
  }
  local[0] = lx;
  local[1] = ly;
  local[2] = lz;
}

/** Signed distance to the sphere or ellipsoid (approximate for ellipsoids: measured in its
 *  scaled frame), intersected with the half-space above its base plane for a half sphere.
 *  Matches the containment test insideSphere() below. */
export function sphereSDF(x: number, y: number, z: number, f: SphereFrame): number {
  toLocal(x, y, z, f);
  let d = Math.sqrt(local[0] * local[0] + local[1] * local[1] + local[2] * local[2]) - f.def.radius;
  if (f.def.half) d = Math.max(d, -local[3]); // positive below the base plane
  return d;
}

/** Hard geometric test against the sphere the editor draws, independent of the metaball
 *  falloff: strictly inside its surface. */
export function insideSphere(x: number, y: number, z: number, f: SphereFrame): boolean {
  toLocal(x, y, z, f);
  if (f.def.half && local[3] < 0) return false;
  const r = f.def.radius;
  return local[0] * local[0] + local[1] * local[1] + local[2] * local[2] < r * r;
}

/** The sphere's metaball term at (x, y, z): falloff * r^2 / d^2 with d measured in its scaled,
 *  rotated frame (falloff * 100 within 0.01 of the centre). The whole sphere counts, half or not. */
export function sphereFieldTerm(x: number, y: number, z: number, f: SphereFrame): number {
  toLocal(x, y, z, f);
  const dist2 = local[0] * local[0] + local[1] * local[1] + local[2] * local[2];
  const r2 = f.def.radius * f.def.radius;
  return dist2 < 0.0001 ? f.def.falloff * 100 : f.def.falloff * r2 / dist2;
}
