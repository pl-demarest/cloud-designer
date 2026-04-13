/**
 * Cut & Glue Web Worker
 *
 * Clips all primitive wireframe edges against the combined solid clip volume,
 * removing interior overlapping geometry to produce a unified wireframe that
 * looks like a single coherent object.
 *
 * Key principle: per-primitive self-exclusion (inspired by CSG boolean union).
 * Each primitive's edges are clipped against every OTHER primitive's volume,
 * but never against its own. This eliminates the need for safety-margin insets
 * and produces zero-gap seams between adjacent primitives.
 *
 * Returns surviving edges as a single flat Float32Array of world-space line
 * segment pairs (x,y,z,x,y,z,...).
 */

import type { SphereDef, BaseDef, TailDef } from '../types/cloud';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TailSample {
  px: number; py: number; pz: number;
  width: number;
}

interface BaseSample {
  px: number; py: number; pz: number;   // position on spline
  tx: number; ty: number; tz: number;   // tangent (normalized)
  nx: number; ny: number; nz: number;   // world-up stabilized normal
  bx: number; by: number; bz: number;   // binormal = cross(T, N)
  halfH: number;                        // crossSectionHeight / 2
  halfW: number;                        // crossSectionWidth / 2
}

interface BaseSampleSet {
  samples: BaseSample[];
  /** Half the average inter-sample arc length. Used to bound the cross-section
   *  test along the tangent so points well past the extrusion don't falsely match. */
  halfSpacing: number;
}

// ---------------------------------------------------------------------------
// Catmull-Rom spline sampling
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Geometric containment tests
// ---------------------------------------------------------------------------

/** Hard geometric test against a sphere's visible sphere (or ellipsoid).
 *  Matches what the user sees in the editor — independent of metaball field falloff.
 *  With self-exclusion in the caller, inset=1.0 produces zero-gap seams. */
function insideSphere(x: number, y: number, z: number, sw: SphereDef, inset: number): boolean {
  let dx = x - sw.position[0];
  let dy = y - sw.position[1];
  let dz = z - sw.position[2];
  if (sw.half && dy < 0) return false;
  if (sw.shape === 'ellipsoid') {
    dx /= sw.scale[0];
    dy /= sw.scale[1];
    dz /= sw.scale[2];
  }
  const dist2 = dx * dx + dy * dy + dz * dz;
  const r = sw.radius * inset;
  return dist2 < r * r;
}

function insideTailCapsule(x: number, y: number, z: number, tailSamples: TailSample[], inset: number): boolean {
  for (let i = 0; i < tailSamples.length - 1; i++) {
    const a = tailSamples[i];
    const b = tailSamples[i + 1];
    const abx = b.px - a.px;
    const aby = b.py - a.py;
    const abz = b.pz - a.pz;
    const ab2 = abx*abx + aby*aby + abz*abz;
    let param = 0;
    if (ab2 > 0.0001) {
      param = ((x - a.px)*abx + (y - a.py)*aby + (z - a.pz)*abz) / ab2;
      param = Math.max(0, Math.min(1, param));
    }
    const cx = a.px + param * abx;
    const cy = a.py + param * aby;
    const cz = a.pz + param * abz;
    const r = (a.width + (b.width - a.width) * param) * inset;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    if (dx*dx + dy*dy + dz*dz < r*r) return true;
  }
  return false;
}

function insideBaseExtrusion(x: number, y: number, z: number, baseSet: BaseSampleSet, inset: number): boolean {
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

// ---------------------------------------------------------------------------
// Bisection to find exact clip boundary
// ---------------------------------------------------------------------------

function findTransition(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  isInsideA: boolean,
  insideFn: (x: number, y: number, z: number) => boolean,
  tol: number = 0.001,
  maxIter: number = 10
): [number, number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const mx = ax + mid * (bx - ax);
    const my = ay + mid * (by - ay);
    const mz = az + mid * (bz - az);
    if (insideFn(mx, my, mz) === isInsideA) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < tol) break;
  }
  const t = (lo + hi) / 2;
  return [ax + t*(bx - ax), ay + t*(by - ay), az + t*(bz - az)];
}

// ---------------------------------------------------------------------------
// Edge set clipping
// ---------------------------------------------------------------------------

function clipEdgeSet(
  edges: Float32Array,
  insideFn: (x: number, y: number, z: number) => boolean,
  initialSamples: number = 8
): number[] {
  const output: number[] = [];

  for (let i = 0; i + 5 < edges.length; i += 6) {
    const ax = edges[i],   ay = edges[i+1], az = edges[i+2];
    const bx = edges[i+3], by = edges[i+4], bz = edges[i+5];

    // Sample N+1 points uniformly from t=0 to t=1
    const N = initialSamples;
    const samples: Array<{ t: number; x: number; y: number; z: number; inside: boolean }> = [];
    for (let j = 0; j <= N; j++) {
      const t = j / N;
      const sx = ax + t * (bx - ax);
      const sy = ay + t * (by - ay);
      const sz = az + t * (bz - az);
      samples.push({ t, x: sx, y: sy, z: sz, inside: insideFn(sx, sy, sz) });
    }

    let outsideStart: number | null = null;

    for (let j = 0; j <= N; j++) {
      const cur = samples[j];
      const prev = j > 0 ? samples[j - 1] : null;

      if (!cur.inside) {
        if (outsideStart === null) {
          if (prev !== null && prev.inside) {
            const [tx, ty, tz] = findTransition(
              prev.x, prev.y, prev.z,
              cur.x, cur.y, cur.z,
              true, insideFn
            );
            outsideStart = -1;
            output.push(tx, ty, tz);
          } else {
            outsideStart = j;
            output.push(cur.x, cur.y, cur.z);
          }
        }
      } else {
        if (outsideStart !== null) {
          const prevSample = samples[j - 1];
          const [tx, ty, tz] = findTransition(
            prevSample.x, prevSample.y, prevSample.z,
            cur.x, cur.y, cur.z,
            false, insideFn
          );
          output.push(tx, ty, tz);
          outsideStart = null;
        }
      }
    }

    if (outsideStart !== null) {
      output.push(bx, by, bz);
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent) => {
  const {
    spheres, base, tail,
    sphereEdgeGroups, baseEdges, tailEdges, spiralEdges, flowCloudEdges,
  } = e.data as {
    spheres: SphereDef[];
    base: BaseDef;
    tail: TailDef;
    sphereEdgeGroups: Array<{ sphereId: string; edges: Float32Array }>;
    baseEdges: Float32Array;
    tailEdges: Float32Array;
    spiralEdges: Float32Array;
    flowCloudEdges: Float32Array;
  };

  const tailSamples = sampleTailSpline(tail, 64);
  const baseSet     = sampleBaseSpline(base, 64);

  // ── Per-primitive clip functions ──────────────────────────────────────────
  //
  // CSG-inspired self-exclusion: each primitive's edges are clipped against
  // every OTHER primitive's solid volume, never against its own. This means:
  //   - Sphere A's wireframe survives inside sphere A (self-excluded)
  //   - Sphere A's wireframe is removed inside sphere B (cross-clipped)
  //   - No CLIP_INSET needed — the inset was only a self-protection hack
  //   - Zero-gap seams between adjacent primitives
  //
  // All containment tests use inset = 1.0 (exact visible surface boundary).

  const allVerts: number[] = [];

  // ── Sphere edges: per-sphere self-exclusion ──────────────────────────────
  for (const { sphereId, edges } of sphereEdgeGroups) {
    const otherSpheres = spheres.filter(sw => sw.id !== sphereId);
    const insideFn = (x: number, y: number, z: number): boolean => {
      for (const sw of otherSpheres) {
        if (insideSphere(x, y, z, sw, 1.0)) return true;
      }
      if (insideTailCapsule(x, y, z, tailSamples, 1.0)) return true;
      if (insideBaseExtrusion(x, y, z, baseSet, 1.0)) return true;
      return false;
    };
    allVerts.push(...clipEdgeSet(edges, insideFn));
  }

  // ── Tail edges: clipped by spheres + base (not self) ─────────────────────
  const insideForTail = (x: number, y: number, z: number): boolean => {
    for (const sw of spheres) {
      if (insideSphere(x, y, z, sw, 1.0)) return true;
    }
    if (insideBaseExtrusion(x, y, z, baseSet, 1.0)) return true;
    return false;
  };
  allVerts.push(...clipEdgeSet(tailEdges, insideForTail));

  // ── Base edges: clipped by spheres + tail (not self) ─────────────────────
  const insideForBase = (x: number, y: number, z: number): boolean => {
    for (const sw of spheres) {
      if (insideSphere(x, y, z, sw, 1.0)) return true;
    }
    if (insideTailCapsule(x, y, z, tailSamples, 1.0)) return true;
    return false;
  };
  allVerts.push(...clipEdgeSet(baseEdges, insideForBase));

  // ── Spiral edges: clipped by everything (no self-volume) ────────────────
  const insideForSpirals = (x: number, y: number, z: number): boolean => {
    for (const sw of spheres) {
      if (insideSphere(x, y, z, sw, 1.0)) return true;
    }
    if (insideTailCapsule(x, y, z, tailSamples, 1.0)) return true;
    if (insideBaseExtrusion(x, y, z, baseSet, 1.0)) return true;
    return false;
  };
  allVerts.push(...clipEdgeSet(spiralEdges, insideForSpirals));

  // ── Flow cloud edges: clipped by everything ──────────────────────────────
  const insideForFlowCloud = (x: number, y: number, z: number): boolean => {
    for (const sw of spheres) {
      if (insideSphere(x, y, z, sw, 1.0)) return true;
    }
    if (insideTailCapsule(x, y, z, tailSamples, 1.0)) return true;
    if (insideBaseExtrusion(x, y, z, baseSet, 1.0)) return true;
    return false;
  };
  allVerts.push(...clipEdgeSet(flowCloudEdges, insideForFlowCloud));

  const clippedEdges = new Float32Array(allVerts);
  self.postMessage({ clippedEdges }, { transfer: [clippedEdges.buffer] });
};
