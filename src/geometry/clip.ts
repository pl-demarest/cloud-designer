/**
 * Clipping of line-segment sets against a solid given as an inside test, for Cut & Glue.
 */

import type { Float32Builder } from './arrayBuilder';

/** Points each segment is tested at, less one: its ends and the seven between. */
const SAMPLES = 8;
/** A transition is bisected until its interval, as a fraction of the step, is below TOLERANCE,
 *  or for at most STEPS halvings. */
const TOLERANCE = 0.001;
const STEPS = 10;

// ---------------------------------------------------------------------------
// Bisection to find exact clip boundary
// ---------------------------------------------------------------------------

function findTransition(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  isInsideA: boolean,
  insideFn: (x: number, y: number, z: number) => boolean,
): [number, number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < STEPS; i++) {
    const mid = (lo + hi) / 2;
    const mx = ax + mid * (bx - ax);
    const my = ay + mid * (by - ay);
    const mz = az + mid * (bz - az);
    if (insideFn(mx, my, mz) === isInsideA) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < TOLERANCE) break;
  }
  const t = (lo + hi) / 2;
  return [ax + t*(bx - ax), ay + t*(by - ay), az + t*(bz - az)];
}

// ---------------------------------------------------------------------------
// Edge set clipping
// ---------------------------------------------------------------------------

/**
 * Keeps the parts of each segment (x,y,z,x,y,z pairs in `edges`) that lie outside the solid.
 * Each segment is tested at SAMPLES + 1 evenly spaced points, and every inside/outside change
 * between neighbours is refined by bisection. Appends the surviving pieces to `output` as pairs.
 */
export function clipEdgeSet(
  edges: Float32Array,
  insideFn: (x: number, y: number, z: number) => boolean,
  output: Float32Builder,
): void {

  for (let i = 0; i + 5 < edges.length; i += 6) {
    const ax = edges[i],   ay = edges[i+1], az = edges[i+2];
    const bx = edges[i+3], by = edges[i+4], bz = edges[i+5];

    // Sample N+1 points uniformly from t=0 to t=1
    const N = SAMPLES;
    const samples: Array<{ x: number; y: number; z: number; inside: boolean }> = [];
    for (let j = 0; j <= N; j++) {
      const t = j / N;
      const sx = ax + t * (bx - ax);
      const sy = ay + t * (by - ay);
      const sz = az + t * (bz - az);
      samples.push({ x: sx, y: sy, z: sz, inside: insideFn(sx, sy, sz) });
    }

    // Whether the samples so far end in a piece outside the solid, whose start is in `output`.
    let outside = false;

    for (let j = 0; j <= N; j++) {
      const cur = samples[j];
      const prev = j > 0 ? samples[j - 1] : null;

      if (!cur.inside) {
        if (!outside) {
          if (prev !== null && prev.inside) {
            const [tx, ty, tz] = findTransition(
              prev.x, prev.y, prev.z,
              cur.x, cur.y, cur.z,
              true, insideFn
            );
            output.push3(tx, ty, tz);
          } else {
            output.push3(cur.x, cur.y, cur.z);
          }
          outside = true;
        }
      } else {
        if (outside) {
          const prevSample = samples[j - 1];
          const [tx, ty, tz] = findTransition(
            prevSample.x, prevSample.y, prevSample.z,
            cur.x, cur.y, cur.z,
            false, insideFn
          );
          output.push3(tx, ty, tz);
          outside = false;
        }
      }
    }

    if (outside) {
      output.push3(bx, by, bz);
    }
  }
}
