/**
 * The base primitive. Its path as the editor draws it (baseCurve, sampleBasePath), and the
 * workers' extruded volume: a Catmull-Rom spline of their own, sampled with a world-up frame at
 * each sample, and elliptical slabs across the path at the samples.
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import type { BaseDef } from '../../model/types';
import { samplePath, type PathSamples } from '../path';

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

export interface BaseSample {
  px: number; py: number; pz: number;   // position on spline
  tx: number; ty: number; tz: number;   // tangent (normalized)
  nx: number; ny: number; nz: number;   // world-up stabilized normal
  bx: number; by: number; bz: number;   // binormal = cross(T, N)
  halfH: number;                        // crossSectionHeight / 2
  halfW: number;                        // crossSectionWidth / 2
}

export interface BaseSampleSet {
  samples: BaseSample[];
  /** Half the average inter-sample arc length. Used to bound the cross-section
   *  test along the tangent so points well past the extrusion don't falsely match. */
  halfSpacing: number;
}

export function sampleBaseSpline(base: BaseDef, nSamples: number): BaseSampleSet {
  const pts = base.controlPoints;
  if (pts.length < 2) return { samples: [], halfSpacing: 0 };
  const samples: BaseSample[] = [];
  const segs = pts.length - 1;
  const halfH = base.crossSectionHeight / 2;
  const halfW = base.crossSectionWidth / 2;

  // Small delta for finite-difference tangent
  const DELTA = 0.001;

  for (let i = 0; i < nSamples; i++) {
    const g = i / (nSamples - 1);

    // Helper: Catmull-Rom at parameter gParam
    const catmullRom = (gParam: number): [number, number, number] => {
      const clampedG = Math.max(0, Math.min(1, gParam));
      const seg = Math.min(Math.floor(clampedG * segs), segs - 1);
      const t = clampedG * segs - seg;
      const t2 = t * t;
      const t3 = t2 * t;

      const p0 = pts[Math.max(0, seg - 1)];
      const p1 = pts[seg];
      const p2 = pts[Math.min(pts.length - 1, seg + 1)];
      const p3 = pts[Math.min(pts.length - 1, seg + 2)];

      const x = 0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3);
      const y = 0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3);
      const z = 0.5 * (2*p1[2] + (-p0[2]+p2[2])*t + (2*p0[2]-5*p1[2]+4*p2[2]-p3[2])*t2 + (-p0[2]+3*p1[2]-3*p2[2]+p3[2])*t3);
      return [x, y, z];
    };

    const [px, py, pz] = catmullRom(g);

    // Finite-difference tangent
    const gA = Math.max(0, g - DELTA);
    const gB = Math.min(1, g + DELTA);
    const pA = catmullRom(gA);
    const pB = catmullRom(gB);
    let tx = pB[0] - pA[0];
    let ty = pB[1] - pA[1];
    let tz = pB[2] - pA[2];
    const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz);
    if (tLen > 0.0001) { tx /= tLen; ty /= tLen; tz /= tLen; }
    else { tx = 1; ty = 0; tz = 0; }

    // World-up stabilized normal
    // worldUp = [0, 1, 0]
    // N = normalize(worldUp - dot(worldUp, T)*T)
    const dotUp = ty; // dot([0,1,0], [tx,ty,tz]) = ty
    let nx = 0 - dotUp * tx;
    let ny = 1 - dotUp * ty;
    let nz = 0 - dotUp * tz;
    const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (nLen < 0.001) {
      // Tangent nearly parallel to worldUp — use [1,0,0] fallback
      nx = 1; ny = 0; nz = 0;
    } else {
      nx /= nLen; ny /= nLen; nz /= nLen;
    }

    // Binormal B = cross(T, N)
    let bx = ty * nz - tz * ny;
    let by = tz * nx - tx * nz;
    let bz = tx * ny - ty * nx;
    const bLen = Math.sqrt(bx*bx + by*by + bz*bz);
    if (bLen > 0.0001) { bx /= bLen; by /= bLen; bz /= bLen; }

    samples.push({ px, py, pz, tx, ty, tz, nx, ny, nz, bx, by, bz, halfH, halfW });
  }

  // Compute half the average inter-sample arc length, used to bound cross-section tests.
  let totalLen = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    totalLen += Math.sqrt((b.px - a.px) ** 2 + (b.py - a.py) ** 2 + (b.pz - a.pz) ** 2);
  }
  const halfSpacing = samples.length > 1 ? totalLen / (samples.length - 1) / 2 : 0;

  return { samples, halfSpacing };
}

/** Signed distance to the base extrusion (approximate elliptical cross-section SDF). */
export function baseSDF(x: number, y: number, z: number, baseSet: BaseSampleSet): number {
  let minD = Infinity;
  const tangentLimit = baseSet.halfSpacing * 1.5;

  for (const s of baseSet.samples) {
    const toPx = x - s.px;
    const toPy = y - s.py;
    const toPz = z - s.pz;

    const along = toPx * s.tx + toPy * s.ty + toPz * s.tz;
    if (Math.abs(along) > tangentLimit) continue;

    const localN = toPx * s.nx + toPy * s.ny + toPz * s.nz;
    const localB = toPx * s.bx + toPy * s.by + toPz * s.bz;

    // Approximate ellipse SDF: normalized distance - 1, scaled back
    const ellipDist = Math.sqrt(
      (localN / s.halfH) * (localN / s.halfH) +
      (localB / s.halfW) * (localB / s.halfW)
    );
    const d = (ellipDist - 1.0) * Math.min(s.halfH, s.halfW);
    minD = Math.min(minD, d);
  }
  return minD;
}

export function insideBaseExtrusion(x: number, y: number, z: number, baseSet: BaseSampleSet, inset: number): boolean {
  const tangentLimit = baseSet.halfSpacing * 1.5;
  for (const s of baseSet.samples) {
    const toPx = x - s.px;
    const toPy = y - s.py;
    const toPz = z - s.pz;
    const along = toPx * s.tx + toPy * s.ty + toPz * s.tz;
    if (Math.abs(along) > tangentLimit) continue;
    const localN = toPx * s.nx + toPy * s.ny + toPz * s.nz;
    const localB = toPx * s.bx + toPy * s.by + toPz * s.bz;
    const ellipDist = Math.sqrt((localN / s.halfH) * (localN / s.halfH) + (localB / s.halfW) * (localB / s.halfW));
    if (ellipDist < inset) return true;
  }
  return false;
}
