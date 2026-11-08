export type Vec3 = [number, number, number];

export const AXES = ['X', 'Y', 'Z'] as const;

/** `v` with component `axis` set to `x`, as a new array. */
export function withAxis(v: readonly [number, number, number], axis: number, x: number): Vec3 {
  const next: Vec3 = [v[0], v[1], v[2]];
  next[axis] = x;
  return next;
}
