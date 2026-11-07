/**
 * The flow cloud's metaball field, evaluated by both the flow-cloud worker (which meshes
 * field >= threshold) and the surface-mesh worker (which unions threshold - field into its SDF),
 * and the spiral wireframe (bands and flow lines) the flow-cloud worker traces over its mesh.
 */

import type { SphereDef, TailDef, FlowCloudSettings } from '../model/types';
import { sphereFieldTerm, type SphereFrame } from './primitives/sphere';
import type { TailSample } from './primitives/tail';

/** Metaball field at (x, y, z). Each sphere adds its sphereFieldTerm (falloff * r^2 / d^2 in its
 *  rotated, scaled frame); the tail adds tailStrength times the same term for the nearest point
 *  on its sampled spine. */
export function evalMetaballField(
  x: number, y: number, z: number,
  spheres: SphereFrame[],
  tailSamples: TailSample[],
  tailStrength: number
): number {
  let val = 0;

  // Sphere metaballs
  for (const f of spheres) val += sphereFieldTerm(x, y, z, f);

  // Tail metaball — find closest point on sampled spine and treat as a
  // variable-radius capsule. Using nearest-segment to avoid double-counting.
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

/**
 * The spiral wireframe over the flow-cloud mesh. Each vertex gets an axial coordinate u (0 at
 * the front of the frontmost sphere, 1 at the first tail setpoint) and an angle around the
 * front-to-back axis. Bands (only when generateBands is set) are contours of constant u. Flow
 * lines (only when showFlowLines is set) follow constant angle + spiralTwist * u, each one the
 * mesh-edge crossings of its target value sorted by u.
 */
export function extractSpiral(
  vertices: Float32Array,
  indices: Uint32Array,
  flowCloud: FlowCloudSettings,
  spheres: SphereDef[],
  tail: TailDef
): { bands: Float32Array[]; flowLines: Float32Array[] } {
  const wf = flowCloud.wireframe;
  const fp = wf.frontPoint;
  const bp = wf.backPoint;
  const TWO_PI = Math.PI * 2;

  // Axis DIRECTION only — gizmo positions define orientation, not extent
  const rawAx = [bp[0]-fp[0], bp[1]-fp[1], bp[2]-fp[2]];
  const rawLen = Math.sqrt(rawAx[0]**2 + rawAx[1]**2 + rawAx[2]**2);
  if (rawLen < 0.001) return { bands: [], flowLines: [] };
  const axN: [number,number,number] = [rawAx[0]/rawLen, rawAx[1]/rawLen, rawAx[2]/rawLen];

  // Build perp basis (perpendicular to axis, used for angle computation)
  const up = Math.abs(axN[1]) < 0.9 ? [0,1,0] : [1,0,0];
  const rx = axN[1]*up[2] - axN[2]*up[1];
  const ry = axN[2]*up[0] - axN[0]*up[2];
  const rz = axN[0]*up[1] - axN[1]*up[0];
  const rLen = Math.sqrt(rx*rx + ry*ry + rz*rz);
  const perpA: [number,number,number] = [rx/rLen, ry/rLen, rz/rLen];
  const perpB: [number,number,number] = [
    axN[1]*perpA[2] - axN[2]*perpA[1],
    axN[2]*perpA[0] - axN[0]*perpA[2],
    axN[0]*perpA[1] - axN[1]*perpA[0],
  ];

  // --- Auto-compute u range from geometry (projected onto axis) ---
  // Origin for projections: front gizmo position
  let uFront = Infinity;
  for (const sw of spheres) {
    const dx = sw.position[0] - fp[0];
    const dy = sw.position[1] - fp[1];
    const dz = sw.position[2] - fp[2];
    const proj = dx*axN[0] + dy*axN[1] + dz*axN[2];
    const r = sw.radius * Math.max(sw.scale[0], sw.scale[1], sw.scale[2]);
    uFront = Math.min(uFront, proj - r);  // front surface of frontmost sphere
  }
  if (!isFinite(uFront)) uFront = 0;

  // u range ends at the tail's first setpoint (where the tail meets the cloud body).
  // The tail tube is a separate sculpted piece — it is not part of the isosurface.
  const tailFirst = tail.setpoints.length > 0 ? tail.setpoints[0] : null;
  let uBack: number;
  if (tailFirst) {
    const dx = tailFirst.position[0] - fp[0];
    const dy = tailFirst.position[1] - fp[1];
    const dz = tailFirst.position[2] - fp[2];
    uBack = dx*axN[0] + dy*axN[1] + dz*axN[2];
  } else {
    uBack = uFront + rawLen;
  }

  const uRange = uBack - uFront;
  if (uRange < 0.001) return { bands: [], flowLines: [] };

  // --- Per-vertex u and spiral angle ---
  const nVerts = vertices.length / 3;
  const uArr   = new Float32Array(nVerts);
  const baArr  = new Float32Array(nVerts); // base angle = atan2 only (no twist)
  const svArr  = new Float32Array(nVerts); // spiralV = baArr + spiralTwist * u

  for (let i = 0; i < nVerts; i++) {
    const vx = vertices[i*3]   - fp[0];
    const vy = vertices[i*3+1] - fp[1];
    const vz = vertices[i*3+2] - fp[2];

    const rawProj = vx*axN[0] + vy*axN[1] + vz*axN[2];
    const u = Math.max(0, Math.min(1, (rawProj - uFront) / uRange));
    uArr[i] = u;

    const compA = vx*perpA[0] + vy*perpA[1] + vz*perpA[2];
    const compB = vx*perpB[0] + vy*perpB[1] + vz*perpB[2];
    const ba = Math.atan2(compB, compA);
    baArr[i] = ba;
    svArr[i] = ba + wf.spiralTwist * u;
  }

  // Normalize angle to (-π, π]
  const normAngle = (a: number): number => {
    let v = a % TWO_PI;
    if (v > Math.PI) v -= TWO_PI;
    else if (v <= -Math.PI) v += TWO_PI;
    return v;
  };

  const bands: Float32Array[] = [];
  const flowLines: Float32Array[] = [];

  // --- BAND CONTOURS (constant u) ---
  // Gated on generateBands so the user can produce a band-free isosurface entirely.
  // showBands controls visibility of already-generated bands; generateBands controls existence.
  if (wf.generateBands) {
    for (let bi = 0; bi <= wf.numBands; bi++) {
      const targetU = bi / wf.numBands;
      const segs: number[] = [];

      for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t], i1 = indices[t+1], i2 = indices[t+2];
        const u0 = uArr[i0], u1 = uArr[i1], u2 = uArr[i2];

        const crossPts: [number,number,number][] = [];
        const edges: [number,number][] = [[i0,i1],[i1,i2],[i2,i0]];
        const uEdges: [number,number][] = [[u0,u1],[u1,u2],[u2,u0]];

        for (let e = 0; e < 3; e++) {
          const [ua, ub] = uEdges[e];
          if (!((ua <= targetU && targetU <= ub) || (ub <= targetU && targetU <= ua))) continue;
          if (Math.abs(ub - ua) < 0.00001) continue;
          const t_c = (targetU - ua) / (ub - ua);
          const [ia, ib] = edges[e];
          crossPts.push([
            vertices[ia*3]   + t_c*(vertices[ib*3]   - vertices[ia*3]),
            vertices[ia*3+1] + t_c*(vertices[ib*3+1] - vertices[ia*3+1]),
            vertices[ia*3+2] + t_c*(vertices[ib*3+2] - vertices[ia*3+2]),
          ]);
        }
        if (crossPts.length === 2) segs.push(...crossPts[0], ...crossPts[1]);
      }
      if (segs.length > 0) bands.push(new Float32Array(segs));
    }
  }

  // --- FLOW LINES (constant spiralV) ---
  if (wf.showFlowLines) {
    for (let fi = 0; fi < wf.numFlowLines; fi++) {
      const targetSV = (fi / wf.numFlowLines) * TWO_PI - Math.PI;
      const crossings: { pos: [number,number,number]; u: number }[] = [];

      for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t], i1 = indices[t+1], i2 = indices[t+2];

        const edges: [number,number][] = [[i0,i1],[i1,i2],[i2,i0]];

        for (let e = 0; e < 3; e++) {
          const [ia, ib] = edges[e];
          const sva = svArr[ia];

          // Reconstruct svb with atan2 wrap removed:
          // use normAngle on base angle diff + smooth spiralTwist contribution
          const ba_diff   = normAngle(baArr[ib] - baArr[ia]);
          const twist_diff = wf.spiralTwist * (uArr[ib] - uArr[ia]);
          const svb_adj   = sva + ba_diff + twist_diff;

          // Adjust targetSV to be in the same "period" as this edge
          const edgeMid = (sva + svb_adj) / 2;
          const k = Math.round((edgeMid - targetSV) / TWO_PI);
          const tgt = targetSV + k * TWO_PI;

          const lo = Math.min(sva, svb_adj);
          const hi = Math.max(sva, svb_adj);
          if (tgt < lo || tgt > hi) continue;

          const span = svb_adj - sva;
          if (Math.abs(span) < 0.00001) continue;
          const t_c = (tgt - sva) / span;
          if (t_c < 0 || t_c > 1) continue;

          crossings.push({
            pos: [
              vertices[ia*3]   + t_c*(vertices[ib*3]   - vertices[ia*3]),
              vertices[ia*3+1] + t_c*(vertices[ib*3+1] - vertices[ia*3+1]),
              vertices[ia*3+2] + t_c*(vertices[ib*3+2] - vertices[ia*3+2]),
            ],
            u: uArr[ia] + t_c*(uArr[ib] - uArr[ia]),
          });
        }
      }

      crossings.sort((a, b) => a.u - b.u);

      if (wf.showFlowLines && crossings.length > 1) {
        const lineVerts: number[] = [];
        for (const c of crossings) lineVerts.push(...c.pos);
        flowLines.push(new Float32Array(lineVerts));
      }
    }
  }

  return { bands, flowLines };
}
