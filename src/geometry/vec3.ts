/**
 * Three-component vectors for the curve code (catmullRom.ts, frames.ts, path.ts). Each operation
 * computes what three.js's Vector3 method of the same purpose computes, in the same order, so the
 * results are equal to the bit. three's Vector3 has the same x, y, z fields, so code that only
 * reads them takes either.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** a - b (Vector3.subVectors). */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** a x b (Vector3.crossVectors). */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** a . b (Vector3.dot). */
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** |v| (Vector3.length). */
export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** |a - b| (Vector3.distanceTo). */
export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** v / |v|, or v itself for a zero vector (Vector3.normalize: a multiply by 1 / length). */
export function normalize(v: Vec3): Vec3 {
  const s = 1 / (length(v) || 1);
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
