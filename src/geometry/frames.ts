/**
 * Frenet frames along a curve as three.js computes them (Curve.computeFrenetFrames, r183), ported
 * operation for operation so every vector equals three's to the bit: tangents at equal
 * arc-length steps, a first normal perpendicular to the first tangent, then the normal carried
 * from sample to sample by the rotation between consecutive tangents and, on a closed curve, the
 * closing twist spread over the samples. See http://www.cs.indiana.edu/pub/techreports/TR425.pdf.
 */

import type { CatmullRomCurve } from './catmullRom';
import { cross, dot, length, normalize, vec3, type Vec3 } from './vec3';

export interface FrenetFrames {
  /** segments + 1 unit vectors each, at arc-length fractions i / segments. */
  tangents: Vec3[];
  normals: Vec3[];
  binormals: Vec3[];
}

/** MathUtils.clamp. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * v rotated by `angle` about the unit vector `axis`: Matrix4.makeRotationAxis applied by
 * Vector3.applyMatrix4. The matrix's zero translation and its last row (0, 0, 0, 1) stay in the
 * sums, as in three, because adding a zero can turn a -0 into a 0.
 */
function rotateAboutAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const x = axis.x, y = axis.y, z = axis.z;
  const tx = t * x, ty = t * y;

  // The rows of the upper 3 x 3 block, as makeRotationAxis passes them to Matrix4.set.
  const m11 = tx * x + c, m12 = tx * y - s * z, m13 = tx * z + s * y;
  const m21 = tx * y + s * z, m22 = ty * y + c, m23 = ty * z - s * x;
  const m31 = tx * z - s * y, m32 = ty * z + s * x, m33 = t * z * z + c;

  const vx = v.x, vy = v.y, vz = v.z;
  const w = 1 / (0 * vx + 0 * vy + 0 * vz + 1);
  return {
    x: (m11 * vx + m12 * vy + m13 * vz + 0) * w,
    y: (m21 * vx + m22 * vy + m23 * vz + 0) * w,
    z: (m31 * vx + m32 * vy + m33 * vz + 0) * w,
  };
}

export function computeFrenetFrames(curve: CatmullRomCurve, segments: number, closed: boolean): FrenetFrames {
  const tangents: Vec3[] = [];
  const normals: Vec3[] = [];
  const binormals: Vec3[] = [];

  for (let i = 0; i <= segments; i++) tangents[i] = curve.getTangentAt(i / segments);

  // The first normal: perpendicular to the first tangent, towards the axis of the tangent's
  // smallest component (the last of equal ones).
  let normal = vec3(0, 0, 0);
  let min = Number.MAX_VALUE;
  const tx = Math.abs(tangents[0].x);
  const ty = Math.abs(tangents[0].y);
  const tz = Math.abs(tangents[0].z);
  if (tx <= min) {
    min = tx;
    normal = vec3(1, 0, 0);
  }
  if (ty <= min) {
    min = ty;
    normal = vec3(0, 1, 0);
  }
  if (tz <= min) normal = vec3(0, 0, 1);

  const side = normalize(cross(tangents[0], normal));
  normals[0] = cross(tangents[0], side);
  binormals[0] = cross(tangents[0], normals[0]);

  // Each next normal: the previous one turned by the rotation from the previous tangent to this one.
  for (let i = 1; i <= segments; i++) {
    normals[i] = { ...normals[i - 1] };
    const axis = cross(tangents[i - 1], tangents[i]);
    if (length(axis) > Number.EPSILON) {
      const theta = Math.acos(clamp(dot(tangents[i - 1], tangents[i]), -1, 1));
      normals[i] = rotateAboutAxis(normals[i], normalize(axis), theta);
    }
    binormals[i] = cross(tangents[i], normals[i]);
  }

  // A closed curve: spread the twist between the first and the last normal over the samples.
  if (closed) {
    let theta = Math.acos(clamp(dot(normals[0], normals[segments]), -1, 1));
    theta /= segments;
    if (dot(tangents[0], cross(normals[0], normals[segments])) > 0) theta = -theta;
    for (let i = 1; i <= segments; i++) {
      normals[i] = rotateAboutAxis(normals[i], tangents[i], theta * i);
      binormals[i] = cross(tangents[i], normals[i]);
    }
  }

  return { tangents, normals, binormals };
}
