/**
 * The surface-mesh worker's computation, a pure function of its request.
 *
 * Generates a unified homogeneous triangle mesh over the entire cloud surface
 * by evaluating a signed distance field (SDF) representing the boolean union
 * of all solid primitives (spheres, base, tail, flow cloud isosurface, thick
 * spirals) and running marching cubes on it.
 *
 * The SDF approach guarantees uniform mesh topology — the same grid pattern
 * as the flow cloud's marching cubes output, but covering everything.
 */

import type { SphereDef, FlowCloudSettings } from '../../model/types';
import { evalMetaballField } from '../../geometry/flowField';
import { fillField, gridFromBounds, polygonise } from '../../geometry/marchingCubes/polygonise';
import { sphereSDF } from '../../geometry/primitives/sphere';
import { sampleTailSpline, tailSDF } from '../../geometry/primitives/tail';
import type { TailSample } from '../../geometry/primitives/tail';
import { baseSDF, buildBaseVolume } from '../../geometry/primitives/base';
import type { BaseVolume } from '../../geometry/primitives/base';
import { sampleSpiral, spiralSDF } from '../../geometry/primitives/spiral';
import type { SpiralSample } from '../../geometry/primitives/spiral';
import type { SurfaceMeshRequest, SurfaceMeshResult } from '../protocol';

/** Combined SDF: boolean union of all primitives.
 *  Returns negative inside the cloud, positive outside.
 *  flowCloudPos offsets the metaball field to world space. */
function evalSDF(
  x: number, y: number, z: number,
  spheres: SphereDef[],
  tailSamples: TailSample[],
  baseVolume: BaseVolume,
  flowCloud: FlowCloudSettings,
  fcTailSamples: TailSample[],
  allSpiralSamples: SpiralSample[][],
): number {
  let d = Infinity;

  // Sphere SDFs (geometric radius, not metaball)
  for (const sw of spheres) {
    d = Math.min(d, sphereSDF(x, y, z, sw));
  }

  // Tail SDF
  if (tailSamples.length >= 2) {
    d = Math.min(d, tailSDF(x, y, z, tailSamples));
  }

  // Base SDF
  if (baseVolume.count > 0) {
    d = Math.min(d, baseSDF(x, y, z, baseVolume));
  }

  // Flow cloud SDF: threshold - metaball field
  // Transform point to flow cloud local space (subtract position offset)
  const fcPos = flowCloud.position;
  const localX = x - fcPos[0];
  const localY = y - fcPos[1];
  const localZ = z - fcPos[2];
  const tailStrength = flowCloud.tailStrength;
  const field = evalMetaballField(localX, localY, localZ, spheres, fcTailSamples, tailStrength);
  const flowCloudD = (flowCloud.threshold - field);
  // flowCloudD is negative inside the isosurface (field > threshold)
  d = Math.min(d, flowCloudD);

  // Spiral SDFs (thick spirals only — flat ribbons have no volume)
  for (const samples of allSpiralSamples) {
    if (samples.length > 0) {
      d = Math.min(d, spiralSDF(x, y, z, samples));
    }
  }

  return d;
}

export function generateSurfaceMesh(input: SurfaceMeshRequest): SurfaceMeshResult {
  const { spheres, base, tail, flowCloud, spirals, resolution } = input;
  const res = resolution;

  // Sample splines
  const tailSamples = sampleTailSpline(tail, 64);
  const baseVolume = buildBaseVolume(base);

  // Tail samples for the metaball field (flow cloud SDF component)
  const tailStrength = flowCloud.tailStrength;
  const fcTailSamples = tailStrength > 0 ? sampleTailSpline(tail, 32) : [];

  // Sample spirals (only thick ones produce samples)
  const allSpiralSamples: SpiralSample[][] = spirals.map(
    (sp) => sampleSpiral(sp, 64)
  );

  // Compute bounding box from all primitives
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const expandBounds = (x: number, y: number, z: number, pad: number) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    minZ = Math.min(minZ, z - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
    maxZ = Math.max(maxZ, z + pad);
  };

  // Spheres
  for (const sw of spheres) {
    const maxScale = Math.max(sw.scale[0], sw.scale[1], sw.scale[2]);
    expandBounds(sw.position[0], sw.position[1], sw.position[2], sw.radius * maxScale + 0.5);
  }

  // Tail setpoints
  for (const sp of tail.setpoints) {
    expandBounds(sp.position[0], sp.position[1], sp.position[2], sp.width + 0.5);
  }

  // Base control points
  const baseHalf = Math.max(base.crossSectionWidth, base.crossSectionHeight) / 2;
  for (const cp of base.controlPoints) {
    expandBounds(cp[0], cp[1], cp[2], baseHalf + 0.5);
  }

  // Flow cloud: sphere positions shifted by flowCloud.position
  const fcPos = flowCloud.position;
  for (const sw of spheres) {
    const maxScale = Math.max(sw.scale[0], sw.scale[1], sw.scale[2]);
    expandBounds(
      sw.position[0] + fcPos[0],
      sw.position[1] + fcPos[1],
      sw.position[2] + fcPos[2],
      sw.radius * maxScale + 1.5
    );
  }

  // Spiral samples (use pre-computed world-space centers)
  for (const samples of allSpiralSamples) {
    for (const s of samples) {
      const pad = Math.max(s.halfThick, s.halfSep) + 0.5;
      expandBounds(s.cx, s.cy, s.cz, pad);
    }
  }

  if (!isFinite(minX)) {
    return { positions: new Float32Array(), indices: new Uint32Array() };
  }

  const grid = gridFromBounds(minX, minY, minZ, maxX, maxY, maxZ, res);

  // Build SDF field — store negated SDF so MC's "field >= 0" = "inside"
  const field = fillField(grid, (x, y, z) =>
    -evalSDF(x, y, z, spheres, tailSamples, baseVolume, flowCloud, fcTailSamples, allSpiralSamples));

  // March cubes at threshold = 0
  return polygonise(field, grid, { kind: 'negatedSdf' });
}
