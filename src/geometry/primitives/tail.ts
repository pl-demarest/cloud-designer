/**
 * The tail primitive: where it attaches (resolveTailSetpoints), its spine and width profile as
 * TailMesh draws them (tailCurve, sampleTailPath), the spine samples of the flow cloud's tail
 * term (sampleTailSpine), and the solid the workers clip and mesh, TailMesh's tube with a
 * circular section (buildTailVolume, tailSDF, insideTail).
 */

import type { BaseDef, TailDef, TailSetpoint } from '../../model/types';
import { CatmullRomCurve } from '../catmullRom';
import { samplePath, type PathSamples } from '../path';
import { vec3, type Vec3 } from '../vec3';
import { basePointAt } from './base';
import { BOUND_SLACK, boxDistance, emptyBox, expandBox, type Box } from '../bounds';

/**
 * The setpoints the tail is drawn and modelled through. An attached tail starts on the base:
 * attachToBase 'end' puts its first setpoint attachOffset of the way along the base (1 is the
 * base's end), 'start' measures the same distance from the other end (1 is the base's start).
 * The stored first position is then unused. A new array; the input is not changed.
 */
export function resolveTailSetpoints(tail: TailDef, base: BaseDef): TailSetpoint[] {
  const pts = [...tail.setpoints];
  if (tail.attachToBase !== 'none' && pts.length > 0) {
    const t = tail.attachToBase === 'end' ? tail.attachOffset : 1 - tail.attachOffset;
    pts[0] = { ...pts[0], position: basePointAt(base, t) };
  }
  return pts;
}

/** `tail` with its setpoints resolved against `base` (resolveTailSetpoints). */
export function attachedTail(tail: TailDef, base: BaseDef): TailDef {
  return { ...tail, setpoints: resolveTailSetpoints(tail, base) };
}

/** The tail's spine: open uniform Catmull-Rom (tension 0.5) through the setpoint positions. */
export function tailCurve(setpoints: TailSetpoint[]): CatmullRomCurve {
  return new CatmullRomCurve(setpoints.map((sp) => vec3(...sp.position)), false);
}

/**
 * The tail's width at curve parameter t: linear between setpoint k, at t = k / (n - 1) where the
 * curve passes through it, and setpoint k + 1, so each setpoint's own width is met exactly.
 */
export function tailWidthAt(setpoints: TailSetpoint[], t: number): number {
  if (setpoints.length === 0) return 0.5;
  if (setpoints.length === 1) return setpoints[0].width;
  const s = t * (setpoints.length - 1);
  const k = Math.min(Math.floor(s), setpoints.length - 2);
  const f = s - k;
  // (1 - f) a + f b is exactly a at f = 0 and exactly b at f = 1.
  return (1 - f) * setpoints[k].width + f * setpoints[k + 1].width;
}

export interface TailPathSamples extends PathSamples {
  /** The width at each sample (tailWidthAt). */
  widths: number[];
}

/**
 * The spine at `segments` equal arc-length steps, where TailMesh puts its rings: point, Frenet
 * frame and width all at the same curve parameter. Needs at least two setpoints.
 */
export function sampleTailPath(setpoints: TailSetpoint[], segments: number): TailPathSamples {
  const curve = tailCurve(setpoints);
  const path = samplePath(curve, segments, false);
  const widths: number[] = [];
  // getPointAt(u) is getPoint(getUtoTmapping(u)).
  for (let i = 0; i <= segments; i++) widths.push(tailWidthAt(setpoints, curve.getUtoTmapping(i / segments)));
  return { ...path, widths };
}

/** A sample of the tail's spine: position and width. */
export interface TailSample {
  px: number; py: number; pz: number;
  width: number;
}

/** The spine as the flow cloud's tail term reads it: TailMesh's ring centres and widths
 *  (sampleTailPath with the tail's lengthSegments). Empty for fewer than two setpoints. */
export function sampleTailSpine(tail: TailDef): TailSample[] {
  if (tail.setpoints.length < 2) return [];
  const { points, widths } = sampleTailPath(tail.setpoints, tail.lengthSegments);
  return points.map((p, i) => ({ px: p.x, py: p.y, pz: p.z, width: widths[i] }));
}

/**
 * The tail's solid, packed for per-voxel evaluation: TailMesh's rings (sampleTailPath with the
 * tail's lengthSegments, so the same centres, tangents and widths) joined by straight pieces, as
 * the base volume joins its rings (base.ts), with a circular section. Between two rings the
 * section is the circle whose centre, plane and radius blend those of the two rings linearly,
 * as the drawn wire's longitudinal lines run straight from ring to ring. The tube ends in flat
 * caps in the planes of its first and last ring, where the drawn tube ends.
 */
export interface TailVolume {
  /** Number of rings: lengthSegments + 1, or 0 for a tail with fewer than two setpoints. */
  count: number;
  /** x, y, z per ring: centre and unit tangent. */
  p: Float64Array;
  t: Float64Array;
  /** Radius per ring: the width there. */
  w: Float64Array;
  /** Per piece (ring k to ring k + 1): the chord's vector, 1 / its squared length (0 for a
   *  chord of length 0), the larger of the two radii, the tangent's change (three per piece),
   *  and the chord's dot products with the first tangent and with that change. */
  ab: Float64Array;
  invAb2: Float64Array;
  reach: Float64Array;
  dt: Float64Array;
  abT: Float64Array;
  abDt: Float64Array;
  /** Per piece: 1 where its overlap past its rings can reach the first (nearStart) or the last
   *  (nearEnd) ring's plane, because the chords between lie within the piece's larger radius. */
  nearStart: Uint8Array;
  nearEnd: Uint8Array;
  /** The box of the ring centres and the largest radius: tailSDF at a point is at least the
   *  point's distance to the box minus maxWidth (see tailPieceSDF). */
  box: Box;
  maxWidth: number;
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

/** The solid of `tail`, whose setpoints are already resolved against the base (attachedTail). */
export function buildTailVolume(tail: TailDef): TailVolume {
  const box = emptyBox();
  if (tail.setpoints.length < 2) {
    const empty = new Float64Array(0);
    const none = new Uint8Array(0);
    return {
      count: 0, p: empty, t: empty, w: empty,
      ab: empty, invAb2: empty, reach: empty, dt: empty, abT: empty, abDt: empty, nearStart: none, nearEnd: none,
      box, maxWidth: 0,
    };
  }
  const path = sampleTailPath(tail.setpoints, tail.lengthSegments);
  const count = path.points.length;
  const p = packVectors(path.points);
  const t = packVectors(path.tangents);
  const w = Float64Array.from(path.widths);
  const pieces = count - 1;
  const ab = new Float64Array(3 * pieces);
  const dt = new Float64Array(3 * pieces);
  const invAb2 = new Float64Array(pieces);
  const reach = new Float64Array(pieces);
  const abT = new Float64Array(pieces);
  const abDt = new Float64Array(pieces);
  // along[k]: the chords' length from ring 0 to ring k.
  const along = new Float64Array(count);
  for (let k = 0; k < pieces; k++) {
    const i = 3 * k;
    for (let a = 0; a < 3; a++) {
      ab[i + a] = p[i + 3 + a] - p[i + a];
      dt[i + a] = t[i + 3 + a] - t[i + a];
    }
    const ab2 = ab[i] * ab[i] + ab[i + 1] * ab[i + 1] + ab[i + 2] * ab[i + 2];
    invAb2[k] = ab2 > 0 ? 1 / ab2 : 0;
    reach[k] = Math.max(w[k], w[k + 1]);
    abT[k] = ab[i] * t[i] + ab[i + 1] * t[i + 1] + ab[i + 2] * t[i + 2];
    abDt[k] = ab[i] * dt[i] + ab[i + 1] * dt[i + 1] + ab[i + 2] * dt[i + 2];
    along[k + 1] = along[k] + Math.sqrt(ab2);
  }
  const nearStart = new Uint8Array(pieces);
  const nearEnd = new Uint8Array(pieces);
  for (let k = 0; k < pieces; k++) {
    nearStart[k] = along[k] < reach[k] ? 1 : 0;
    nearEnd[k] = along[count - 1] - along[k + 1] < reach[k] ? 1 : 0;
  }
  for (const q of path.points) expandBox(box, q.x, q.y, q.z);
  return {
    count, p, t, w, ab, invAb2, reach, dt, abT, abDt, nearStart, nearEnd,
    box, maxWidth: Math.max(...path.widths),
  };
}

/** The point's distance to piece k's chord minus the piece's larger ring radius. */
function chordCapsule(x: number, y: number, z: number, v: TailVolume, k: number): number {
  const { p, ab } = v;
  const i = k * 3;
  const apx = x - p[i], apy = y - p[i + 1], apz = z - p[i + 2];
  const abx = ab[i], aby = ab[i + 1], abz = ab[i + 2];
  let h = (apx * abx + apy * aby + apz * abz) * v.invAb2[k];
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const cx = apx - h * abx, cy = apy - h * aby, cz = apz - h * abz;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) - v.reach[k];
}

/**
 * Signed distance to the piece between rings k and k + 1, given `capsule`, its chordCapsule
 * value at the point.
 *
 * As in the base's pieceSDF, the point's blend parameter s is the one whose blended ring plane
 * holds it, clamped to [0, 1]; the section there is the circle about the blended centre, in the
 * plane normal to the blended tangent, with the blended radius. Past a ring shared with the next
 * piece the depth drops with the distance past its plane, so neighbouring pieces overlap and the
 * outside of a bend is filled. That overlap reaches up to the larger radius past the ring, which
 * on the tail is many ring spacings, so every piece it can carry past an end ring's plane stops
 * in that plane, as the end pieces do: the tube ends flat in its first and last ring.
 *
 * The drawn piece lies within the larger ring radius of its chord (every ring vertex lies within
 * its radius of its ring's centre, and the wire runs straight from ring to ring), so the piece
 * is cut to that capsule. That removes the region a centre line that turns back within the
 * piece would leave between ring planes facing each other (the base's fix for the same case),
 * and it bounds the value from below by `capsule` everywhere.
 */
function tailPieceSDF(x: number, y: number, z: number, v: TailVolume, k: number, capsule: number): number {
  const { p, t, w, ab, dt } = v;
  const i = k * 3;
  const j = i + 3;
  const apx = x - p[i], apy = y - p[i + 1], apz = z - p[i + 2];
  const abx = ab[i], aby = ab[i + 1], abz = ab[i + 2];
  const dtx = dt[i], dty = dt[i + 1], dtz = dt[i + 2];

  // (P - centre(s)) . tangent(s) = 0, the quadratic a s^2 + bq s + c = 0 (base.ts pieceSDF).
  const c = apx * t[i] + apy * t[i + 1] + apz * t[i + 2];
  const bq = apx * dtx + apy * dty + apz * dtz - v.abT[k];
  const a = -v.abDt[k];
  const disc = bq * bq - 4 * a * c;
  let s = bq < 0 && disc >= 0 ? (2 * c) / (Math.sqrt(disc) - bq) : bq !== 0 ? -c / bq : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const qx = apx - s * abx, qy = apy - s * aby, qz = apz - s * abz;

  // The distance from the section's centre within its plane: q without its part along the
  // blended tangent (all of q where s solves the quadratic).
  const tx = t[i] + s * dtx, ty = t[i + 1] + s * dty, tz = t[i + 2] + s * dtz;
  const tt = tx * tx + ty * ty + tz * tz;
  // No section plane: a tail of zero length, or the point where the blended tangent of a centre
  // line that turns back vanishes.
  if (tt < 1e-12) return Infinity;
  const qt = qx * tx + qy * ty + qz * tz;
  const rho = Math.sqrt(Math.max(qx * qx + qy * qy + qz * qz - (qt * qt) / tt, 0));
  const d2 = rho - (w[k] + s * (w[k + 1] - w[k]));

  // Signed distances behind ring k's plane and beyond ring k + 1's plane.
  const behind = -c;
  const beyond = (x - p[j]) * t[j] + (y - p[j + 1]) * t[j + 1] + (z - p[j + 2]) * t[j + 2];
  const startCap = k === 0;
  const endCap = k === v.count - 2;

  const past = Math.max(startCap ? 0 : behind, endCap ? 0 : beyond, 0);
  const out = Math.max(d2, 0);
  let d = past > 0 ? Math.sqrt(out * out + past * past) + Math.min(d2, 0) : d2;

  // The caps: intersection with the half-spaces before the first ring's plane and beyond the
  // last ring's plane.
  const toStart = startCap ? behind : v.nearStart[k] ? -((x - p[0]) * t[0] + (y - p[1]) * t[1] + (z - p[2]) * t[2]) : -Infinity;
  const n = 3 * (v.count - 1);
  const toEnd = endCap ? beyond : v.nearEnd[k] ? (x - p[n]) * t[n] + (y - p[n + 1]) * t[n + 1] + (z - p[n + 2]) * t[n + 2] : -Infinity;
  const h = Math.max(toStart, toEnd);
  if (h > -Infinity) {
    const od = Math.max(d, 0);
    const oh = Math.max(h, 0);
    d = Math.min(Math.max(d, h), 0) + Math.sqrt(od * od + oh * oh);
  }
  return Math.max(d, capsule);
}

/** Scratch for tailSDF: each piece's chordCapsule value at the current point. */
let capsules = new Float64Array(64);

/**
 * Signed distance to the tail's solid: negative inside, Infinity without a tail. A piece's
 * value is at least its chordCapsule value, and each chord lies in the box of the ring centres,
 * so the value at a point is at least its distance to that box minus maxWidth.
 *
 * The piece with the lowest chordCapsule value is evaluated first; every other piece only where
 * its chordCapsule value is not above both `cap` and the minimum so far. A caller that only
 * needs the value where it is below `cap` passes that cap. The result is exact wherever the
 * exact value is below `cap`, and above `cap` elsewhere; min(cap, result) is always
 * min(cap, exact value).
 */
export function tailSDF(x: number, y: number, z: number, v: TailVolume, cap = Infinity): number {
  const pieces = v.count - 1;
  if (pieces < 1) return Infinity;
  if (capsules.length < pieces) capsules = new Float64Array(pieces);
  const values = capsules;
  // chordCapsule for every piece, written out: this loop runs at every grid node near the tail.
  const { p, ab, invAb2, reach } = v;
  let first = 0;
  let lowest = Infinity;
  for (let k = 0, i = 0; k < pieces; k++, i += 3) {
    const apx = x - p[i], apy = y - p[i + 1], apz = z - p[i + 2];
    const abx = ab[i], aby = ab[i + 1], abz = ab[i + 2];
    let h = (apx * abx + apy * aby + apz * abz) * invAb2[k];
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const cx = apx - h * abx, cy = apy - h * aby, cz = apz - h * abz;
    const value = Math.sqrt(cx * cx + cy * cy + cz * cz) - reach[k];
    values[k] = value;
    if (value < lowest) {
      lowest = value;
      first = k;
    }
  }
  const slack = BOUND_SLACK;
  if (lowest > cap + slack) return Infinity;
  let d = tailPieceSDF(x, y, z, v, first, lowest);
  let limit = Math.min(cap, d) + slack;
  for (let k = 0; k < pieces; k++) {
    if (k === first || values[k] > limit) continue;
    d = Math.min(d, tailPieceSDF(x, y, z, v, k, values[k]));
    limit = Math.min(cap, d) + slack;
  }
  return d;
}

/** True strictly inside the tail's solid (tailSDF < 0). */
export function insideTail(x: number, y: number, z: number, v: TailVolume): boolean {
  // Inside some piece is inside its capsule, so within maxWidth of the ring centres' box.
  if (v.count < 2 || boxDistance(v.box, x, y, z) >= v.maxWidth) return false;
  for (let k = 0; k < v.count - 1; k++) {
    const capsule = chordCapsule(x, y, z, v, k);
    if (capsule < 0 && tailPieceSDF(x, y, z, v, k, capsule) < 0) return true;
  }
  return false;
}
