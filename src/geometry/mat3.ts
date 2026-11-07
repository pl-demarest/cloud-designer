/**
 * 3x3 rotation matrices as nine numbers, row-major: m[3 * row + col].
 */

/**
 * The rotation of Euler angles (x, y, z) in radians, order 'XYZ', as three.js applies an
 * Object3D's `rotation`: the terms of Matrix4.makeRotationFromEuler, computed in the same order.
 */
export function eulerXYZ(x: number, y: number, z: number): Float64Array {
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return Float64Array.of(
    c * e, -c * f, d,
    af + be * d, ae - bf * d, -b * c,
    bf - ae * d, be + af * d, a * c,
  );
}
