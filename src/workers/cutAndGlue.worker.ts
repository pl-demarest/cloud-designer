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
import { insideSphere } from '../geometry/primitives/sphere';
import { insideTailCapsule, sampleTailSpline } from '../geometry/primitives/tail';
import { insideBaseExtrusion, sampleBaseSpline } from '../geometry/primitives/base';

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
