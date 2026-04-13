/**
 * Surface Mesh Web Worker
 *
 * Generates a unified homogeneous triangle mesh over the entire cloud surface
 * by evaluating a signed distance field (SDF) representing the boolean union
 * of all solid primitives (spheres, base, tail, flow cloud isosurface) and
 * running marching cubes on it.
 *
 * The SDF approach guarantees uniform mesh topology — the same grid pattern
 * as the flow cloud's marching cubes output, but covering everything.
 *
 * Input: { spheres, base, tail, flowCloud, spirals, resolution }
 * Output: { positions: Float32Array, indices: Uint32Array }
 */

import type { SphereDef, BaseDef, TailDef, FlowCloudSettings, SpiralDef } from '../types/cloud';

// [DEBUG_SPIRAL] top-level boot marker — if you don't see this in the console,
// the worker file wasn't loaded (likely stale HMR — hard reload the page).
console.log('[spiralSDF debug] surfaceMesh.worker.ts LOADED at', new Date().toISOString());

// ---------------------------------------------------------------------------
// Spline sampling (same algorithms as cutAndGlue.worker.ts)
// ---------------------------------------------------------------------------

interface TailSample {
  px: number; py: number; pz: number;
  width: number;
}

interface BaseSample {
  px: number; py: number; pz: number;
  tx: number; ty: number; tz: number;
  nx: number; ny: number; nz: number;
  bx: number; by: number; bz: number;
  halfH: number;
  halfW: number;
}

interface BaseSampleSet {
  samples: BaseSample[];
  halfSpacing: number;
}

function sampleTailSpline(tail: TailDef, nSamples: number): TailSample[] {
  const pts = tail.setpoints;
  if (pts.length < 2) return [];
  const samples: TailSample[] = [];
  const segs = pts.length - 1;

  for (let i = 0; i < nSamples; i++) {
    const g = i / (nSamples - 1);
    const seg = Math.min(Math.floor(g * segs), segs - 1);
    const t = g * segs - seg;
    const t2 = t * t;
    const t3 = t2 * t;

    const p0 = pts[Math.max(0, seg - 1)];
    const p1 = pts[seg];
    const p2 = pts[Math.min(pts.length - 1, seg + 1)];
    const p3 = pts[Math.min(pts.length - 1, seg + 2)];

    const px = 0.5 * (2*p1.position[0] + (-p0.position[0]+p2.position[0])*t + (2*p0.position[0]-5*p1.position[0]+4*p2.position[0]-p3.position[0])*t2 + (-p0.position[0]+3*p1.position[0]-3*p2.position[0]+p3.position[0])*t3);
    const py = 0.5 * (2*p1.position[1] + (-p0.position[1]+p2.position[1])*t + (2*p0.position[1]-5*p1.position[1]+4*p2.position[1]-p3.position[1])*t2 + (-p0.position[1]+3*p1.position[1]-3*p2.position[1]+p3.position[1])*t3);
    const pz = 0.5 * (2*p1.position[2] + (-p0.position[2]+p2.position[2])*t + (2*p0.position[2]-5*p1.position[2]+4*p2.position[2]-p3.position[2])*t2 + (-p0.position[2]+3*p1.position[2]-3*p2.position[2]+p3.position[2])*t3);

    const width = p1.width + t * (p2.width - p1.width);
    samples.push({ px, py, pz, width });
  }
  return samples;
}

function sampleBaseSpline(base: BaseDef, nSamples: number): BaseSampleSet {
  const pts = base.controlPoints;
  if (pts.length < 2) return { samples: [], halfSpacing: 0 };
  const samples: BaseSample[] = [];
  const segs = pts.length - 1;
  const halfH = base.crossSectionHeight / 2;
  const halfW = base.crossSectionWidth / 2;

  const DELTA = 0.001;

  for (let i = 0; i < nSamples; i++) {
    const g = i / (nSamples - 1);

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

    const dotUp = ty;
    let nx = 0 - dotUp * tx;
    let ny = 1 - dotUp * ty;
    let nz = 0 - dotUp * tz;
    const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (nLen < 0.001) {
      nx = 1; ny = 0; nz = 0;
    } else {
      nx /= nLen; ny /= nLen; nz /= nLen;
    }

    let bx = ty * nz - tz * ny;
    let by = tz * nx - tx * nz;
    let bz = tx * ny - ty * nx;
    const bLen = Math.sqrt(bx*bx + by*by + bz*bz);
    if (bLen > 0.0001) { bx /= bLen; by /= bLen; bz /= bLen; }

    samples.push({ px, py, pz, tx, ty, tz, nx, ny, nz, bx, by, bz, halfH, halfW });
  }

  let totalLen = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    totalLen += Math.sqrt((b.px - a.px) ** 2 + (b.py - a.py) ** 2 + (b.pz - a.pz) ** 2);
  }
  const halfSpacing = samples.length > 1 ? totalLen / (samples.length - 1) / 2 : 0;

  return { samples, halfSpacing };
}

// ---------------------------------------------------------------------------
// SDF functions
// ---------------------------------------------------------------------------

/** Signed distance to a sphere/ellipsoid surface (approximate for ellipsoids).
 *  Matches the containment geometry used in cutAndGlue.worker.ts. */
function sphereSDF(x: number, y: number, z: number, sw: SphereDef): number {
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

/** Signed distance to the tail capsule chain. */
function tailSDF(x: number, y: number, z: number, tailSamples: TailSample[]): number {
  let minD = Infinity;
  for (let i = 0; i < tailSamples.length - 1; i++) {
    const a = tailSamples[i];
    const b = tailSamples[i + 1];
    const abx = b.px - a.px;
    const aby = b.py - a.py;
    const abz = b.pz - a.pz;
    const ab2 = abx * abx + aby * aby + abz * abz;
    let param = 0;
    if (ab2 > 0.0001) {
      param = ((x - a.px) * abx + (y - a.py) * aby + (z - a.pz) * abz) / ab2;
      param = Math.max(0, Math.min(1, param));
    }
    const cx = a.px + param * abx;
    const cy = a.py + param * aby;
    const cz = a.pz + param * abz;
    const r = a.width + (b.width - a.width) * param;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    minD = Math.min(minD, dist - r);
  }
  return minD;
}

/** Signed distance to the base extrusion (approximate elliptical cross-section SDF). */
function baseSDF(x: number, y: number, z: number, baseSet: BaseSampleSet): number {
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

/** Metaball field evaluation (same formula as marchingCubes.worker.ts evalField).
 *  Used for the flow cloud SDF: sdf = threshold - field. */
function evalMetaballField(
  x: number, y: number, z: number,
  spheres: SphereDef[],
  tailSamples: TailSample[],
  tailStrength: number
): number {
  let val = 0;

  for (const sw of spheres) {
    let dx = x - sw.position[0];
    let dy = y - sw.position[1];
    let dz = z - sw.position[2];

    if (sw.shape === 'ellipsoid') {
      dx /= (sw.scale?.[0] ?? 1);
      dy /= (sw.scale?.[1] ?? 1);
      dz /= (sw.scale?.[2] ?? 1);
    }

    const dist2 = dx * dx + dy * dy + dz * dz;
    const r2 = sw.radius * sw.radius;
    if (dist2 < 0.0001) {
      val += (sw.falloff ?? 0.5) * 100;
    } else {
      val += (sw.falloff ?? 0.5) * r2 / dist2;
    }
  }

  if (tailSamples.length >= 2 && tailStrength > 0) {
    let minDist2 = Infinity;
    let minRadius = 0;

    for (let i = 0; i < tailSamples.length - 1; i++) {
      const a = tailSamples[i];
      const b = tailSamples[i + 1];
      const abx = b.px - a.px, aby = b.py - a.py, abz = b.pz - a.pz;
      const ab2 = abx * abx + aby * aby + abz * abz;
      const apx = x - a.px, apy = y - a.py, apz = z - a.pz;
      const t = ab2 > 0.00001 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0;
      const cx = a.px + t * abx, cy = a.py + t * aby, cz = a.pz + t * abz;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
      if (d2 < minDist2) {
        minDist2 = d2;
        minRadius = a.width + t * (b.width - a.width);
      }
    }

    const r2 = minRadius * minRadius;
    val += tailStrength * (minDist2 < 0.0001 ? 100 * r2 : r2 / minDist2);
  }

  return val;
}

// ---------------------------------------------------------------------------
// Spiral SDF — swept rounded-rectangle along a parametric spiral path
// ---------------------------------------------------------------------------

interface SpiralSample {
  cx: number; cy: number; cz: number;   // center (world space)
  rx: number; ry: number; rz: number;   // radial direction (world)
  sx: number; sy: number; sz: number;   // separation direction (world)
  halfThick: number;
  halfSep: number;
  cornerRadius: number;
}

/** Pre-sample a spiral into world-space cross-section frames.
 *  Only produces samples for thick spirals (thickness > 0). */
function sampleSpiral(def: SpiralDef, samplesPerTurn: number): SpiralSample[] {
  const thickness = def.thickness ?? 0;
  if (thickness <= 0) return [];

  const maxTheta = def.turns * Math.PI * 2;
  if (maxTheta < 0.001 || def.endRadius <= 0) return [];

  const N = Math.max(2, Math.round(def.turns * samplesPerTurn));
  const startR = Math.max(def.startRadius, 0.001);
  const endR = Math.max(def.endRadius, startR + 0.001);
  const halfThick = thickness / 2;
  const cornerR = def.cornerRadius ?? 0;

  const getRadius = (theta: number): number => {
    if (def.spiralType === 'golden') {
      const b = Math.log(endR / startR) / maxTheta;
      return startR * Math.exp(b * theta);
    }
    return startR + (endR - startR) * (theta / maxTheta);
  };

  // Build rotation matrix from Euler XYZ
  // We need to rotate the local frame vectors, so build 3x3 rotation from the Euler angles.
  const rx = def.rotation[0], ry = def.rotation[1], rz = def.rotation[2];
  const cx1 = Math.cos(rx), sx1 = Math.sin(rx);
  const cy1 = Math.cos(ry), sy1 = Math.sin(ry);
  const cz1 = Math.cos(rz), sz1 = Math.sin(rz);
  // Rotation matrix (Euler XYZ) columns:
  const r00 = cy1*cz1, r01 = -cy1*sz1, r02 = sy1;
  const r10 = sx1*sy1*cz1 + cx1*sz1, r11 = -sx1*sy1*sz1 + cx1*cz1, r12 = -sx1*cy1;
  const r20 = -cx1*sy1*cz1 + sx1*sz1, r21 = cx1*sy1*sz1 + sx1*cz1, r22 = cx1*cy1;

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
    // separation direction: (0, 0, 1)
    const lrx = cosT, lry = sinT, lrz = 0;
    const lsx = 0, lsy = 0, lsz = 1;

    // Rotate center + axes to world space
    const wcx = r00*lcx + r01*lcy + r02*lcz + ox;
    const wcy = r10*lcx + r11*lcy + r12*lcz + oy;
    const wcz = r20*lcx + r21*lcy + r22*lcz + oz;

    const wrx = r00*lrx + r01*lry + r02*lrz;
    const wry = r10*lrx + r11*lry + r12*lrz;
    const wrz = r20*lrx + r21*lry + r22*lrz;

    const wsx = r00*lsx + r01*lsy + r02*lsz;
    const wsy = r10*lsx + r11*lsy + r12*lsz;
    const wsz = r20*lsx + r21*lsy + r22*lsz;

    samples.push({
      cx: wcx, cy: wcy, cz: wcz,
      rx: wrx, ry: wry, rz: wrz,
      sx: wsx, sy: wsy, sz: wsz,
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

/** Signed distance to the swept rounded-rectangle spiral volume.
 *  Per segment: build an orthonormal frame (R, S, T) where T is a smoothly
 *  interpolated tangent (averaged from adjacent segments at each sample, then
 *  lerp'd within the segment — eliminates discrete frame jumps at joints) and
 *  R is Gram-Schmidt'd from the interpolated radial axis against T, S = T × R.
 *  Decompose (query − footpoint) into (localR, localS, localT), compute the
 *  2D rounded-rect SDF d2 in the cross-section plane, the 1D signed distance
 *  dT to the segment's tangent-direction extent, and combine via the IQ 3D
 *  extrude formula. Final value is min over all segments. */
function spiralSDF(x: number, y: number, z: number, samples: SpiralSample[]): number {
  const N = samples.length;
  if (N < 2) return Infinity;

  // Precompute per-sample smooth tangent (average of adjacent segment dirs)
  const smTx = new Float64Array(N);
  const smTy = new Float64Array(N);
  const smTz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let vx = 0, vy = 0, vz = 0;
    if (i > 0) {
      vx += samples[i].cx - samples[i - 1].cx;
      vy += samples[i].cy - samples[i - 1].cy;
      vz += samples[i].cz - samples[i - 1].cz;
    }
    if (i < N - 1) {
      vx += samples[i + 1].cx - samples[i].cx;
      vy += samples[i + 1].cy - samples[i].cy;
      vz += samples[i + 1].cz - samples[i].cz;
    }
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (len > 1e-10) { smTx[i] = vx / len; smTy[i] = vy / len; smTz[i] = vz / len; }
  }

  let minD = Infinity;

  for (let i = 0; i < N - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];

    // Segment direction and length (for projection + extent)
    const segX = b.cx - a.cx;
    const segY = b.cy - a.cy;
    const segZ = b.cz - a.cz;
    const segLen2 = segX * segX + segY * segY + segZ * segZ;
    if (segLen2 < 1e-20) continue;
    const segLen = Math.sqrt(segLen2);
    const stx = segX / segLen;
    const sty = segY / segLen;
    const stz = segZ / segLen;

    // Project query onto segment axis, clamp to [0, 1]
    const dpax = x - a.cx;
    const dpay = y - a.cy;
    const dpaz = z - a.cz;
    const uRaw = dpax * stx + dpay * sty + dpaz * stz;
    const tParam = Math.max(0, Math.min(1, uRaw / segLen));

    // Footpoint on segment at clamped parameter
    const cx = a.cx + tParam * segX;
    const cy = a.cy + tParam * segY;
    const cz = a.cz + tParam * segZ;

    // Smoothly interpolated tangent at footpoint (lerp per-sample tangents)
    let tx = smTx[i] + tParam * (smTx[i + 1] - smTx[i]);
    let ty = smTy[i] + tParam * (smTy[i + 1] - smTy[i]);
    let tz = smTz[i] + tParam * (smTz[i + 1] - smTz[i]);
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tLen < 1e-10) continue;
    tx /= tLen; ty /= tLen; tz /= tLen;

    // Interpolated radial axis
    const irx = a.rx + tParam * (b.rx - a.rx);
    const iry = a.ry + tParam * (b.ry - a.ry);
    const irz = a.rz + tParam * (b.rz - a.rz);
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
    const halfThick = a.halfThick + tParam * (b.halfThick - a.halfThick);
    const halfSep = a.halfSep + tParam * (b.halfSep - a.halfSep);
    const cr = a.cornerRadius + tParam * (b.cornerRadius - a.cornerRadius);

    // Decompose (query − footpoint) into local (R, S, T) frame
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
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

/** Combined SDF: boolean union of all primitives.
 *  Returns negative inside the cloud, positive outside.
 *  flowCloudPos offsets the metaball field to world space. */
function evalSDF(
  x: number, y: number, z: number,
  spheres: SphereDef[],
  tailSamples: TailSample[],
  baseSet: BaseSampleSet,
  flowCloud: FlowCloudSettings,
  fcTailSamples: TailSample[],
  allSpiralSamples: SpiralSample[][],
): number {
  let d = Infinity;

  // Sphere SDFs (geometric radius, not metaball)
  for (const sw of spheres) {
    d = Math.min(d, sphereSDF(x, y, z, sw));
  }

  // Tail SDF
  if (tailSamples.length >= 2) {
    d = Math.min(d, tailSDF(x, y, z, tailSamples));
  }

  // Base SDF
  if (baseSet.samples.length > 0) {
    d = Math.min(d, baseSDF(x, y, z, baseSet));
  }

  // Flow cloud SDF: threshold - metaball field
  // Transform point to flow cloud local space (subtract position offset)
  const fcPos = flowCloud.position ?? [0, 0, 0];
  const localX = x - fcPos[0];
  const localY = y - fcPos[1];
  const localZ = z - fcPos[2];
  const tailStrength = flowCloud.tailStrength ?? 0;
  const field = evalMetaballField(localX, localY, localZ, spheres, fcTailSamples, tailStrength);
  const flowCloudD = (flowCloud.threshold - field);
  // flowCloudD is negative inside the isosurface (field > threshold)
  d = Math.min(d, flowCloudD);

  // Spiral SDFs (thick spirals only — flat ribbons have no volume)
  for (const samples of allSpiralSamples) {
    if (samples.length > 0) {
      d = Math.min(d, spiralSDF(x, y, z, samples));
    }
  }

  return d;
}

// ---------------------------------------------------------------------------
// Marching Cubes (same algorithm as marchingCubes.worker.ts)
// ---------------------------------------------------------------------------

const EDGE_PAIRS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7]
];

// Full triTable (256 x 16, -1 terminated) — Lorensen & Cline, public domain
const TRI_TABLE = [
  [-1],
  [0,8,3,-1],
  [0,1,9,-1],
  [1,8,3,9,8,1,-1],
  [1,2,10,-1],
  [0,8,3,1,2,10,-1],
  [9,2,10,0,2,9,-1],
  [2,8,3,2,10,8,10,9,8,-1],
  [3,11,2,-1],
  [0,11,2,8,11,0,-1],
  [1,9,0,2,3,11,-1],
  [1,11,2,1,9,11,9,8,11,-1],
  [3,10,1,11,10,3,-1],
  [0,10,1,0,8,10,8,11,10,-1],
  [3,9,0,3,11,9,11,10,9,-1],
  [9,8,10,10,8,11,-1],
  [4,7,8,-1],
  [4,3,0,7,3,4,-1],
  [0,1,9,8,4,7,-1],
  [4,1,9,4,7,1,7,3,1,-1],
  [1,2,10,8,4,7,-1],
  [3,4,7,3,0,4,1,2,10,-1],
  [9,2,10,9,0,2,8,4,7,-1],
  [2,10,9,2,9,7,2,7,3,7,9,4,-1],
  [8,4,7,3,11,2,-1],
  [11,4,7,11,2,4,2,0,4,-1],
  [9,0,1,8,4,7,2,3,11,-1],
  [4,7,11,9,4,11,9,11,2,9,2,1,-1],
  [3,10,1,3,11,10,7,8,4,-1],
  [1,11,10,1,4,11,1,0,4,7,11,4,-1],
  [4,7,8,9,0,11,9,11,10,11,0,3,-1],
  [4,7,11,4,11,9,9,11,10,-1],
  [9,5,4,-1],
  [9,5,4,0,8,3,-1],
  [0,5,4,1,5,0,-1],
  [8,5,4,8,3,5,3,1,5,-1],
  [1,2,10,9,5,4,-1],
  [3,0,8,1,2,10,4,9,5,-1],
  [5,2,10,5,4,2,4,0,2,-1],
  [2,10,5,3,2,5,3,5,4,3,4,8,-1],
  [9,5,4,2,3,11,-1],
  [0,11,2,0,8,11,4,9,5,-1],
  [0,5,4,0,1,5,2,3,11,-1],
  [2,1,5,2,5,8,2,8,11,4,8,5,-1],
  [10,3,11,10,1,3,9,5,4,-1],
  [4,9,5,0,8,1,8,10,1,8,11,10,-1],
  [5,4,0,5,0,11,5,11,10,11,0,3,-1],
  [5,4,8,5,8,10,10,8,11,-1],
  [9,7,8,5,7,9,-1],
  [9,3,0,9,5,3,5,7,3,-1],
  [0,7,8,0,1,7,1,5,7,-1],
  [1,5,3,3,5,7,-1],
  [9,7,8,9,5,7,10,1,2,-1],
  [10,1,2,9,5,0,5,3,0,5,7,3,-1],
  [8,0,2,8,2,5,8,5,7,10,5,2,-1],
  [2,10,5,2,5,3,3,5,7,-1],
  [7,9,5,7,8,9,3,11,2,-1],
  [9,5,7,9,7,2,9,2,0,2,7,11,-1],
  [2,3,11,0,1,8,1,7,8,1,5,7,-1],
  [11,2,1,11,1,7,7,1,5,-1],
  [9,5,8,8,5,7,10,1,3,10,3,11,-1],
  [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,-1],
  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,-1],
  [11,10,5,7,11,5,-1],
  [10,6,5,-1],
  [0,8,3,5,10,6,-1],
  [9,0,1,5,10,6,-1],
  [1,8,3,1,9,8,5,10,6,-1],
  [1,6,5,2,6,1,-1],
  [1,6,5,1,2,6,3,0,8,-1],
  [9,6,5,9,0,6,0,2,6,-1],
  [5,9,8,5,8,2,5,2,6,3,2,8,-1],
  [2,3,11,10,6,5,-1],
  [11,0,8,11,2,0,10,6,5,-1],
  [0,1,9,2,3,11,5,10,6,-1],
  [5,10,6,1,9,2,9,11,2,9,8,11,-1],
  [6,3,11,6,5,3,5,1,3,-1],
  [0,8,11,0,11,5,0,5,1,5,11,6,-1],
  [3,11,6,0,3,6,0,6,5,0,5,9,-1],
  [6,5,9,6,9,11,11,9,8,-1],
  [5,10,6,4,7,8,-1],
  [4,3,0,4,7,3,6,5,10,-1],
  [1,9,0,5,10,6,8,4,7,-1],
  [10,6,5,1,9,7,1,7,3,7,9,4,-1],
  [6,1,2,6,5,1,4,7,8,-1],
  [1,2,5,5,2,6,3,0,4,3,4,7,-1],
  [8,4,7,9,0,5,0,6,5,0,2,6,-1],
  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,-1],
  [3,11,2,7,8,4,10,6,5,-1],
  [5,10,6,4,7,2,4,2,0,2,7,11,-1],
  [0,1,9,4,7,8,2,3,11,5,10,6,-1],
  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,-1],
  [8,4,7,3,11,5,3,5,1,5,11,6,-1],
  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,-1],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,-1],
  [6,5,9,6,9,11,4,7,9,7,11,9,-1],
  [10,4,9,6,4,10,-1],
  [4,10,6,4,9,10,0,8,3,-1],
  [10,0,1,10,6,0,6,4,0,-1],
  [8,3,1,8,1,6,8,6,4,6,1,10,-1],
  [1,4,9,1,2,4,2,6,4,-1],
  [3,0,8,1,2,9,2,4,9,2,6,4,-1],
  [0,2,4,4,2,6,-1],
  [8,3,2,8,2,4,4,2,6,-1],
  [10,4,9,10,6,4,11,2,3,-1],
  [0,8,2,2,8,11,4,9,10,4,10,6,-1],
  [3,11,2,0,1,6,0,6,4,6,1,10,-1],
  [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,-1],
  [9,6,4,9,3,6,9,1,3,11,6,3,-1],
  [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,-1],
  [3,11,6,3,6,0,0,6,4,-1],
  [6,4,8,11,6,8,-1],
  [7,10,6,7,8,10,8,9,10,-1],
  [0,7,3,0,10,7,0,9,10,6,7,10,-1],
  [10,6,7,1,10,7,1,7,8,1,8,0,-1],
  [10,6,7,10,7,1,1,7,3,-1],
  [1,2,6,1,6,8,1,8,9,8,6,7,-1],
  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,-1],
  [7,8,0,7,0,6,6,0,2,-1],
  [7,3,2,6,7,2,-1],
  [2,3,11,10,6,8,10,8,9,8,6,7,-1],
  [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,-1],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,-1],
  [11,2,1,11,1,7,10,6,1,6,7,1,-1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,-1],
  [0,9,1,11,6,7,-1],
  [7,8,0,7,0,6,3,11,0,11,6,0,-1],
  [7,11,6,-1],
  [7,6,11,-1],
  [3,0,8,11,7,6,-1],
  [0,1,9,11,7,6,-1],
  [8,1,9,8,3,1,11,7,6,-1],
  [10,1,2,6,11,7,-1],
  [1,2,10,3,0,8,6,11,7,-1],
  [2,9,0,2,10,9,6,11,7,-1],
  [6,11,7,2,10,3,10,8,3,10,9,8,-1],
  [7,2,3,6,2,7,-1],
  [7,0,8,7,6,0,6,2,0,-1],
  [2,7,6,2,3,7,0,1,9,-1],
  [1,6,2,1,8,6,1,9,8,8,7,6,-1],
  [10,7,6,10,1,7,1,3,7,-1],
  [10,7,6,1,7,10,1,8,7,1,0,8,-1],
  [0,3,7,0,7,10,0,10,9,6,10,7,-1],
  [7,6,10,7,10,8,8,10,9,-1],
  [6,8,4,11,8,6,-1],
  [3,6,11,3,0,6,0,4,6,-1],
  [8,6,11,8,4,6,9,0,1,-1],
  [9,4,6,9,6,3,9,3,1,11,3,6,-1],
  [6,8,4,6,11,8,2,10,1,-1],
  [1,2,10,3,0,11,0,6,11,0,4,6,-1],
  [4,11,8,4,6,11,0,2,9,2,10,9,-1],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,-1],
  [8,2,3,8,4,2,4,6,2,-1],
  [0,4,2,4,6,2,-1],
  [1,9,0,2,3,4,2,4,6,4,3,8,-1],
  [1,9,4,1,4,2,2,4,6,-1],
  [8,1,3,8,6,1,8,4,6,6,10,1,-1],
  [10,1,0,10,0,6,6,0,4,-1],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,-1],
  [10,9,4,6,10,4,-1],
  [4,9,5,7,6,11,-1],
  [0,8,3,4,9,5,11,7,6,-1],
  [5,0,1,5,4,0,7,6,11,-1],
  [11,7,6,8,3,4,3,5,4,3,1,5,-1],
  [9,5,4,10,1,2,7,6,11,-1],
  [6,11,7,1,2,10,0,8,3,4,9,5,-1],
  [7,6,11,5,4,10,4,2,10,4,0,2,-1],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,-1],
  [7,2,3,7,6,2,5,4,9,-1],
  [9,5,4,0,8,6,0,6,2,6,8,7,-1],
  [3,6,2,3,7,6,1,5,0,5,4,0,-1],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,-1],
  [9,5,4,10,1,6,1,7,6,1,3,7,-1],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,-1],
  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,-1],
  [7,6,10,7,10,8,5,4,10,4,8,10,-1],
  [6,9,5,6,11,9,11,8,9,-1],
  [3,6,11,0,6,3,0,5,6,0,9,5,-1],
  [0,11,8,0,5,11,0,1,5,5,6,11,-1],
  [6,11,3,6,3,5,5,3,1,-1],
  [1,2,10,9,5,11,9,11,8,11,5,6,-1],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,-1],
  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,-1],
  [6,11,3,6,3,5,2,10,3,10,5,3,-1],
  [5,8,9,5,2,8,5,6,2,3,8,2,-1],
  [9,5,6,9,6,0,0,6,2,-1],
  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,-1],
  [1,5,6,2,1,6,-1],
  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,-1],
  [10,1,0,10,0,6,9,5,0,5,6,0,-1],
  [0,3,8,5,6,10,-1],
  [10,5,6,-1],
  [11,5,10,7,5,11,-1],
  [11,5,10,11,7,5,8,3,0,-1],
  [5,11,7,5,10,11,1,9,0,-1],
  [10,7,5,10,11,7,9,8,1,8,3,1,-1],
  [11,1,2,11,7,1,7,5,1,-1],
  [0,8,3,1,2,7,1,7,5,7,2,11,-1],
  [9,7,5,9,2,7,9,0,2,2,11,7,-1],
  [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,-1],
  [2,5,10,2,3,5,3,7,5,-1],
  [8,2,0,8,5,2,8,7,5,10,2,5,-1],
  [9,0,1,2,3,5,2,5,10,5,3,7,-1],
  [8,2,9,8,9,7,2,10,9,5,9,3,10,3,9,-1],
  [1,7,5,1,3,7,-1],
  [1,7,5,1,0,7,0,8,7,-1],
  [9,0,3,9,3,5,5,3,7,-1],
  [9,8,7,5,9,7,-1],
  [5,8,4,5,10,8,10,11,8,-1],
  [5,0,4,5,11,0,5,10,11,11,3,0,-1],
  [0,1,9,8,4,10,8,10,11,10,4,5,-1],
  [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,-1],
  [2,5,1,2,8,5,2,11,8,4,5,8,-1],
  [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,-1],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,-1],
  [9,4,5,2,11,3,-1],
  [2,5,10,3,5,2,3,4,5,3,8,4,-1],
  [5,10,2,5,2,4,4,2,0,-1],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,-1],
  [5,10,2,5,2,4,1,9,2,9,4,2,-1],
  [8,4,5,8,5,3,3,5,1,-1],
  [0,4,5,1,0,5,-1],
  [8,4,5,8,5,3,9,0,5,0,3,5,-1],
  [9,4,5,-1],
  [4,11,7,4,9,11,9,10,11,-1],
  [0,8,3,4,9,7,9,11,7,9,10,11,-1],
  [1,10,11,1,11,4,1,4,0,7,4,11,-1],
  [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,-1],
  [4,11,7,9,11,4,9,2,11,9,1,2,-1],
  [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,-1],
  [11,7,4,11,4,2,2,4,0,-1],
  [11,7,4,11,4,2,8,3,4,3,2,4,-1],
  [2,9,10,2,7,9,2,3,7,7,4,9,-1],
  [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,-1],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,-1],
  [1,10,2,8,7,4,-1],
  [4,9,1,4,1,7,7,1,3,-1],
  [4,9,1,4,1,7,0,8,1,8,7,1,-1],
  [4,0,3,7,4,3,-1],
  [4,8,7,-1],
  [9,10,8,10,11,8,-1],
  [3,0,9,3,9,11,11,9,10,-1],
  [0,1,10,0,10,8,8,10,11,-1],
  [3,1,10,11,3,10,-1],
  [1,2,11,1,11,9,9,11,8,-1],
  [3,0,9,3,9,11,1,2,9,2,11,9,-1],
  [0,2,11,8,0,11,-1],
  [3,2,11,-1],
  [2,3,8,2,8,10,10,8,9,-1],
  [9,10,2,0,9,2,-1],
  [2,3,8,2,8,10,0,1,8,1,10,8,-1],
  [1,10,2,-1],
  [1,3,8,9,1,8,-1],
  [0,9,1,-1],
  [0,3,8,-1],
  [-1],
];

function interp(
  ax: number, ay: number, az: number, aval: number,
  bx: number, by: number, bz: number, bval: number
): [number, number, number] {
  // Threshold is 0 for SDF
  if (Math.abs(aval) < 0.00001) return [ax, ay, az];
  if (Math.abs(bval) < 0.00001) return [bx, by, bz];
  if (Math.abs(aval - bval) < 0.00001) return [ax, ay, az];
  const t = -aval / (bval - aval);  // solve for aval + t*(bval - aval) = 0
  return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
}

// ---------------------------------------------------------------------------
// Main surface mesh generation
// ---------------------------------------------------------------------------

interface SMInput {
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  flowCloud: FlowCloudSettings;
  spirals: SpiralDef[];
  resolution: number;
}

function generateSurfaceMesh(input: SMInput): { positions: Float32Array; indices: Uint32Array } {
  const { spheres, base, tail, flowCloud, spirals, resolution } = input;
  const res = resolution;

  // [DEBUG_SPIRAL] Temporary instrumentation — REMOVE after Phase 9 spiral SDF bug fix.
  const DEBUG_SPIRAL = (spirals ?? []).some((sp) => (sp.thickness ?? 0) > 0);
  if (DEBUG_SPIRAL) {
    console.log('[spiralSDF debug] === generateSurfaceMesh start ===');
    console.log('[spiralSDF debug] input:', {
      sphereCount: spheres.length,
      spiralCount: spirals?.length ?? 0,
      resolution,
      firstSpiral: spirals?.find((sp) => (sp.thickness ?? 0) > 0),
    });
  }

  // Sample splines
  const tailSamples = sampleTailSpline(tail, 64);
  const baseSet = sampleBaseSpline(base, 64);

  // Tail samples for the metaball field (flow cloud SDF component)
  const tailStrength = flowCloud.tailStrength ?? 0;
  const fcTailSamples = tailStrength > 0 ? sampleTailSpline(tail, 32) : [];

  // Sample spirals (only thick ones produce samples)
  const allSpiralSamples: SpiralSample[][] = (spirals ?? []).map(
    (sp) => sampleSpiral(sp, 64)
  );

  if (DEBUG_SPIRAL) {
    console.log('[spiralSDF debug] samples per spiral:', allSpiralSamples.map((s) => s.length));
    const firstSamples = allSpiralSamples.find((s) => s.length > 0);
    if (firstSamples) {
      const s0 = firstSamples[0];
      console.log('[spiralSDF debug] first sample:', {
        center: [s0.cx, s0.cy, s0.cz],
        radial: [s0.rx, s0.ry, s0.rz],
        separation: [s0.sx, s0.sy, s0.sz],
        halfThick: s0.halfThick,
        halfSep: s0.halfSep,
        cornerRadius: s0.cornerRadius,
      });
      console.log('[spiralSDF debug] radial dot separation (should be ≈ 0):',
        s0.rx * s0.sx + s0.ry * s0.sy + s0.rz * s0.sz);
      console.log('[spiralSDF debug] radial magnitude (should be ≈ 1):',
        Math.sqrt(s0.rx * s0.rx + s0.ry * s0.ry + s0.rz * s0.rz));
      console.log('[spiralSDF debug] separation magnitude (should be ≈ 1):',
        Math.sqrt(s0.sx * s0.sx + s0.sy * s0.sy + s0.sz * s0.sz));
    }
  }

  // Compute bounding box from all primitives
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const expandBounds = (x: number, y: number, z: number, pad: number) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    minZ = Math.min(minZ, z - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
    maxZ = Math.max(maxZ, z + pad);
  };

  // Spheres
  for (const sw of spheres) {
    const maxScale = Math.max(sw.scale?.[0] ?? 1, sw.scale?.[1] ?? 1, sw.scale?.[2] ?? 1);
    expandBounds(sw.position[0], sw.position[1], sw.position[2], sw.radius * maxScale + 0.5);
  }

  // Tail setpoints
  for (const sp of tail.setpoints) {
    expandBounds(sp.position[0], sp.position[1], sp.position[2], sp.width + 0.5);
  }

  // Base control points
  const baseHalf = Math.max(base.crossSectionWidth, base.crossSectionHeight) / 2;
  for (const cp of base.controlPoints) {
    expandBounds(cp[0], cp[1], cp[2], baseHalf + 0.5);
  }

  // Flow cloud: sphere positions shifted by flowCloud.position
  const fcPos = flowCloud.position ?? [0, 0, 0];
  for (const sw of spheres) {
    const maxScale = Math.max(sw.scale?.[0] ?? 1, sw.scale?.[1] ?? 1, sw.scale?.[2] ?? 1);
    expandBounds(
      sw.position[0] + fcPos[0],
      sw.position[1] + fcPos[1],
      sw.position[2] + fcPos[2],
      sw.radius * maxScale + 1.5
    );
  }

  // Spiral samples (use pre-computed world-space centers)
  for (const samples of allSpiralSamples) {
    for (const s of samples) {
      const pad = Math.max(s.halfThick, s.halfSep) + 0.5;
      expandBounds(s.cx, s.cy, s.cz, pad);
    }
  }

  if (!isFinite(minX)) {
    return { positions: new Float32Array(), indices: new Uint32Array() };
  }

  // Pad bounds
  minX -= 0.5; minY -= 0.5; minZ -= 0.5;
  maxX += 0.5; maxY += 0.5; maxZ += 0.5;

  const sx = (maxX - minX) / res;
  const sy = (maxY - minY) / res;
  const sz = (maxZ - minZ) / res;

  if (DEBUG_SPIRAL) {
    console.log('[spiralSDF debug] bbox:',
      `minX=${minX.toFixed(3)} minY=${minY.toFixed(3)} minZ=${minZ.toFixed(3)} maxX=${maxX.toFixed(3)} maxY=${maxY.toFixed(3)} maxZ=${maxZ.toFixed(3)}`);
    console.log('[spiralSDF debug] voxel size:',
      `sx=${sx.toFixed(4)} sy=${sy.toFixed(4)} sz=${sz.toFixed(4)}`);

    const firstSamples = allSpiralSamples.find((s) => s.length > 0);
    if (firstSamples) {
      const s0 = firstSamples[0];
      console.log('[spiralSDF debug] s0 center:',
        `(${s0.cx.toFixed(3)}, ${s0.cy.toFixed(3)}, ${s0.cz.toFixed(3)})`);
      console.log('[spiralSDF debug] s0 radial:',
        `(${s0.rx.toFixed(3)}, ${s0.ry.toFixed(3)}, ${s0.rz.toFixed(3)})`);
      console.log('[spiralSDF debug] s0 separation:',
        `(${s0.sx.toFixed(3)}, ${s0.sy.toFixed(3)}, ${s0.sz.toFixed(3)})`);

      // ── Deep probe: iterate all segments for ONE query point and find the min-contributing segment.
      // Mirrors the production spiralSDF(): Gram-Schmidt frame, (localR, localS, localT),
      // 2D rounded-rect d2 + 1D tangent dT + IQ 3D extrude combine. `minD` here must match
      // the production field value at the same query point.
      const deepProbe = (qx: number, qy: number, qz: number, label: string) => {
        console.log(`[spiralSDF deep] ${label} query=(${qx.toFixed(3)}, ${qy.toFixed(3)}, ${qz.toFixed(3)})`);
        let minD = Infinity;
        let minInfo: {
          i: number; tParam: number; segLen: number;
          cx: number; cy: number; cz: number;
          nrx: number; nry: number; nrz: number;
          nsx: number; nsy: number; nsz: number;
          tx: number; ty: number; tz: number;
          localR: number; localS: number; localT: number;
          halfThick: number; halfSep: number;
          d2: number; dT: number;
        } | null = null;

        for (let i = 0; i < firstSamples.length - 1; i++) {
          const a = firstSamples[i];
          const b = firstSamples[i + 1];

          const segX = b.cx - a.cx, segY = b.cy - a.cy, segZ = b.cz - a.cz;
          const segLen2 = segX * segX + segY * segY + segZ * segZ;
          if (segLen2 < 1e-20) continue;
          const segLen = Math.sqrt(segLen2);
          const tx = segX / segLen, ty = segY / segLen, tz = segZ / segLen;

          const dpax = qx - a.cx, dpay = qy - a.cy, dpaz = qz - a.cz;
          const uRaw = dpax * tx + dpay * ty + dpaz * tz;
          const tParam = Math.max(0, Math.min(1, uRaw / segLen));

          const cx = a.cx + tParam * segX, cy = a.cy + tParam * segY, cz = a.cz + tParam * segZ;
          const irx = a.rx + tParam * (b.rx - a.rx);
          const iry = a.ry + tParam * (b.ry - a.ry);
          const irz = a.rz + tParam * (b.rz - a.rz);
          const rLen = Math.sqrt(irx * irx + iry * iry + irz * irz);
          let nrx = rLen > 1e-10 ? irx / rLen : irx;
          let nry = rLen > 1e-10 ? iry / rLen : iry;
          let nrz = rLen > 1e-10 ? irz / rLen : irz;
          const rDotT = nrx * tx + nry * ty + nrz * tz;
          nrx -= rDotT * tx; nry -= rDotT * ty; nrz -= rDotT * tz;
          const nrLen = Math.sqrt(nrx * nrx + nry * nry + nrz * nrz);
          if (nrLen < 1e-10) continue;
          nrx /= nrLen; nry /= nrLen; nrz /= nrLen;
          const nsx = ty * nrz - tz * nry;
          const nsy = tz * nrx - tx * nrz;
          const nsz = tx * nry - ty * nrx;

          const halfThick = a.halfThick + tParam * (b.halfThick - a.halfThick);
          const halfSep = a.halfSep + tParam * (b.halfSep - a.halfSep);
          const cr = a.cornerRadius + tParam * (b.cornerRadius - a.cornerRadius);

          const dx = qx - cx, dy = qy - cy, dz = qz - cz;
          const localR = dx * nrx + dy * nry + dz * nrz;
          const localS = dx * nsx + dy * nsy + dz * nsz;
          const localT = dx * tx + dy * ty + dz * tz;

          const d2 = sdRoundedRect2D(localR, localS, halfThick, halfSep, cr);
          const lo = -tParam * segLen;
          const hi = (1 - tParam) * segLen;
          const dT = Math.max(lo - localT, localT - hi);

          const outX = Math.max(d2, 0);
          const outY = Math.max(dT, 0);
          const dOutside = Math.sqrt(outX * outX + outY * outY);
          const dInside = Math.min(Math.max(d2, dT), 0);
          const d = dOutside + dInside;

          if (d < minD) {
            minD = d;
            minInfo = { i, tParam, segLen, cx, cy, cz, nrx, nry, nrz, nsx, nsy, nsz, tx, ty, tz, localR, localS, localT, halfThick, halfSep, d2, dT };
          }
        }

        console.log(`[spiralSDF deep] ${label} minD=${minD.toFixed(4)}`);
        if (minInfo) {
          console.log(`[spiralSDF deep]   winning segment i=${minInfo.i} tParam=${minInfo.tParam.toFixed(4)} segLen=${minInfo.segLen.toFixed(4)}`);
          console.log(`[spiralSDF deep]   footpoint=(${minInfo.cx.toFixed(3)}, ${minInfo.cy.toFixed(3)}, ${minInfo.cz.toFixed(3)})`);
          console.log(`[spiralSDF deep]   R=(${minInfo.nrx.toFixed(3)}, ${minInfo.nry.toFixed(3)}, ${minInfo.nrz.toFixed(3)})  |R|=${Math.sqrt(minInfo.nrx**2 + minInfo.nry**2 + minInfo.nrz**2).toFixed(4)}`);
          console.log(`[spiralSDF deep]   S=(${minInfo.nsx.toFixed(3)}, ${minInfo.nsy.toFixed(3)}, ${minInfo.nsz.toFixed(3)})  |S|=${Math.sqrt(minInfo.nsx**2 + minInfo.nsy**2 + minInfo.nsz**2).toFixed(4)}`);
          console.log(`[spiralSDF deep]   T=(${minInfo.tx.toFixed(3)}, ${minInfo.ty.toFixed(3)}, ${minInfo.tz.toFixed(3)})  |T|=${Math.sqrt(minInfo.tx**2 + minInfo.ty**2 + minInfo.tz**2).toFixed(4)}`);
          console.log(`[spiralSDF deep]   R·S=${(minInfo.nrx*minInfo.nsx + minInfo.nry*minInfo.nsy + minInfo.nrz*minInfo.nsz).toFixed(4)}  R·T=${(minInfo.nrx*minInfo.tx + minInfo.nry*minInfo.ty + minInfo.nrz*minInfo.tz).toFixed(4)}  S·T=${(minInfo.nsx*minInfo.tx + minInfo.nsy*minInfo.ty + minInfo.nsz*minInfo.tz).toFixed(4)}`);
          console.log(`[spiralSDF deep]   localR=${minInfo.localR.toFixed(4)}  localS=${minInfo.localS.toFixed(4)}  localT=${minInfo.localT.toFixed(4)}  halfThick=${minInfo.halfThick.toFixed(3)}  halfSep=${minInfo.halfSep.toFixed(3)}`);
          console.log(`[spiralSDF deep]   d2(cross-section)=${minInfo.d2.toFixed(4)}  dT(tangent)=${minInfo.dT.toFixed(4)}  d3D=${minD.toFixed(4)}`);
          const dx = qx - minInfo.cx, dy = qy - minInfo.cy, dz = qz - minInfo.cz;
          const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          console.log(`[spiralSDF deep]   3D distance query→footpoint=${dist3d.toFixed(4)}`);
        }
      };

      deepProbe(s0.cx, s0.cy, s0.cz, 'center');
      deepProbe(
        s0.cx + s0.halfThick * s0.rx,
        s0.cy + s0.halfThick * s0.ry,
        s0.cz + s0.halfThick * s0.rz,
        'edge +radial'
      );
      deepProbe(
        s0.cx + 10 * s0.halfThick * s0.rx,
        s0.cy + 10 * s0.halfThick * s0.ry,
        s0.cz + 10 * s0.halfThick * s0.rz,
        'far +radial'
      );
    }
  }

  // Build SDF field — store negated SDF so MC's "field >= 0" = "inside"
  const fieldSize = (res + 1) * (res + 1) * (res + 1);
  const field = new Float32Array(fieldSize);

  function idx(ix: number, iy: number, iz: number): number {
    return iz * (res + 1) * (res + 1) + iy * (res + 1) + ix;
  }

  for (let iz = 0; iz <= res; iz++) {
    for (let iy = 0; iy <= res; iy++) {
      for (let ix = 0; ix <= res; ix++) {
        const x = minX + ix * sx;
        const y = minY + iy * sy;
        const z = minZ + iz * sz;
        field[idx(ix, iy, iz)] = -evalSDF(x, y, z, spheres, tailSamples, baseSet, flowCloud, fcTailSamples, allSpiralSamples);
      }
    }
  }

  if (DEBUG_SPIRAL) {
    let fieldMin = Infinity, fieldMax = -Infinity;
    let nanCount = 0, infCount = 0, positiveCount = 0, negativeCount = 0;
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      if (Number.isNaN(v)) nanCount++;
      else if (!Number.isFinite(v)) infCount++;
      else {
        if (v < fieldMin) fieldMin = v;
        if (v > fieldMax) fieldMax = v;
        if (v >= 0) positiveCount++;
        else negativeCount++;
      }
    }
    console.log('[spiralSDF debug] field stats:', {
      fieldMin, fieldMax, nanCount, infCount,
      positiveCount, negativeCount, total: field.length,
    });
  }

  // March cubes at threshold = 0
  const verts: number[] = [];
  const tris: number[] = [];
  const edgeVerts = new Map<string, number>();
  let fullyOutsideCount = 0, fullyInsideCount = 0, crossingCount = 0;

  function getEdgeVert(
    x0: number, y0: number, z0: number, v0: number,
    x1: number, y1: number, z1: number, v1: number,
    eKey: string
  ): number {
    if (edgeVerts.has(eKey)) return edgeVerts.get(eKey)!;
    const [px, py, pz] = interp(x0, y0, z0, v0, x1, y1, z1, v1);
    const vi = verts.length / 3;
    verts.push(px, py, pz);
    edgeVerts.set(eKey, vi);
    return vi;
  }

  for (let iz = 0; iz < res; iz++) {
    for (let iy = 0; iy < res; iy++) {
      for (let ix = 0; ix < res; ix++) {
        const cx = [ix, ix+1, ix+1, ix, ix, ix+1, ix+1, ix];
        const cy = [iy, iy, iy+1, iy+1, iy, iy, iy+1, iy+1];
        const cz = [iz, iz, iz, iz, iz+1, iz+1, iz+1, iz+1];

        const wx = cx.map(i => minX + i * sx);
        const wy = cy.map(i => minY + i * sy);
        const wz = cz.map(i => minZ + i * sz);
        const vals = cx.map((_, vi) => field[idx(cx[vi], cy[vi], cz[vi])]);

        let cubeIdx = 0;
        for (let v = 0; v < 8; v++) {
          if (vals[v] >= 0) cubeIdx |= (1 << v);
        }

        if (cubeIdx === 0) { fullyOutsideCount++; continue; }
        if (cubeIdx === 255) { fullyInsideCount++; continue; }
        crossingCount++;

        const triList = TRI_TABLE[cubeIdx];
        if (!triList || triList[0] === -1) continue;

        const edgeV: (number | null)[] = new Array(12).fill(null);

        function ensureEdge(e: number): number {
          if (edgeV[e] !== null) return edgeV[e]!;
          const [a, b] = EDGE_PAIRS[e];
          const key = `${ix}_${iy}_${iz}_${e}`;
          const vi = getEdgeVert(wx[a], wy[a], wz[a], vals[a], wx[b], wy[b], wz[b], vals[b], key);
          edgeV[e] = vi;
          return vi;
        }

        for (let t = 0; t < triList.length && triList[t] !== -1; t += 3) {
          const v0 = ensureEdge(triList[t]);
          const v1 = ensureEdge(triList[t + 1]);
          const v2 = ensureEdge(triList[t + 2]);
          tris.push(v0, v1, v2);
        }
      }
    }
  }

  if (DEBUG_SPIRAL) {
    console.log('[spiralSDF debug] MC summary:', {
      totalVoxels: res * res * res,
      fullyOutsideCount,
      fullyInsideCount,
      crossingCount,
      verticesProduced: verts.length / 3,
      trianglesProduced: tris.length / 3,
    });
    console.log('[spiralSDF debug] === generateSurfaceMesh end ===');
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint32Array(tris),
  };
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<SMInput>) => {
  try {
    const result = generateSurfaceMesh(e.data);
    const transferables: Transferable[] = [result.positions.buffer, result.indices.buffer];
    self.postMessage(result, { transfer: transferables });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
