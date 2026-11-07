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
import { EDGE_PAIRS, TRI_TABLE } from '../geometry/marchingCubes/tables';

// --- Simplified scalar field + mesh generation ---

interface MCInput {
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  flowCloud: FlowCloudSettings;
}

// Sampled tail spine point: position + interpolated width (radius)
interface TailSample {
  px: number; py: number; pz: number;
  width: number;
}

// Sample the tail setpoints as a Catmull-Rom spline
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

    // Linearly interpolate width between p1 and p2
    const width = p1.width + t * (p2.width - p1.width);
    samples.push({ px, py, pz, width });
  }
  return samples;
}

// Evaluate scalar field at point (x, y, z)
function evalField(
  x: number, y: number, z: number,
  spheres: SphereDef[],
  tailSamples: TailSample[],
  tailStrength: number
): number {
  let val = 0;

  // Sphere metaballs
  for (const sw of spheres) {
    const [sx, sy, sz] = sw.position;
    let dx = x - sx;
    let dy = y - sy;
    let dz = z - sz;

    if (sw.shape === 'ellipsoid') {
      dx /= sw.scale[0];
      dy /= sw.scale[1];
      dz /= sw.scale[2];
    }

    const dist2 = dx * dx + dy * dy + dz * dz;
    const r2 = sw.radius * sw.radius;
    if (dist2 < 0.0001) {
      val += sw.falloff * 100;
    } else {
      val += sw.falloff * r2 / dist2;
    }
  }

  // Tail metaball — find closest point on sampled spine and treat as a
  // variable-radius capsule. Using nearest-segment to avoid double-counting.
  if (tailSamples.length >= 2 && tailStrength > 0) {
    let minDist2 = Infinity;
    let minRadius = 0;

    for (let i = 0; i < tailSamples.length - 1; i++) {
      const a = tailSamples[i];
      const b = tailSamples[i + 1];
      const abx = b.px - a.px, aby = b.py - a.py, abz = b.pz - a.pz;
      const ab2 = abx*abx + aby*aby + abz*abz;
      const apx = x - a.px, apy = y - a.py, apz = z - a.pz;
      const t = ab2 > 0.00001 ? Math.max(0, Math.min(1, (apx*abx + apy*aby + apz*abz) / ab2)) : 0;
      const cx = a.px + t*abx, cy = a.py + t*aby, cz = a.pz + t*abz;
      const d2 = (x-cx)*(x-cx) + (y-cy)*(y-cy) + (z-cz)*(z-cz);
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

// Linear interpolation along edge
function interp(
  isolevel: number,
  ax: number, ay: number, az: number, aval: number,
  bx: number, by: number, bz: number, bval: number
): [number, number, number] {
  if (Math.abs(isolevel - aval) < 0.00001) return [ax, ay, az];
  if (Math.abs(isolevel - bval) < 0.00001) return [bx, by, bz];
  if (Math.abs(aval - bval) < 0.00001) return [ax, ay, az];
  const t = (isolevel - aval) / (bval - aval);
  return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
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

  // Pad bounds
  minX -= 0.5; minY -= 0.5; minZ -= 0.5;
  maxX += 0.5; maxY += 0.5; maxZ += 0.5;

  const sx = (maxX - minX) / res;
  const sy = (maxY - minY) / res;
  const sz = (maxZ - minZ) / res;

  // Build scalar field
  const field = new Float32Array((res + 1) * (res + 1) * (res + 1));
  function idx(ix: number, iy: number, iz: number): number {
    return iz * (res + 1) * (res + 1) + iy * (res + 1) + ix;
  }

  for (let iz = 0; iz <= res; iz++) {
    for (let iy = 0; iy <= res; iy++) {
      for (let ix = 0; ix <= res; ix++) {
        const x = minX + ix * sx;
        const y = minY + iy * sy;
        const z = minZ + iz * sz;
        field[idx(ix, iy, iz)] = evalField(x, y, z, spheres, tailSamples, tailStrength);
      }
    }
  }

  // March cubes
  const verts: number[] = [];
  const tris: number[] = [];
  const edgeVerts = new Map<string, number>();

  function getEdgeVert(
    x0: number, y0: number, z0: number, v0: number,
    x1: number, y1: number, z1: number, v1: number,
    eKey: string
  ): number {
    if (edgeVerts.has(eKey)) return edgeVerts.get(eKey)!;
    const [px, py, pz] = interp(iso, x0, y0, z0, v0, x1, y1, z1, v1);
    const vi = verts.length / 3;
    verts.push(px, py, pz);
    edgeVerts.set(eKey, vi);
    return vi;
  }

  for (let iz = 0; iz < res; iz++) {
    for (let iy = 0; iy < res; iy++) {
      for (let ix = 0; ix < res; ix++) {
        // World coords of cube corners
        const cx = [ix, ix+1, ix+1, ix, ix, ix+1, ix+1, ix];
        const cy = [iy, iy, iy+1, iy+1, iy, iy, iy+1, iy+1];
        const cz = [iz, iz, iz, iz, iz+1, iz+1, iz+1, iz+1];

        const wx = cx.map(i => minX + i * sx);
        const wy = cy.map(i => minY + i * sy);
        const wz = cz.map(i => minZ + i * sz);
        const vals = cx.map((_xi, vi) => field[idx(cx[vi], cy[vi], cz[vi])]);

        // Compute cube index
        let cubeIdx = 0;
        for (let v = 0; v < 8; v++) {
          if (vals[v] >= iso) cubeIdx |= (1 << v);
        }

        if (cubeIdx === 0 || cubeIdx === 255) continue;

        // Get triangles for this config
        const triList = TRI_TABLE[cubeIdx];
        if (!triList || triList[0] === -1) continue;

        // Edge vertex positions
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

  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(tris),
  };
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
