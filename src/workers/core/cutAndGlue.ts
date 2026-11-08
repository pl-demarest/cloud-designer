/**
 * The cut-and-glue worker's computation, a pure function of its request.
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

import { insideSphere, sphereFrame } from '../../geometry/primitives/sphere';
import { attachedTail, insideTailCapsule, sampleTailSpine } from '../../geometry/primitives/tail';
import { buildBaseVolume, insideBase } from '../../geometry/primitives/base';
import { clipEdgeSet } from '../../geometry/clip';
import { Float32Builder } from '../../geometry/arrayBuilder';
import type { CutGlueRequest, CutGlueResult } from '../protocol';

export function cutAndGlue(request: CutGlueRequest): CutGlueResult {
  const {
    spheres, base,
    sphereEdgeGroups, baseEdges, tailEdges, spiralEdges, flowCloudEdges,
  } = request;

  const tailSamples = sampleTailSpine(attachedTail(request.tail, base));
  const baseVolume  = buildBaseVolume(base);
  const frames      = spheres.map(sphereFrame);

  // ── Per-primitive clip functions ──────────────────────────────────────────
  //
  // CSG-inspired self-exclusion: each primitive's edges are clipped against
  // every OTHER primitive's solid volume, never against its own. This means:
  //   - Sphere A's wireframe survives inside sphere A (self-excluded)
  //   - Sphere A's wireframe is removed inside sphere B (cross-clipped)
  //   - No CLIP_INSET needed — the inset was only a self-protection hack
  //   - Zero-gap seams between adjacent primitives
  //
  // Every containment test uses the exact visible surface boundary.

  // Every group's surviving pieces, in order. A growable typed array: spreading a group's
  // output into a push() overflowed the call stack above about 120,000 floats.
  const out = new Float32Builder();

  // ── Sphere edges: per-sphere self-exclusion ──────────────────────────────
  for (const { sphereId, edges } of sphereEdgeGroups) {
    const otherSpheres = frames.filter(f => f.def.id !== sphereId);
    const insideFn = (x: number, y: number, z: number): boolean => {
      for (const f of otherSpheres) {
        if (insideSphere(x, y, z, f)) return true;
      }
      if (insideTailCapsule(x, y, z, tailSamples)) return true;
      if (insideBase(x, y, z, baseVolume)) return true;
      return false;
    };
    clipEdgeSet(edges, insideFn, out);
  }

  // ── Tail edges: clipped by spheres + base (not self) ─────────────────────
  const insideForTail = (x: number, y: number, z: number): boolean => {
    for (const f of frames) {
      if (insideSphere(x, y, z, f)) return true;
    }
    if (insideBase(x, y, z, baseVolume)) return true;
    return false;
  };
  clipEdgeSet(tailEdges, insideForTail, out);

  // ── Base edges: clipped by spheres + tail (not self) ─────────────────────
  const insideForBase = (x: number, y: number, z: number): boolean => {
    for (const f of frames) {
      if (insideSphere(x, y, z, f)) return true;
    }
    if (insideTailCapsule(x, y, z, tailSamples)) return true;
    return false;
  };
  clipEdgeSet(baseEdges, insideForBase, out);

  // ── Spiral edges: clipped by everything (no self-volume) ────────────────
  const insideForSpirals = (x: number, y: number, z: number): boolean => {
    for (const f of frames) {
      if (insideSphere(x, y, z, f)) return true;
    }
    if (insideTailCapsule(x, y, z, tailSamples)) return true;
    if (insideBase(x, y, z, baseVolume)) return true;
    return false;
  };
  clipEdgeSet(spiralEdges, insideForSpirals, out);

  // ── Flow cloud edges: clipped by everything ──────────────────────────────
  const insideForFlowCloud = (x: number, y: number, z: number): boolean => {
    for (const f of frames) {
      if (insideSphere(x, y, z, f)) return true;
    }
    if (insideTailCapsule(x, y, z, tailSamples)) return true;
    if (insideBase(x, y, z, baseVolume)) return true;
    return false;
  };
  clipEdgeSet(flowCloudEdges, insideForFlowCloud, out);

  return { clippedEdges: out.toArray() };
}
