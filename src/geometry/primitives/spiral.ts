/**
 * The spiral primitive's volume (thick spirals only): a rounded rectangle swept along the
 * spiral path.
 */

import type { SpiralDef } from '../../model/types';

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

/** Signed distance to the swept rounded-rectangle spiral volume.
 *  Per segment: build an orthonormal frame (R, S, T) where T is a smoothly
 *  interpolated tangent (averaged from adjacent segments at each sample, then
 *  lerp'd within the segment — eliminates discrete frame jumps at joints) and
 *  R is Gram-Schmidt'd from the interpolated radial axis against T, S = T × R.
 *  Decompose (query − footpoint) into (localR, localS, localT), compute the
 *  2D rounded-rect SDF d2 in the cross-section plane, the 1D signed distance
 *  dT to the segment's tangent-direction extent, and combine via the IQ 3D
 *  extrude formula. Final value is min over all segments. */
export function spiralSDF(x: number, y: number, z: number, samples: SpiralSample[]): number {
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
