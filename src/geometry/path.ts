/**
 * Paths sampled the way the editor draws them: points at equal arc-length steps along a
 * three.js curve, each with the Frenet frame three computes there (Curve.computeFrenetFrames,
 * which parallel-transports the first normal and, on a closed curve, spreads the closing twist
 * over the samples).
 */

import type { Curve, Vector3 } from 'three';

export interface PathSamples {
  /** segments + 1 points at arc length u = i / segments; on a closed curve the last is the first. */
  points: Vector3[];
  /** Unit tangents, normals and binormals at the same samples. */
  tangents: Vector3[];
  normals: Vector3[];
  binormals: Vector3[];
}

export function samplePath(curve: Curve<Vector3>, segments: number, closed: boolean): PathSamples {
  const { tangents, normals, binormals } = curve.computeFrenetFrames(segments, closed);
  const points: Vector3[] = [];
  for (let i = 0; i <= segments; i++) points.push(curve.getPointAt(i / segments));
  return { points, tangents, normals, binormals };
}
