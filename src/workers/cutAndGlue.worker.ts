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
import { clipEdgeSet } from '../geometry/clip';

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
