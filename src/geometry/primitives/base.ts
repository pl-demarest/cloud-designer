/**
 * The base primitive: its path as BaseMesh draws it (baseCurve, sampleBasePath) and the solid
 * the workers clip and mesh (BaseVolume), built from the same samples and frames.
 */

import type { BaseDef } from '../../model/types';
import { CatmullRomCurve } from '../catmullRom';
import { samplePath, type PathSamples } from '../path';
import { vec3, type Vec3 } from '../vec3';
import { BOUND_SLACK } from '../bounds';

/** The base's centre line: uniform Catmull-Rom (tension 0.5) through the control points,
 *  closed when the base is. */
export function baseCurve(base: BaseDef): CatmullRomCurve {
  return new CatmullRomCurve(base.controlPoints.map((p) => vec3(...p)), base.closed);
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
  /** Per piece (ring k to ring k + 1) of an open base: 1 where its overlap past its rings can
   *  reach the first (nearStart) or the last (nearEnd) ring's plane, because the chords between
   *  are shorter than sectionReach. All 0 on a closed base, which has no caps. */
  nearStart: Uint8Array;
  nearEnd: Uint8Array;
}

/** How far from its ring's centre the section of `v` reaches: the larger half-size of the oval,
 *  the corner of the rectangle. Every drawn ring vertex lies within it. */
function sectionReach(v: Pick<BaseVolume, 'rect' | 'halfH' | 'halfW'>): number {
  return v.rect ? Math.sqrt(v.halfH * v.halfH + v.halfW * v.halfW) : Math.max(v.halfH, v.halfW);
}

function packVectors(vs: Vec3[]): Float64Array {
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
    const none = new Uint8Array(0);
    return { count: 0, ...volume, p: empty, t: empty, n: empty, b: empty, nearStart: none, nearEnd: none };
  }
  const path = sampleBasePath(base, base.lengthSegments);
  const count = path.points.length;
  const p = packVectors(path.points);
  const pieces = count - 1;
  const nearStart = new Uint8Array(pieces);
  const nearEnd = new Uint8Array(pieces);
  if (!base.closed) {
    // Past a shared ring a piece's depth drops with the distance past the ring's plane, so the
    // overlap lies within sectionReach of that ring's centre (the depth is at most the smaller
    // half-size, and at the section's edge it is 0). A piece within that distance of an end ring,
    // along the chords, is cut at the end ring's plane too, as the end pieces are (tail.ts does
    // the same).
    const reach = sectionReach(volume);
    const along = new Float64Array(count);
    for (let k = 0; k < pieces; k++) {
      const i = 3 * k;
      const dx = p[i + 3] - p[i], dy = p[i + 4] - p[i + 1], dz = p[i + 5] - p[i + 2];
      along[k + 1] = along[k] + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    for (let k = 0; k < pieces; k++) {
      nearStart[k] = along[k] < reach ? 1 : 0;
      nearEnd[k] = along[count - 1] - along[k + 1] < reach ? 1 : 0;
    }
  }
  return {
    count,
    ...volume,
    p,
    t: packVectors(path.tangents),
    n: packVectors(path.normals),
    b: packVectors(path.binormals),
    nearStart,
    nearEnd,
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
 * outside of a bend is filled. That overlap reaches up to the smaller half-size past the ring,
 * which on a deep section is several ring spacings, so every piece it can carry past an end
 * ring's plane (nearStart, nearEnd) stops in that plane too: the solid ends flat in its first and
 * last ring, as the wire does.
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

  // The caps: intersection with the half-spaces before the first ring's plane and beyond the
  // last ring's plane.
  const toStart = startCap ? behind : v.nearStart[k] ? -((x - p[0]) * t[0] + (y - p[1]) * t[1] + (z - p[2]) * t[2]) : -Infinity;
  const last = 3 * (v.count - 1);
  const toEnd = endCap ? beyond : v.nearEnd[k] ? (x - p[last]) * t[last] + (y - p[last + 1]) * t[last + 1] + (z - p[last + 2]) * t[last + 2] : -Infinity;
  const pastCap = Math.max(toStart, toEnd);
  if (pastCap > -Infinity) {
    const od = Math.max(d, 0);
    const oh = Math.max(pastCap, 0);
    d = Math.min(Math.max(d, pastCap), 0) + Math.sqrt(od * od + oh * oh);
  }

  // Rings more than 90 degrees apart: the centre line turns back within this piece, as where the
  // control polygon doubles back on itself. The blended tangent then nearly vanishes, the two
  // ring planes face each other, and the region between them is unbounded. Every drawn ring
  // vertex lies within `reach` of its ring's centre (the larger half-size of the oval, the
  // corner of the rectangle), and the wire runs straight from ring to ring, so the drawn piece
  // lies within `reach` of the chord: the piece is cut to that capsule.
  if (t[i] * t[j] + t[i + 1] * t[j + 1] + t[i + 2] * t[j + 2] < 0) {
    const ab2 = abx * abx + aby * aby + abz * abz;
    const h = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0;
    const cx = apx - h * abx, cy = apy - h * aby, cz = apz - h * abz;
    d = Math.max(d, Math.sqrt(cx * cx + cy * cy + cz * cz) - sectionReach(v));
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
 * behind or beyond the end plane (as the capsule of a piece that turns back does, which only
 * raises the value). The result is exact wherever the exact value is below `cap`, and
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
