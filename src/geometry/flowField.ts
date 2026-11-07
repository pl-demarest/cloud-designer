/**
 * The flow cloud's metaball field, evaluated by both the flow-cloud worker (which meshes
 * field >= threshold) and the surface-mesh worker (which unions threshold - field into its SDF).
 */

import type { SphereDef } from '../types/cloud';
import type { TailSample } from './primitives/tail';

/** Metaball field at (x, y, z). Each sphere adds falloff * r^2 / d^2 (falloff * 100 within
 *  0.01 of its centre); the tail adds tailStrength times the same term for the nearest point
 *  on its sampled spine. A sphere without `scale` or `falloff` counts as scale 1, falloff 0.5. */
export function evalMetaballField(
  x: number, y: number, z: number,
  spheres: SphereDef[],
  tailSamples: TailSample[],
  tailStrength: number
): number {
  let val = 0;

  // Sphere metaballs
  for (const sw of spheres) {
    let dx = x - sw.position[0];
    let dy = y - sw.position[1];
    let dz = z - sw.position[2];

    if (sw.shape === 'ellipsoid') {
      dx /= (sw.scale?.[0] ?? 1);
      dy /= (sw.scale?.[1] ?? 1);
      dz /= (sw.scale?.[2] ?? 1);
    }

    const dist2 = dx * dx + dy * dy + dz * dz;
    const r2 = sw.radius * sw.radius;
    if (dist2 < 0.0001) {
      val += (sw.falloff ?? 0.5) * 100;
    } else {
      val += (sw.falloff ?? 0.5) * r2 / dist2;
    }
  }

  // Tail metaball — find closest point on sampled spine and treat as a
  // variable-radius capsule. Using nearest-segment to avoid double-counting.
  if (tailSamples.length >= 2 && tailStrength > 0) {
    let minDist2 = Infinity;
    let minRadius = 0;

    for (let i = 0; i < tailSamples.length - 1; i++) {
      const a = tailSamples[i];
      const b = tailSamples[i + 1];
      const abx = b.px - a.px, aby = b.py - a.py, abz = b.pz - a.pz;
      const ab2 = abx * abx + aby * aby + abz * abz;
      const apx = x - a.px, apy = y - a.py, apz = z - a.pz;
      const t = ab2 > 0.00001 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0;
      const cx = a.px + t * abx, cy = a.py + t * aby, cz = a.pz + t * abz;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
      if (d2 < minDist2) {
        minDist2 = d2;
        minRadius = a.width + t * (b.width - a.width);
      }
    }

    const r2 = minRadius * minRadius;
    val += tailStrength * (minDist2 < 0.0001 ? 100 * r2 : r2 / minDist2);
  }

  return val;
}
