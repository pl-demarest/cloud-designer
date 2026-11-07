/**
 * Marching Cubes Web Worker
 *
 * Receives: { spheres, base, tail, flowCloud } (CloudPreset subset)
 * Posts back: { vertices, indices, bands, flowLines }
 *
 * Algorithm: classic marching cubes on a scalar field built from
 * metaball spheres + approximate SDF contributions from base/tail.
 */

import type { SphereDef, BaseDef, TailDef, FlowCloudSettings } from '../types/cloud';
import { fillField, gridFromBounds, polygonise } from '../geometry/marchingCubes/polygonise';
import { sampleTailSpline } from '../geometry/primitives/tail';
import { evalMetaballField } from '../geometry/flowField';

// --- Simplified scalar field + mesh generation ---

interface MCInput {
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  flowCloud: FlowCloudSettings;
}

function marchingCubes(
  spheres: SphereDef[],
  tail: TailDef,
  flowCloud: FlowCloudSettings
): { vertices: Float32Array; indices: Uint32Array } {
  const res = flowCloud.resolution;
  const iso = flowCloud.threshold;
  const tailStrength = flowCloud.tailStrength ?? 1.0;

  // Sample tail spline (32 segments gives smooth capsule approximation)
  const tailSamples = tailStrength > 0 ? sampleTailSpline(tail, 32) : [];

  // Compute bounding box from spheres
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const sw of spheres) {
    const r = sw.radius * Math.max(...sw.scale) + 1.5;
    minX = Math.min(minX, sw.position[0] - r);
    minY = Math.min(minY, sw.position[1] - r);
    minZ = Math.min(minZ, sw.position[2] - r);
    maxX = Math.max(maxX, sw.position[0] + r);
    maxY = Math.max(maxY, sw.position[1] + r);
    maxZ = Math.max(maxZ, sw.position[2] + r);
  }

  // Extend bounding box to include tail setpoints
  for (const sp of tail.setpoints) {
    const w = sp.width + 0.5;
    minX = Math.min(minX, sp.position[0] - w);
    minY = Math.min(minY, sp.position[1] - w);
    minZ = Math.min(minZ, sp.position[2] - w);
    maxX = Math.max(maxX, sp.position[0] + w);
    maxY = Math.max(maxY, sp.position[1] + w);
    maxZ = Math.max(maxZ, sp.position[2] + w);
  }

  if (!isFinite(minX)) {
    return { vertices: new Float32Array(), indices: new Uint32Array() };
  }

  const grid = gridFromBounds(minX, minY, minZ, maxX, maxY, maxZ, res);

  // Build scalar field
  const field = fillField(grid, (x, y, z) => evalMetaballField(x, y, z, spheres, tailSamples, tailStrength));

  // March cubes
  const { positions, indices } = polygonise(field, grid, { kind: 'density', iso });
  return { vertices: positions, indices };
}

// ---------------------------------------------------------------------------
// Spiral wireframe extraction
// ---------------------------------------------------------------------------

function extractSpiral(
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

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<MCInput>) => {
  const { spheres, tail, flowCloud } = e.data;

  try {
    const { vertices, indices } = marchingCubes(spheres, tail, flowCloud);

    let bands: Float32Array[] = [];
    let flowLines: Float32Array[] = [];

    if (vertices.length > 0 && flowCloud.wireframe.mode === 'spiral') {
      const extracted = extractSpiral(vertices, indices, flowCloud, spheres, tail);
      bands = extracted.bands;
      flowLines = extracted.flowLines;
    }

    const transferables: Transferable[] = [vertices.buffer, indices.buffer];
    for (const b of bands) transferables.push(b.buffer);
    for (const fl of flowLines) transferables.push(fl.buffer);

    self.postMessage({ vertices, indices, bands, flowLines }, { transfer: transferables });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
