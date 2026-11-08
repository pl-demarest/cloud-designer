/**
 * The base primitive: its path as BaseMesh draws it (baseCurve, sampleBasePath) and the solid
 * the workers clip and mesh (BaseVolume), built from the same samples and frames.
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import type { BaseDef } from '../../model/types';
import { samplePath, type PathSamples } from '../path';
import { BOUND_SLACK } from '../bounds';

/** The base's centre line: uniform Catmull-Rom (tension 0.5) through the control points,
 *  closed when the base is. */
export function baseCurve(base: BaseDef): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    base.controlPoints.map((p) => new Vector3(...p)),
    base.closed,
    'catmullrom',
    0.5
  );
}

/** The centre line at `segments` equal arc-length steps with its Frenet frames: where
 *  BaseMesh puts its cross-section rings. Needs at least two control points. */
export function sampleBasePath(base: BaseDef, segments: number): PathSamples {
  return samplePath(baseCurve(base), segments, base.closed);
}

/** The point on the centre line at arc-length fraction t, clamped to [0, 1]. A base with fewer
 *  than two control points has no line; its point is the origin. */
export function basePointAt(base: BaseDef, t: number): [number, number, number] {
  if (base.controlPoints.length < 2) return [0, 0, 0];
  const p = baseCurve(base).getPointAt(Math.max(0, Math.min(1, t)));
  return [p.x, p.y, p.z];
}

/**
 * The base's solid, packed for per-voxel evaluation: BaseMesh's rings (sampleBasePath with the
 * base's lengthSegments, so the same centres and Frenet frames) joined by straight pieces.
 * Between two rings the cross-section is that of the drawn wire, whose longitudinal lines run
 * straight from ring to ring. An open base ends in flat caps in the planes of its first and last
 * ring; a closed base, whose last sample is its first, has no caps. The cross-section is the
 * oval or the rectangle BaseMesh draws.
 */
export interface BaseVolume {
  /** Number of samples: lengthSegments + 1, or 0 for a base with fewer than two control points. */
  count: number;
  closed: boolean;
  rect: boolean;
  /** Half the cross-section height, along the normal, and half its width, along the binormal. */
  halfH: number;
  halfW: number;
  /** x, y, z per sample: ring centre, unit tangent, normal and binormal. */
  p: Float64Array;
  t: Float64Array;
  n: Float64Array;
  b: Float64Array;
}

function packVectors(vs: Vector3[]): Float64Array {
  const out = new Float64Array(vs.length * 3);
  vs.forEach((v, i) => {
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  });
  return out;
}

export function buildBaseVolume(base: BaseDef): BaseVolume {
  const volume = {
    closed: base.closed,
    rect: base.crossSectionShape === 'rect',
    halfH: base.crossSectionHeight / 2,
    halfW: base.crossSectionWidth / 2,
  };
  if (base.controlPoints.length < 2) {
    const empty = new Float64Array(0);
    return { count: 0, ...volume, p: empty, t: empty, n: empty, b: empty };
  }
  const path = sampleBasePath(base, base.lengthSegments);
  return {
    count: path.points.length,
    ...volume,
    p: packVectors(path.points),
    t: packVectors(path.tangents),
    n: packVectors(path.normals),
    b: packVectors(path.binormals),
  };
}

/** Signed distance to the cross-section at (qn, qb) in its own frame: the oval's is approximate
 *  (the scaled radial distance), the rectangle's exact. */
function sectionSDF(qn: number, qb: number, v: BaseVolume): number {
  if (v.rect) {
    const dn = Math.abs(qn) - v.halfH;
    const db = Math.abs(qb) - v.halfW;
    const on = Math.max(dn, 0);
    const ob = Math.max(db, 0);
    return Math.sqrt(on * on + ob * ob) + Math.min(Math.max(dn, db), 0);
  }
  const en = qn / v.halfH;
  const eb = qb / v.halfW;
  return (Math.sqrt(en * en + eb * eb) - 1) * Math.min(v.halfH, v.halfW);
}

/**
 * Signed distance to the piece between rings k and k + 1. Between the rings, centre, tangent and
 * frame are blended linearly with a parameter s in [0, 1], as the drawn wire blends its ring
 * vertices. The point's s is the one whose blended ring plane holds it (s = 0 on ring k's
 * plane, so a point drawn on a ring is measured in that ring's own frame), clamped to [0, 1].
 *
 * At an open end the piece stops in the end ring's plane (the exact distance to a flat cap).
 * Past a ring shared with the next piece it continues with its depth reduced by the distance
 * past that ring's plane, so neighbouring pieces overlap: inside, the union keeps the full
 * cross-section depth across the joint instead of dropping to 0 on the shared plane, and the
 * outside of a bend is filled.
 */
function pieceSDF(x: number, y: number, z: number, v: BaseVolume, k: number): number {
  const { p, t, n, b } = v;
  const i = k * 3;
  const j = i + 3;
  const apx = x - p[i], apy = y - p[i + 1], apz = z - p[i + 2];
  const abx = p[j] - p[i], aby = p[j + 1] - p[i + 1], abz = p[j + 2] - p[i + 2];
  const dtx = t[j] - t[i], dty = t[j + 1] - t[i + 1], dtz = t[j + 2] - t[i + 2];

  // (P - centre(s)) . tangent(s) = 0 is the quadratic a s^2 + bq s + c = 0. For a straight
  // piece a = 0 and s is the projection onto the chord; the root taken is the one that
  // continues it (bq < 0 while the path does not double back on itself).
  const c = apx * t[i] + apy * t[i + 1] + apz * t[i + 2];
  const bq = apx * dtx + apy * dty + apz * dtz - (abx * t[i] + aby * t[i + 1] + abz * t[i + 2]);
  const a = -(abx * dtx + aby * dty + abz * dtz);
  const disc = bq * bq - 4 * a * c;
  let s = bq < 0 && disc >= 0 ? (2 * c) / (Math.sqrt(disc) - bq) : bq !== 0 ? -c / bq : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const qx = apx - s * abx, qy = apy - s * aby, qz = apz - s * abz;

  // The blended frame is not quite unit length, so a coordinate is the projection over its
  // squared length.
  const nx = n[i] + s * (n[j] - n[i]), ny = n[i + 1] + s * (n[j + 1] - n[i + 1]), nz = n[i + 2] + s * (n[j + 2] - n[i + 2]);
  const bx = b[i] + s * (b[j] - b[i]), by = b[i + 1] + s * (b[j + 1] - b[i + 1]), bz = b[i + 2] + s * (b[j + 2] - b[i + 2]);
  const nn = nx * nx + ny * ny + nz * nz;
  const bb = bx * bx + by * by + bz * bz;
  if (nn < 1e-12 || bb < 1e-12) return Infinity; // a path without frames (all control points equal)
  const d2 = sectionSDF((qx * nx + qy * ny + qz * nz) / nn, (qx * bx + qy * by + qz * bz) / bb, v);

  // Signed distances behind ring k's plane and beyond ring k + 1's plane.
  const behind = -c;
  const beyond = (x - p[j]) * t[j] + (y - p[j + 1]) * t[j + 1] + (z - p[j + 2]) * t[j + 2];
  const startCap = !v.closed && k === 0;
  const endCap = !v.closed && k === v.count - 2;

  // Past a shared ring: depth reduced by the distance past its plane.
  const past = Math.max(startCap ? 0 : behind, endCap ? 0 : beyond, 0);
  let d = past > 0 ? Math.sqrt(Math.max(d2, 0) ** 2 + past * past) + Math.min(d2, 0) : d2;

  // A cap: intersection with the half-space before the end ring's plane.
  if (startCap || endCap) {
    const h = Math.max(startCap ? behind : -Infinity, endCap ? beyond : -Infinity);
    const od = Math.max(d, 0);
    const oh = Math.max(h, 0);
    d = Math.min(Math.max(d, h), 0) + Math.sqrt(od * od + oh * oh);
  }
  return d;
}

/**
 * Signed distance to the base solid: negative inside, Infinity only without a base. Continuous
 * everywhere, the end caps included.
 *
 * A caller that only needs the value where it is below `cap` passes that cap, and pieces that
 * cannot come below both the cap and the minimum so far are skipped. A piece's value is at least
 * max(behind, beyond) - min(halfH, halfW), behind and beyond being the signed distances past its
 * two ring planes (as pieceSDF computes them): the cross-section distance is at least
 * -min(halfH, halfW), its value at the centre for the oval and the rectangle alike; past a shared
 * ring the depth adds the distance past the plane, and a cap intersects with the half-space
 * behind or beyond the end plane. The result is exact wherever the exact value is below `cap`, and
 * above `cap` elsewhere; min(cap, result) is always min(cap, exact value).
 */
export function baseSDF(x: number, y: number, z: number, v: BaseVolume, cap = Infinity): number {
  const { p, t } = v;
  // No bound for a cross-section that is not a valid shape.
  const depth = v.halfH > 0 && v.halfW > 0 ? Math.min(v.halfH, v.halfW) : Infinity;
  let d = Infinity;
  for (let k = 0; k < v.count - 1; k++) {
    const i = k * 3;
    const j = i + 3;
    const behind = -((x - p[i]) * t[i] + (y - p[i + 1]) * t[i + 1] + (z - p[i + 2]) * t[i + 2]);
    const beyond = (x - p[j]) * t[j] + (y - p[j + 1]) * t[j + 1] + (z - p[j + 2]) * t[j + 2];
    if (Math.max(behind, beyond) - depth > Math.min(cap, d) + BOUND_SLACK) continue;
    d = Math.min(d, pieceSDF(x, y, z, v, k));
  }
  return d;
}

/** True strictly inside the base solid (baseSDF < 0). */
export function insideBase(x: number, y: number, z: number, v: BaseVolume): boolean {
  for (let k = 0; k < v.count - 1; k++) {
    if (pieceSDF(x, y, z, v, k) < 0) return true;
  }
  return false;
}
