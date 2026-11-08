/**
 * Paths sampled the way the editor draws them: points at equal arc-length steps along a curve,
 * each with the Frenet frame there (computeFrenetFrames, which parallel-transports the first
 * normal and, on a closed curve, spreads the closing twist over the samples).
 */

import type { CatmullRomCurve } from './catmullRom';
import { computeFrenetFrames } from './frames';
import type { Vec3 } from './vec3';

export interface PathSamples {
  /** segments + 1 points at arc length u = i / segments; on a closed curve the last is the first. */
  points: Vec3[];
  /** Unit tangents, normals and binormals at the same samples. */
  tangents: Vec3[];
  normals: Vec3[];
  binormals: Vec3[];
}

export function samplePath(curve: CatmullRomCurve, segments: number, closed: boolean): PathSamples {
  const { tangents, normals, binormals } = computeFrenetFrames(curve, segments, closed);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) points.push(curve.getPointAt(i / segments));
  return { points, tangents, normals, binormals };
}
