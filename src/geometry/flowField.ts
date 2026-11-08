/**
 * The flow cloud's metaball field, evaluated by both the flow-cloud worker (which meshes
 * field >= threshold) and the surface-mesh worker (which unions threshold - field into its SDF),
 * and the spiral wireframe (bands and flow lines) the flow-cloud worker traces over its mesh.
 */

import type { SphereDef, TailDef, FlowCloudSettings } from '../model/types';
import { sphereFieldTerm, type SphereFrame } from './primitives/sphere';
import type { TailSample } from './primitives/tail';
import { Float32Builder } from './arrayBuilder';

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
 * The edges of an indexed triangle mesh. Edge ids follow the order of (lower, higher) vertex
 * index pairs, so they depend on the triangles' vertices but not on their order or winding.
 */
interface MeshEdges {
  count: number;
  /** Lower and higher vertex index of each edge. */
  lo: Int32Array;
  hi: Int32Array;
  /** The edge on side k (corner k to corner k + 1) of triangle t is sides[3 * t + k]. */
  sides: Int32Array;
}

function meshEdges(indices: Uint32Array, vertexCount: number): MeshEdges {
  const keys = new Float64Array(indices.length);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k];
      const b = indices[t + (k === 2 ? 0 : k + 1)];
      keys[t + k] = a < b ? a * vertexCount + b : b * vertexCount + a;
    }
  }
  const sorted = keys.slice().sort();
  const id = new Map<number, number>();
  for (const key of sorted) if (!id.has(key)) id.set(key, id.size);
  const lo = new Int32Array(id.size);
  const hi = new Int32Array(id.size);
  for (const [key, e] of id) {
    lo[e] = Math.floor(key / vertexCount);
    hi[e] = key - lo[e] * vertexCount;
  }
  const sides = new Int32Array(indices.length);
  for (let i = 0; i < keys.length; i++) sides[i] = id.get(keys[i])!;
  return { count: id.size, lo, hi, sides };
}

/**
 * The value of a level function at the two ends of edge (lo, hi): out[0] at lo, out[1] at hi.
 * The level set is where the function is 0; it is linear along the edge.
 */
type EdgeEnds = (lo: number, hi: number, out: Float64Array) => void;

/**
 * The level set of a function that is linear along each mesh edge, as polylines over the mesh.
 * An edge is crossed when exactly one of its ends is below 0, and the crossing is computed once,
 * from the lower vertex, so the triangles on both sides of the edge share it. A triangle with two
 * crossed sides joins their crossings (with the half-open rule a plain scalar always gives 0 or 2;
 * an angle gives 1 or 3 around the axis it winds about, and those crossings stay chain ends). The
 * joined crossings are walked into polylines: open chains first, from the end found first, then
 * closed loops, which repeat their first point at the end. Consecutive equal points (crossings
 * at a vertex that lies on the level) are dropped, and a polyline left with one point is dropped.
 * `u` is interpolated with the positions; the polylines carry it as their fourth component.
 */
function levelSetPolylines(
  vertices: Float32Array,
  u: Float32Array,
  mesh: MeshEdges,
  ends: EdgeEnds,
): Float64Array[] {
  const { count, lo, hi, sides } = mesh;
  // Each crossed edge is a node, edgeNode[edge] (-1 for an edge not crossed), with its point
  // (x, y, z, u) and up to two links (the triangles on its sides; each mesh edge has at most two).
  const edgeNode = new Int32Array(count);
  const point = new Float64Array(4 * count);
  const link = new Int32Array(2 * count).fill(-1);
  const f = new Float64Array(2);
  let nodes = 0;

  // Evaluated in edge order, so node ids do not depend on the triangles' winding.
  for (let e = 0; e < count; e++) {
    ends(lo[e], hi[e], f);
    const a = f[0];
    const b = f[1];
    if (a < 0 === b < 0) {
      edgeNode[e] = -1;
      continue;
    }
    const t = a / (a - b);
    const i = lo[e] * 3;
    const j = hi[e] * 3;
    const n = nodes++;
    point[n * 4] = vertices[i] + t * (vertices[j] - vertices[i]);
    point[n * 4 + 1] = vertices[i + 1] + t * (vertices[j + 1] - vertices[i + 1]);
    point[n * 4 + 2] = vertices[i + 2] + t * (vertices[j + 2] - vertices[i + 2]);
    point[n * 4 + 3] = u[lo[e]] + t * (u[hi[e]] - u[lo[e]]);
    edgeNode[e] = n;
  }

  const join = (p: number, q: number): void => {
    if (link[p * 2] === q || link[p * 2 + 1] === q) return;
    const sp = link[p * 2] < 0 ? p * 2 : link[p * 2 + 1] < 0 ? p * 2 + 1 : -1;
    const sq = link[q * 2] < 0 ? q * 2 : link[q * 2 + 1] < 0 ? q * 2 + 1 : -1;
    if (sp < 0 || sq < 0) return; // an edge in more than two triangles: not a manifold mesh
    link[sp] = q;
    link[sq] = p;
  };
  for (let t = 0; t < sides.length; t += 3) {
    const n0 = edgeNode[sides[t]];
    const n1 = edgeNode[sides[t + 1]];
    const n2 = edgeNode[sides[t + 2]];
    const crossed = (n0 >= 0 ? 1 : 0) + (n1 >= 0 ? 1 : 0) + (n2 >= 0 ? 1 : 0);
    if (crossed !== 2) continue;
    if (n0 < 0) join(n1, n2);
    else if (n1 < 0) join(n0, n2);
    else join(n0, n1);
  }

  const visited = new Uint8Array(nodes);
  const lines: Float64Array[] = [];
  const degree = (n: number) => (link[n * 2] >= 0 ? 1 : 0) + (link[n * 2 + 1] >= 0 ? 1 : 0);
  const walk = (start: number): void => {
    const chain = [start];
    visited[start] = 1;
    let cur = start;
    for (;;) {
      const a = link[cur * 2];
      const b = link[cur * 2 + 1];
      const next = a >= 0 && !visited[a] ? a : b >= 0 && !visited[b] ? b : -1;
      if (next < 0) break;
      visited[next] = 1;
      chain.push(next);
      cur = next;
    }
    if (chain.length > 2 && (link[cur * 2] === start || link[cur * 2 + 1] === start)) chain.push(start);

    const out: number[] = [];
    for (const n of chain) {
      const k = out.length;
      const x = point[n * 4], y = point[n * 4 + 1], z = point[n * 4 + 2];
      // Equal once stored as float32 is equal on screen.
      if (k > 0 && Math.fround(x) === Math.fround(out[k - 4]) && Math.fround(y) === Math.fround(out[k - 3]) &&
        Math.fround(z) === Math.fround(out[k - 2])) continue;
      out.push(x, y, z, point[n * 4 + 3]);
    }
    if (out.length >= 8) lines.push(Float64Array.from(out));
  };
  for (let n = 0; n < nodes; n++) if (!visited[n] && degree(n) === 1) walk(n);
  for (let n = 0; n < nodes; n++) if (!visited[n] && degree(n) === 2) walk(n);
  return lines;
}

const TWO_PI = Math.PI * 2;

/** The angle a wrapped into [-pi, pi). */
function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

/**
 * The spiral wireframe over the flow-cloud mesh. Each vertex gets an axial coordinate u (0 at
 * the front of the frontmost sphere, 1 at the first tail setpoint, or one axis length past the
 * front when the tail starts less than 1e-3 past it) and an angle around the front-to-back
 * axis. Bands (only when generateBands is set) are contours of constant u, one
 * array of segment pairs per contour. Flow lines (only when showFlowLines is set) follow constant
 * angle + spiralTwist * u, one polyline per connected piece, running from low to high u. Both are
 * traced over the mesh by levelSetPolylines, so every point lies on a mesh edge and consecutive
 * points on two sides of one triangle.
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

  // u range ends at the tail's first setpoint (where the tail meets the cloud body), when that
  // lies more than 1e-3 past the front. A tail that starts at or in front of the front (an 'end'
  // tail on a closed base starts at the base's first point) would leave no range, so the range
  // then spans the axis length, as without a tail.
  // The tail tube is a separate sculpted piece — it is not part of the isosurface.
  let uBack = uFront + rawLen;
  if (tail.setpoints.length > 0) {
    const tailFirst = tail.setpoints[0];
    const dx = tailFirst.position[0] - fp[0];
    const dy = tailFirst.position[1] - fp[1];
    const dz = tailFirst.position[2] - fp[2];
    const proj = dx*axN[0] + dy*axN[1] + dz*axN[2];
    if (proj - uFront > 1e-3) uBack = proj;
  }
  // Positive: rawLen is at least 1e-3 (checked above), and a range the tail ends is longer.
  const uRange = uBack - uFront;

  // --- Per-vertex u and spiral angle ---
  const nVerts = vertices.length / 3;
  const uArr   = new Float32Array(nVerts);
  const svArr  = new Float32Array(nVerts); // spiralV = angle around the axis + spiralTwist * u

  for (let i = 0; i < nVerts; i++) {
    const vx = vertices[i*3]   - fp[0];
    const vy = vertices[i*3+1] - fp[1];
    const vz = vertices[i*3+2] - fp[2];

    const rawProj = vx*axN[0] + vy*axN[1] + vz*axN[2];
    const u = Math.max(0, Math.min(1, (rawProj - uFront) / uRange));
    uArr[i] = u;

    const compA = vx*perpA[0] + vy*perpA[1] + vz*perpA[2];
    const compB = vx*perpB[0] + vy*perpB[1] + vz*perpB[2];
    svArr[i] = Math.atan2(compB, compA) + wf.spiralTwist * u;
  }

  const mesh = meshEdges(indices, nVerts);
  const bands: Float32Array[] = [];
  const flowLines: Float32Array[] = [];

  // --- BAND CONTOURS (constant u) ---
  // Gated on generateBands so the user can produce a band-free isosurface entirely.
  // showBands controls visibility of already-generated bands; generateBands controls existence.
  if (wf.generateBands) {
    for (let bi = 0; bi <= wf.numBands; bi++) {
      const targetU = bi / wf.numBands;
      const lines = levelSetPolylines(vertices, uArr, mesh, (lo, hi, out) => {
        out[0] = uArr[lo] - targetU;
        out[1] = uArr[hi] - targetU;
      });
      const segs = new Float32Builder();
      for (const line of lines) {
        for (let k = 4; k < line.length; k += 4) {
          segs.push3(line[k - 4], line[k - 3], line[k - 2]);
          segs.push3(line[k], line[k + 1], line[k + 2]);
        }
      }
      if (segs.length > 0) bands.push(segs.toArray());
    }
  }

  // --- FLOW LINES (constant spiralV) ---
  if (wf.showFlowLines) {
    const offset = new Float64Array(nVerts);
    for (let fi = 0; fi < wf.numFlowLines; fi++) {
      const targetSV = (fi / wf.numFlowLines) * TWO_PI - Math.PI;
      // spiralV relative to the target, wrapped once per vertex, so that a vertex is on the same
      // side of the level in every edge it ends.
      for (let i = 0; i < nVerts; i++) offset[i] = wrapAngle(svArr[i] - targetSV);
      const lines = levelSetPolylines(vertices, uArr, mesh, (lo, hi, out) => {
        const a = offset[lo];
        const b = offset[hi];
        // Ends more than half a turn apart meet at the opposite angle, not at the target.
        out[0] = a;
        out[1] = Math.abs(b - a) > Math.PI ? a : b;
      });
      for (const line of lines) {
        const pts = new Float32Array((line.length / 4) * 3);
        // From low to high u.
        const reverse = line[3] > line[line.length - 1];
        for (let k = 0; k < line.length / 4; k++) {
          const m = reverse ? line.length / 4 - 1 - k : k;
          pts[k * 3] = line[m * 4];
          pts[k * 3 + 1] = line[m * 4 + 1];
          pts[k * 3 + 2] = line[m * 4 + 2];
        }
        flowLines.push(pts);
      }
    }
  }

  return { bands, flowLines };
}
