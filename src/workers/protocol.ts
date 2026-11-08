/**
 * Messages between the main thread and the three geometry workers.
 *
 * A request is what EditorEngine posts, through a WorkerClient (src/engine/WorkerClient.ts) that
 * keeps one request in flight per worker. A result is what the worker's core (./core/*.ts)
 * returns; the worker posts it with every typed-array buffer in the transfer list. When the
 * computation throws, the worker replies with WorkerError instead.
 */

import type { SphereDef, BaseDef, TailDef, FlowCloudSettings, SpiralDef } from '../model/types';

/** The reply of a worker whose computation threw: `String(err)`. */
export interface WorkerError {
  error: string;
}

// ── Flow cloud: marchingCubes.worker.ts ─────────────────────────────────────

export interface FlowCloudRequest {
  spheres: SphereDef[];
  /** An attached tail starts on it (resolveTailSetpoints). */
  base: BaseDef;
  tail: TailDef;
  flowCloud: FlowCloudSettings;
}

export interface FlowCloudResult {
  /** The metaball isosurface, three floats per vertex. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Constant-u band contours, one array of segment pairs per contour level (spiral mode with
   *  generateBands only). */
  bands: Float32Array[];
  /** Flow lines, one polyline per connected piece of each line, from low to high u (spiral mode;
   *  showFlowLines only shows or hides them). */
  flowLines: Float32Array[];
}

// ── Surface mesh: surfaceMesh.worker.ts ─────────────────────────────────────

export interface SurfaceMeshRequest {
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  /** The live flow-cloud settings: flowCloud.position places the flow cloud, as the viewport
   *  places the shown one. */
  flowCloud: FlowCloudSettings;
  spirals: SpiralDef[];
  /** Grid cells per axis. */
  resolution: number;
  /** Union the flow cloud: one has been generated and Show/Hide shows it. */
  includeFlowCloud: boolean;
  /** The request of the Regenerate whose result the viewport shows (null before the first).
   *  The flow cloud's field is evaluated from these inputs, not from the live spheres, so the
   *  union holds the flow cloud the user sees. */
  flowCloudInput: FlowCloudRequest | null;
}

export interface SurfaceMeshResult {
  positions: Float32Array;
  indices: Uint32Array;
}

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

