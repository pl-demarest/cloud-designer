/**
 * The flow-cloud worker's computation, a pure function of its request: marching cubes on the
 * metaball field of the spheres (plus the tail when tailStrength > 0) and, in spiral mode, the
 * band and flow-line wireframe traced over the resulting mesh.
 */

import type { SphereDef, TailDef, FlowCloudSettings } from '../../model/types';
import { emptyBox, expandBox, expandFlowCloudBounds } from '../../geometry/bounds';
import { evalMetaballField, extractSpiral } from '../../geometry/flowField';
import { fillField, gridFromBounds, polygonise } from '../../geometry/marchingCubes/polygonise';
import { sphereFrame } from '../../geometry/primitives/sphere';
import { attachedTail, sampleTailSpine } from '../../geometry/primitives/tail';
import type { FlowCloudRequest, FlowCloudResult } from '../protocol';

function marchingCubes(
  spheres: SphereDef[],
  tail: TailDef,
  flowCloud: FlowCloudSettings
): { vertices: Float32Array; indices: Uint32Array } {
  const res = flowCloud.resolution;
  const iso = flowCloud.threshold;
  const tailStrength = flowCloud.tailStrength;

  // The tail's spine as TailMesh draws it
  const tailSamples = tailStrength > 0 ? sampleTailSpine(tail) : [];

  // Compute bounding box from spheres
  const box = emptyBox();
  expandFlowCloudBounds(box, spheres, [0, 0, 0]);

  // Extend bounding box to include tail setpoints
  for (const sp of tail.setpoints) {
    expandBox(box, sp.position[0], sp.position[1], sp.position[2], sp.width + 0.5);
  }

  if (!isFinite(box.minX)) {
    return { vertices: new Float32Array(), indices: new Uint32Array() };
  }

  const grid = gridFromBounds(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ, res);

  // Build scalar field
  const frames = spheres.map(sphereFrame);
  const field = fillField(grid, (x, y, z) => evalMetaballField(x, y, z, frames, tailSamples, tailStrength));

  // March cubes
  const { positions, indices } = polygonise(field, grid, iso);
  return { vertices: positions, indices };
}

export function generateFlowCloud(request: FlowCloudRequest): FlowCloudResult {
  const { spheres, flowCloud } = request;
  const tail = attachedTail(request.tail, request.base);

  const { vertices, indices } = marchingCubes(spheres, tail, flowCloud);

  let bands: Float32Array[] = [];
  let flowLines: Float32Array[] = [];

  if (vertices.length > 0 && flowCloud.wireframe.mode === 'spiral') {
    const extracted = extractSpiral(vertices, indices, flowCloud, spheres, tail);
    bands = extracted.bands;
    flowLines = extracted.flowLines;
  }

  return { vertices, indices, bands, flowLines };
}
