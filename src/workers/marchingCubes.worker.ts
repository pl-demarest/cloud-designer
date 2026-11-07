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
import { evalMetaballField, extractSpiral } from '../geometry/flowField';

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
