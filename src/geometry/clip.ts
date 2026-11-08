/**
 * Clipping of line-segment sets against a solid given as an inside test, for Cut & Glue.
 */

import type { Float32Builder } from './arrayBuilder';

// ---------------------------------------------------------------------------
// Bisection to find exact clip boundary
// ---------------------------------------------------------------------------

export function findTransition(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  isInsideA: boolean,
  insideFn: (x: number, y: number, z: number) => boolean,
  tol: number = 0.001,
  maxIter: number = 10
): [number, number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const mx = ax + mid * (bx - ax);
    const my = ay + mid * (by - ay);
    const mz = az + mid * (bz - az);
    if (insideFn(mx, my, mz) === isInsideA) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < tol) break;
  }
  const t = (lo + hi) / 2;
  return [ax + t*(bx - ax), ay + t*(by - ay), az + t*(bz - az)];
}

// ---------------------------------------------------------------------------
// Edge set clipping
// ---------------------------------------------------------------------------

/**
 * Keeps the parts of each segment (x,y,z,x,y,z pairs in `edges`) that lie outside the solid.
 * Each segment is tested at initialSamples + 1 evenly spaced points, and every inside/outside
 * change between neighbours is refined by bisection. Appends the surviving pieces to `output`
 * as pairs.
 */
export function clipEdgeSet(
  edges: Float32Array,
  insideFn: (x: number, y: number, z: number) => boolean,
  output: Float32Builder,
  initialSamples: number = 8
): void {

  for (let i = 0; i + 5 < edges.length; i += 6) {
    const ax = edges[i],   ay = edges[i+1], az = edges[i+2];
    const bx = edges[i+3], by = edges[i+4], bz = edges[i+5];

    // Sample N+1 points uniformly from t=0 to t=1
    const N = initialSamples;
    const samples: Array<{ t: number; x: number; y: number; z: number; inside: boolean }> = [];
    for (let j = 0; j <= N; j++) {
      const t = j / N;
      const sx = ax + t * (bx - ax);
      const sy = ay + t * (by - ay);
      const sz = az + t * (bz - az);
      samples.push({ t, x: sx, y: sy, z: sz, inside: insideFn(sx, sy, sz) });
    }

    let outsideStart: number | null = null;

    for (let j = 0; j <= N; j++) {
      const cur = samples[j];
      const prev = j > 0 ? samples[j - 1] : null;

      if (!cur.inside) {
        if (outsideStart === null) {
          if (prev !== null && prev.inside) {
            const [tx, ty, tz] = findTransition(
              prev.x, prev.y, prev.z,
              cur.x, cur.y, cur.z,
              true, insideFn
            );
            outsideStart = -1;
            output.push3(tx, ty, tz);
          } else {
            outsideStart = j;
            output.push3(cur.x, cur.y, cur.z);
          }
        }
      } else {
        if (outsideStart !== null) {
          const prevSample = samples[j - 1];
          const [tx, ty, tz] = findTransition(
            prevSample.x, prevSample.y, prevSample.z,
            cur.x, cur.y, cur.z,
            false, insideFn
          );
          output.push3(tx, ty, tz);
          outsideStart = null;
        }
      }
    }

    if (outsideStart !== null) {
      output.push3(bx, by, bz);
    }
  }
}
