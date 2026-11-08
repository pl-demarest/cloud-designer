/**
 * The surface-mesh worker's computation, a pure function of its request.
 *
 * Generates a unified homogeneous triangle mesh over the entire cloud surface
 * by evaluating a signed distance field (SDF) representing the boolean union
 * of all solid primitives (spheres, base, tail, thick spirals and, when the
 * request includes it, the flow cloud's isosurface as last generated) and
 * running marching cubes on it.
 *
 * The SDF approach guarantees uniform mesh topology — the same grid pattern
 * as the flow cloud's marching cubes output, but covering everything.
 */

import { BOUND_SLACK, boxDistance, emptyBox, expandBox, expandFlowCloudBounds } from '../../geometry/bounds';
import { evalMetaballField } from '../../geometry/flowField';
import { fillField, gridFromBounds, polygonise } from '../../geometry/marchingCubes/polygonise';
import { sphereExtent, sphereFrame, sphereSDF } from '../../geometry/primitives/sphere';
import type { SphereFrame } from '../../geometry/primitives/sphere';
import { attachedTail, buildTailVolume, sampleTailSpine, tailSDF } from '../../geometry/primitives/tail';
import type { TailSample, TailVolume } from '../../geometry/primitives/tail';
import { baseSDF, buildBaseVolume, sectionReach } from '../../geometry/primitives/base';
import type { BaseVolume } from '../../geometry/primitives/base';
import { buildSpiralVolume, sampleSpiral, spiralSDF } from '../../geometry/primitives/spiral';
import type { SpiralSample, SpiralVolume } from '../../geometry/primitives/spiral';
import type { SurfaceMeshRequest, SurfaceMeshResult } from '../protocol';

/** How far the grid's boundary stays outside the base and tail solids (generateSurfaceMesh). */
const SOLID_MARGIN = 0.1;

/** The flow cloud's metaball field as the shown flow cloud was generated, placed in the world. */
interface FlowCloudField {
  frames: SphereFrame[];
  tailSamples: TailSample[];
  tailStrength: number;
  threshold: number;
  position: readonly [number, number, number];
}

/** Combined SDF: boolean union of all primitives.
 *  Returns negative inside the cloud, positive outside.
 *  The flow cloud's position offsets its metaball field to world space; null leaves it out.
 *  The cheap terms come first, so that the tail, the base and the spirals can be skipped, in
 *  whole or in part, where their lower bounds lie above the union so far; the minimum does not
 *  depend on the order. */
function evalSDF(
  x: number, y: number, z: number,
  spheres: SphereFrame[],
  tail: TailVolume,
  baseVolume: BaseVolume,
  flowCloud: FlowCloudField | null,
  spirals: SpiralVolume[],
): number {
  let d = Infinity;

  // Sphere SDFs (geometric radius, not metaball)
  for (const f of spheres) {
    d = Math.min(d, sphereSDF(x, y, z, f));
  }

  // Flow cloud SDF: threshold - metaball field
  if (flowCloud) {
    // Transform point to flow cloud local space (subtract position offset)
    const fcPos = flowCloud.position;
    const localX = x - fcPos[0];
    const localY = y - fcPos[1];
    const localZ = z - fcPos[2];
    const field = evalMetaballField(localX, localY, localZ, flowCloud.frames, flowCloud.tailSamples, flowCloud.tailStrength);
    const flowCloudD = (flowCloud.threshold - field);
    // flowCloudD is negative inside the isosurface (field > threshold)
    d = Math.min(d, flowCloudD);
  }

  // Tail SDF
  if (tail.count >= 2 && boxDistance(tail.box, x, y, z) - tail.maxWidth <= d + BOUND_SLACK) {
    d = Math.min(d, tailSDF(x, y, z, tail, d));
  }

  // Base SDF
  if (baseVolume.count > 0) {
    d = Math.min(d, baseSDF(x, y, z, baseVolume, d));
  }

  // Spiral SDFs (thick spirals only — flat ribbons have no volume)
  for (const v of spirals) {
    if (v.n > 0) {
      d = Math.min(d, spiralSDF(x, y, z, v, d));
    }
  }

  return d;
}

export function generateSurfaceMesh(input: SurfaceMeshRequest): SurfaceMeshResult {
  const { spheres, base, flowCloud, spirals, resolution } = input;
  const res = resolution;
  const tail = attachedTail(input.tail, base);

  // Sample splines
  const tailVolume = buildTailVolume(tail);
  const baseVolume = buildBaseVolume(base);

  // The flow cloud as the viewport shows it: the field of its last Regenerate's inputs (their
  // spheres and, when tailStrength > 0, their tail), at the live position.
  const fcInput = input.includeFlowCloud ? input.flowCloudInput : null;
  const fcTail = fcInput ? attachedTail(fcInput.tail, fcInput.base) : null;
  const fcTailSamples = fcInput && fcTail && fcInput.flowCloud.tailStrength > 0 ? sampleTailSpine(fcTail) : [];

  // Sample the thick spirals; a flat ribbon has no volume.
  const allSpiralSamples: SpiralSample[][] = spirals.filter((sp) => sp.thickness > 0).map((sp) => sampleSpiral(sp));

  // Compute bounding box from all primitives
  const box = emptyBox();

  // Spheres
  for (const sw of spheres) {
    expandBox(box, sw.position[0], sw.position[1], sw.position[2], sphereExtent(sw) + 0.5);
  }

  // Tail setpoints
  for (const sp of tail.setpoints) {
    expandBox(box, sp.position[0], sp.position[1], sp.position[2], sp.width + 0.5);
  }

  // Base control points
  const baseHalf = Math.max(base.crossSectionWidth, base.crossSectionHeight) / 2;
  for (const cp of base.controlPoints) {
    expandBox(box, cp[0], cp[1], cp[2], baseHalf + 0.5);
  }

  // The base and tail solids themselves, ring by ring: a curve overshoots its control points
  // where it turns sharply (by about an eighth of the leg at a hairpin), past the padding above,
  // and a solid that reaches the grid's boundary leaves the mesh open there. Every boundary node
  // stays SOLID_MARGIN outside both solids; where the padding above holds them, the grid is the
  // same as before.
  const baseReach = sectionReach(baseVolume);
  for (let k = 0; k < baseVolume.count; k++) {
    const i = 3 * k;
    expandBox(box, baseVolume.p[i], baseVolume.p[i + 1], baseVolume.p[i + 2], baseReach + SOLID_MARGIN);
  }
  for (let k = 0; k < tailVolume.count; k++) {
    const i = 3 * k;
    expandBox(box, tailVolume.p[i], tailVolume.p[i + 1], tailVolume.p[i + 2], tailVolume.w[k] + SOLID_MARGIN);
  }

  // Flow cloud: its isosurface, moved by flowCloud.position
  if (fcInput) expandFlowCloudBounds(box, fcInput.spheres, fcTailSamples, fcInput.flowCloud, flowCloud.position);

  // Spiral samples (use pre-computed world-space centers)
  for (const samples of allSpiralSamples) {
    for (const s of samples) {
      const pad = Math.max(s.halfThick, s.halfSep) + 0.5;
      expandBox(box, s.cx, s.cy, s.cz, pad);
    }
  }

  if (!isFinite(box.minX)) {
    return { positions: new Float32Array(), indices: new Uint32Array() };
  }

  const grid = gridFromBounds(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ, res);

  // Build SDF field — store negated SDF so MC's "field >= 0" = "inside"
  const frames = spheres.map(sphereFrame);
  const flowCloudField: FlowCloudField | null = fcInput && {
    frames: fcInput.spheres.map(sphereFrame),
    tailSamples: fcTailSamples,
    tailStrength: fcInput.flowCloud.tailStrength,
    threshold: fcInput.flowCloud.threshold,
    position: flowCloud.position,
  };
  const spiralVolumes = allSpiralSamples.map(buildSpiralVolume);
  const field = fillField(grid, (x, y, z) =>
    -evalSDF(x, y, z, frames, tailVolume, baseVolume, flowCloudField, spiralVolumes));

  // March cubes at threshold = 0
  return polygonise(field, grid, 0);
}
