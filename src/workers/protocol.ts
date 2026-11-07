/**
 * Messages between the main thread and the three geometry workers.
 *
 * A request is what App.tsx or FlowCloud.ts posts. A result is what the worker's core
 * (./core/*.ts) returns; the worker posts it with every typed-array buffer in the transfer
 * list. A worker that catches its core's exceptions replies with WorkerError instead.
 */

import type { SphereDef, BaseDef, TailDef, FlowCloudSettings, SpiralDef } from '../types/cloud';

/** The reply of a worker whose computation threw: `String(err)`. */
export interface WorkerError {
  error: string;
}

// ── Flow cloud: marchingCubes.worker.ts ─────────────────────────────────────

export interface FlowCloudRequest {
  spheres: SphereDef[];
  /** Posted by FlowCloud.dispatch; the worker does not read it. */
  base: BaseDef;
  tail: TailDef;
  flowCloud: FlowCloudSettings;
}

export interface FlowCloudResult {
  /** The metaball isosurface, three floats per vertex. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Constant-u band contours as segment pairs (spiral mode with generateBands only). */
  bands: Float32Array[];
  /** Flow-line polylines (spiral mode with showFlowLines only). */
  flowLines: Float32Array[];
}

export type FlowCloudResponse = FlowCloudResult | WorkerError;

// ── Surface mesh: surfaceMesh.worker.ts ─────────────────────────────────────

export interface SurfaceMeshRequest {
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  flowCloud: FlowCloudSettings;
  spirals: SpiralDef[];
  /** Grid cells per axis. */
  resolution: number;
}

export interface SurfaceMeshResult {
  positions: Float32Array;
  indices: Uint32Array;
}

export type SurfaceMeshResponse = SurfaceMeshResult | WorkerError;

// ── Cut & Glue: cutAndGlue.worker.ts ────────────────────────────────────────

/** One sphere's wireframe; it is clipped by every volume except that sphere's own. */
export interface SphereEdgeGroup {
  sphereId: string;
  edges: Float32Array;
}

/** Edge buffers hold world-space segments as x,y,z,x,y,z pairs. */
export interface CutGlueRequest {
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  sphereEdgeGroups: SphereEdgeGroup[];
  baseEdges: Float32Array;
  tailEdges: Float32Array;
  spiralEdges: Float32Array;
  flowCloudEdges: Float32Array;
}

export interface CutGlueResult {
  /** The surviving segments, as x,y,z,x,y,z pairs. */
  clippedEdges: Float32Array;
}

/** The cut-and-glue worker does not catch exceptions: they reach Worker.onerror. */
export type CutGlueResponse = CutGlueResult;
