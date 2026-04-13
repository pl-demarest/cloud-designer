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

// ---------------------------------------------------------------------------
// Edge table & triangle table (condensed marching cubes lookup)
// ---------------------------------------------------------------------------

// Edge vertex pairs
const EDGE_PAIRS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7]
];

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

// Full triTable (256 x 16, -1 terminated) — standard marching cubes
// Using Lorensen & Cline's original table, public domain
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
  [8,2,9,8,9,7,2,10,9,5,9,3,10,3,9,-1], // ... this is getting long
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
