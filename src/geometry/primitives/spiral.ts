/**
 * The spiral primitive's volume (thick spirals only): a rounded rectangle swept along the
 * spiral path.
 */

import type { SpiralDef } from '../../model/types';
import { BOUND_SLACK, boxDistance, emptyBox, expandBox, type Box } from '../bounds';
import { eulerXYZ } from '../mat3';

export interface SpiralSample {
  cx: number; cy: number; cz: number;   // center (world space)
  rx: number; ry: number; rz: number;   // radial direction (world)
  halfThick: number;
  halfSep: number;
  cornerRadius: number;
}

/** Pre-sample a spiral into world-space cross-section frames.
 *  Only produces samples for thick spirals (thickness > 0). */
export function sampleSpiral(def: SpiralDef, samplesPerTurn: number): SpiralSample[] {
  const thickness = def.thickness;
  if (thickness <= 0) return [];

  const maxTheta = def.turns * Math.PI * 2;
  if (maxTheta < 0.001 || def.endRadius <= 0) return [];

  const N = Math.max(2, Math.round(def.turns * samplesPerTurn));
  const startR = Math.max(def.startRadius, 0.001);
  const endR = Math.max(def.endRadius, startR + 0.001);
  const halfThick = thickness / 2;
  const cornerR = def.cornerRadius;

  const getRadius = (theta: number): number => {
    if (def.spiralType === 'golden') {
      const b = Math.log(endR / startR) / maxTheta;
      return startR * Math.exp(b * theta);
    }
    return startR + (endR - startR) * (theta / maxTheta);
  };

  // The rotation SpiralMesh applies (Euler XYZ, as three's makeRotationFromEuler computes it),
  // row-major, for the local frame vectors.
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = eulerXYZ(def.rotation[0], def.rotation[1], def.rotation[2]);

  const ox = def.position[0], oy = def.position[1], oz = def.position[2];

  const samples: SpiralSample[] = [];
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * maxTheta;
    const r = getRadius(theta);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower);
    const sep = def.separation * taper;

    // Local-space center of the cross-section rectangle
    const lcx = r * cosT;
    const lcy = r * sinT;
    const lcz = sep / 2; // midpoint between z=0 and z=sep

    // Local-space frame:
    // radial direction (thickness axis): (cosT, sinT, 0)
    const lrx = cosT, lry = sinT, lrz = 0;

    // Rotate center + axes to world space
    const wcx = r00*lcx + r01*lcy + r02*lcz + ox;
    const wcy = r10*lcx + r11*lcy + r12*lcz + oy;
    const wcz = r20*lcx + r21*lcy + r22*lcz + oz;

    const wrx = r00*lrx + r01*lry + r02*lrz;
    const wry = r10*lrx + r11*lry + r12*lrz;
    const wrz = r20*lrx + r21*lry + r22*lrz;

    samples.push({
      cx: wcx, cy: wcy, cz: wcz,
      rx: wrx, ry: wry, rz: wrz,
      halfThick,
      halfSep: sep / 2,
      cornerRadius: Math.min(cornerR, Math.min(halfThick, sep / 2)),
    });
  }
  return samples;
}

/** 2D rounded-rectangle SDF.
 *  hx, hy = half-dimensions; r = corner radius (pre-clamped). */
function sdRoundedRect2D(px: number, py: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

/**
 * A thick spiral prepared for evaluation at many points: its samples in typed arrays (three per
 * vector), the smoothed tangent at each sample, each segment's vector, length and direction, and
 * the bounds spiralSDF uses to skip segments. Everything here depends on the spiral alone, so it
 * is computed once per job.
 */
export interface SpiralVolume {
  /** Number of samples. */
  n: number;
  centre: Float64Array;
  radial: Float64Array;
  halfThick: Float64Array;
  halfSep: Float64Array;
  cornerRadius: Float64Array;
  /** Per sample: the average of the directions of its adjacent segments, normalised. */
  tangent: Float64Array;
  /** Per segment (from sample i to i + 1): its vector, its length (0 for a segment shorter than
   *  1e-10, which is skipped) and its unit direction. */
  seg: Float64Array;
  segLen: Float64Array;
  dir: Float64Array;
  /**
   * Per segment: a radius R such that the segment's value at any point p is at least
   * |p - c| - R, c being the point of the segment nearest p. The value is the exact distance to
   * a convex box in an orthonormal frame at c: the rounded rectangle (inside the disc of radius
   * sqrt(halfThick^2 + halfSep^2), whose largest value along the segment is at an end) times the
   * interval [lo, hi] around 0 (inside [-1.5 segLen, 1.5 segLen]). A box inside the ball of
   * radius R about c has distance at least |p - c| - R. Infinity, so never skipped, for a
   * segment whose rectangle is not a valid shape (a negative half-size or corner radius, or a
   * corner radius above a half-size).
   */
  reach: Float64Array;
  maxReach: number;
  /** The sample centres' box. It holds every segment, so dist(p, box) <= |p - c|. */
  box: Box;
}

export function buildSpiralVolume(samples: SpiralSample[]): SpiralVolume {
  const n = samples.length;
  const centre = new Float64Array(3 * n);
  const radial = new Float64Array(3 * n);
  const halfThick = new Float64Array(n);
  const halfSep = new Float64Array(n);
  const cornerRadius = new Float64Array(n);
  samples.forEach((s, i) => {
    centre.set([s.cx, s.cy, s.cz], 3 * i);
    radial.set([s.rx, s.ry, s.rz], 3 * i);
    halfThick[i] = s.halfThick;
    halfSep[i] = s.halfSep;
    cornerRadius[i] = s.cornerRadius;
  });

  // Per-sample smooth tangent (average of adjacent segment dirs)
  const tangent = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    let vx = 0, vy = 0, vz = 0;
    if (i > 0) {
      vx += samples[i].cx - samples[i - 1].cx;
      vy += samples[i].cy - samples[i - 1].cy;
      vz += samples[i].cz - samples[i - 1].cz;
    }
    if (i < n - 1) {
      vx += samples[i + 1].cx - samples[i].cx;
      vy += samples[i + 1].cy - samples[i].cy;
      vz += samples[i + 1].cz - samples[i].cz;
    }
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (len > 1e-10) tangent.set([vx / len, vy / len, vz / len], 3 * i);
  }

  const segments = Math.max(n - 1, 0);
  const seg = new Float64Array(3 * segments);
  const segLen = new Float64Array(segments);
  const dir = new Float64Array(3 * segments);
  for (let i = 0; i < segments; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const segX = b.cx - a.cx;
    const segY = b.cy - a.cy;
    const segZ = b.cz - a.cz;
    const segLen2 = segX * segX + segY * segY + segZ * segZ;
    if (segLen2 < 1e-20) continue;
    const len = Math.sqrt(segLen2);
    seg.set([segX, segY, segZ], 3 * i);
    segLen[i] = len;
    dir.set([segX / len, segY / len, segZ / len], 3 * i);
  }

  const valid = (i: number) =>
    halfThick[i] >= 0 && halfSep[i] >= 0 && cornerRadius[i] >= 0 &&
    cornerRadius[i] <= Math.min(halfThick[i], halfSep[i]);
  const reach = new Float64Array(segments);
  let maxReach = 0;
  for (let i = 0; i < segments; i++) {
    if (segLen[i] === 0) continue;
    if (!valid(i) || !valid(i + 1)) {
      reach[i] = Infinity;
    } else {
      const h2 = Math.max(
        halfThick[i] * halfThick[i] + halfSep[i] * halfSep[i],
        halfThick[i + 1] * halfThick[i + 1] + halfSep[i + 1] * halfSep[i + 1],
      );
      const l = 1.5 * segLen[i];
      reach[i] = Math.sqrt(h2 + l * l);
    }
    maxReach = Math.max(maxReach, reach[i]);
  }
  const box = emptyBox();
  for (const s of samples) expandBox(box, s.cx, s.cy, s.cz);

  return { n, centre, radial, halfThick, halfSep, cornerRadius, tangent, seg, segLen, dir, reach, maxReach, box };
}

/** Signed distance to the swept rounded-rectangle spiral volume.
 *  Per segment: build an orthonormal frame (R, S, T) where T is a smoothly
 *  interpolated tangent (averaged from adjacent segments at each sample, then
 *  lerp'd within the segment — eliminates discrete frame jumps at joints) and
 *  R is Gram-Schmidt'd from the interpolated radial axis against T, S = T × R.
 *  Decompose (query − footpoint) into (localR, localS, localT), compute the
 *  2D rounded-rect SDF d2 in the cross-section plane, the 1D signed distance
 *  dT to the segment's tangent-direction extent, and combine via the IQ 3D
 *  extrude formula. Final value is min over all segments. Allocates nothing.
 *
 *  A caller that only needs the value where it is below `cap` passes that cap: segments
 *  whose bound (SpiralVolume.reach) puts them above both the cap and the minimum so far are
 *  skipped, and so is the whole spiral when its box is that far. The result is then exact
 *  wherever the exact value is below `cap`, and above `cap` elsewhere; min(cap, result) is
 *  always min(cap, exact value). */
export function spiralSDF(x: number, y: number, z: number, v: SpiralVolume, cap = Infinity): number {
  const N = v.n;
  if (N < 2) return Infinity;
  if (boxDistance(v.box, x, y, z) - v.maxReach > cap + BOUND_SLACK) return Infinity;
  const { centre, radial, tangent, seg, segLen: lengths, dir, halfThick: hT, halfSep: hS, cornerRadius: cR, reach } = v;

  let minD = Infinity;

  for (let i = 0; i < N - 1; i++) {
    const segLen = lengths[i];
    if (segLen === 0) continue;
    const a = 3 * i;
    const b = a + 3;
    const segX = seg[a], segY = seg[a + 1], segZ = seg[a + 2];
    const stx = dir[a], sty = dir[a + 1], stz = dir[a + 2];

    // Project query onto segment axis, clamp to [0, 1]
    const dpax = x - centre[a];
    const dpay = y - centre[a + 1];
    const dpaz = z - centre[a + 2];
    const uRaw = dpax * stx + dpay * sty + dpaz * stz;
    const tParam = Math.max(0, Math.min(1, uRaw / segLen));

    // Footpoint on segment at clamped parameter
    const cx = centre[a] + tParam * segX;
    const cy = centre[a + 1] + tParam * segY;
    const cz = centre[a + 2] + tParam * segZ;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;

    // Skip a segment that cannot come below the cap or the minimum so far: its value is at
    // least |p - footpoint| - reach.
    const limit = Math.min(cap, minD) + reach[i] + BOUND_SLACK;
    if (limit < 0 || dx * dx + dy * dy + dz * dz > limit * limit) continue;

    // Smoothly interpolated tangent at footpoint (lerp per-sample tangents)
    let tx = tangent[a] + tParam * (tangent[b] - tangent[a]);
    let ty = tangent[a + 1] + tParam * (tangent[b + 1] - tangent[a + 1]);
    let tz = tangent[a + 2] + tParam * (tangent[b + 2] - tangent[a + 2]);
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tLen < 1e-10) continue;
    tx /= tLen; ty /= tLen; tz /= tLen;

    // Interpolated radial axis
    const irx = radial[a] + tParam * (radial[b] - radial[a]);
    const iry = radial[a + 1] + tParam * (radial[b + 1] - radial[a + 1]);
    const irz = radial[a + 2] + tParam * (radial[b + 2] - radial[a + 2]);
    const rLen = Math.sqrt(irx * irx + iry * iry + irz * irz);
    let nrx = rLen > 1e-10 ? irx / rLen : irx;
    let nry = rLen > 1e-10 ? iry / rLen : iry;
    let nrz = rLen > 1e-10 ? irz / rLen : irz;

    // Gram-Schmidt: R ⊥ T
    const rDotT = nrx * tx + nry * ty + nrz * tz;
    nrx -= rDotT * tx;
    nry -= rDotT * ty;
    nrz -= rDotT * tz;
    const nrLen = Math.sqrt(nrx * nrx + nry * nry + nrz * nrz);
    if (nrLen < 1e-10) continue;
    nrx /= nrLen; nry /= nrLen; nrz /= nrLen;

    // S = T × R
    const nsx = ty * nrz - tz * nry;
    const nsy = tz * nrx - tx * nrz;
    const nsz = tx * nry - ty * nrx;

    // Interpolated half-dimensions and corner radius
    const halfThick = hT[i] + tParam * (hT[i + 1] - hT[i]);
    const halfSep = hS[i] + tParam * (hS[i + 1] - hS[i]);
    const cr = cR[i] + tParam * (cR[i + 1] - cR[i]);

    // Decompose (query − footpoint) into local (R, S, T) frame
    const localR = dx * nrx + dy * nry + dz * nrz;
    const localS = dx * nsx + dy * nsy + dz * nsz;
    const localT = dx * tx + dy * ty + dz * tz;

    // 2D rounded-rect SDF in the cross-section
    const d2 = sdRoundedRect2D(localR, localS, halfThick, halfSep, cr);

    // 1D signed distance from localT to segment extent [lo, hi].
    // Extend interior boundaries by half a segment length so adjacent prisms
    // overlap — eliminates knife-edge gaps at segment joints that cause mesh
    // breaks at low thickness values.
    const ext = 0.5 * segLen;
    const lo = -tParam * segLen - (i > 0 ? ext : 0);
    const hi = (1 - tParam) * segLen + (i < N - 2 ? ext : 0);
    const dT = Math.max(lo - localT, localT - hi);

    // IQ 3D extrude
    const outX = Math.max(d2, 0);
    const outY = Math.max(dT, 0);
    const d = Math.sqrt(outX * outX + outY * outY) + Math.min(Math.max(d2, dT), 0);

    if (d < minD) minD = d;
  }
  return minD;
}
