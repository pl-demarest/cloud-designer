/**
 * The curve BaseMesh and TailMesh draw: three.js's CatmullRomCurve3 with curveType 'catmullrom'
 * and tension 0.5, open or closed, with the arc-length parametrisation of three's Curve
 * (getLengths, getUtoTmapping, getPointAt) and its tangents (getTangent, getTangentAt). Ported
 * from three r183 (src/extras/curves/CatmullRomCurve3.js, src/extras/core/Curve.js) operation
 * for operation, so every value equals three's to the bit, without three in the workers.
 */

import { distance, normalize, sub, type Vec3 } from './vec3';

/** The tension of the uniform ('catmullrom') curve type. */
const TENSION = 0.5;

/** Curve.arcLengthDivisions: the arc-length table measures this many chords. */
const ARC_LENGTH_DIVISIONS = 200;

/** The parameter step either side of t in Curve.getTangent's difference. */
const TANGENT_DELTA = 0.0001;

/**
 * The cubic from x1 (at w = 0) to x2 (at w = 1) whose end tangents are TENSION times x2 - x0 and
 * x3 - x1, at w: CubicPoly's initCatmullRom, init and calc.
 */
function cubic(x0: number, x1: number, x2: number, x3: number, w: number): number {
  const t0 = TENSION * (x2 - x0);
  const t1 = TENSION * (x3 - x1);
  const c0 = x1;
  const c1 = t0;
  const c2 = -3 * x1 + 3 * x2 - 2 * t0 - t1;
  const c3 = 2 * x1 - 2 * x2 + t0 + t1;
  const w2 = w * w;
  const w3 = w2 * w;
  return c0 + c1 * w + c2 * w2 + c3 * w3;
}

/**
 * The phantom point past an open curve's end, which three keeps in one module-level vector: the
 * end point reflected through its neighbour, (end - next) + end. A two-point curve needs both
 * phantoms in one evaluation; the second overwrites the first, so both are 2 P1 - P0, as in three.
 */
const phantom: Vec3 = { x: 0, y: 0, z: 0 };

function setPhantom(end: Vec3, next: Vec3): Vec3 {
  phantom.x = end.x - next.x + end.x;
  phantom.y = end.y - next.y + end.y;
  phantom.z = end.z - next.z + end.z;
  return phantom;
}

export class CatmullRomCurve {
  readonly points: readonly Vec3[];
  readonly closed: boolean;
  /** getLengths' table, computed on first use. */
  private lengths: number[] | null = null;

  /** At least two points. */
  constructor(points: readonly Vec3[], closed: boolean) {
    this.points = points;
    this.closed = closed;
  }

  /** The point at curve parameter t in [0, 1] (CatmullRomCurve3.getPoint). */
  getPoint(t: number): Vec3 {
    const points = this.points;
    const l = points.length;

    const p = (l - (this.closed ? 0 : 1)) * t;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
    } else if (weight === 0 && intPoint === l - 1) {
      intPoint = l - 2;
      weight = 1;
    }

    const p0 = this.closed || intPoint > 0 ? points[(intPoint - 1) % l] : setPhantom(points[0], points[1]);
    const p1 = points[intPoint % l];
    const p2 = points[(intPoint + 1) % l];
    const p3 = this.closed || intPoint + 2 < l ? points[(intPoint + 2) % l] : setPhantom(points[l - 1], points[l - 2]);

    return {
      x: cubic(p0.x, p1.x, p2.x, p3.x, weight),
      y: cubic(p0.y, p1.y, p2.y, p3.y, weight),
      z: cubic(p0.z, p1.z, p2.z, p3.z, weight),
    };
  }

  /** The curve's length up to each of ARC_LENGTH_DIVISIONS + 1 equal parameter steps, summed
   *  from the chords between them (Curve.getLengths). */
  getLengths(): number[] {
    if (this.lengths) return this.lengths;
    const cache = [0];
    let last = this.getPoint(0);
    let sum = 0;
    for (let p = 1; p <= ARC_LENGTH_DIVISIONS; p++) {
      const current = this.getPoint(p / ARC_LENGTH_DIVISIONS);
      sum += distance(current, last);
      cache.push(sum);
      last = current;
    }
    this.lengths = cache;
    return cache;
  }

  /** The curve parameter at arc-length fraction u in [0, 1], interpolated in getLengths' table
   *  (Curve.getUtoTmapping without a distance). */
  getUtoTmapping(u: number): number {
    const arcLengths = this.getLengths();
    const il = arcLengths.length;
    const targetArcLength = u * arcLengths[il - 1];

    // Binary search for the last entry not above the target.
    let i = 0;
    let low = 0;
    let high = il - 1;
    while (low <= high) {
      i = Math.floor(low + (high - low) / 2);
      const comparison = arcLengths[i] - targetArcLength;
      if (comparison < 0) {
        low = i + 1;
      } else if (comparison > 0) {
        high = i - 1;
      } else {
        high = i;
        break;
      }
    }
    i = high;

    if (arcLengths[i] === targetArcLength) return i / (il - 1);

    const lengthBefore = arcLengths[i];
    const lengthAfter = arcLengths[i + 1];
    const segmentLength = lengthAfter - lengthBefore;
    const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;
    return (i + segmentFraction) / (il - 1);
  }

  /** The point at arc-length fraction u (Curve.getPointAt). */
  getPointAt(u: number): Vec3 {
    return this.getPoint(this.getUtoTmapping(u));
  }

  /** The unit tangent at curve parameter t, from points TANGENT_DELTA either side, clamped to
   *  [0, 1] (Curve.getTangent). */
  getTangent(t: number): Vec3 {
    let t1 = t - TANGENT_DELTA;
    let t2 = t + TANGENT_DELTA;
    if (t1 < 0) t1 = 0;
    if (t2 > 1) t2 = 1;
    return normalize(sub(this.getPoint(t2), this.getPoint(t1)));
  }

  /** The unit tangent at arc-length fraction u (Curve.getTangentAt). */
  getTangentAt(u: number): Vec3 {
    return this.getTangent(this.getUtoTmapping(u));
  }
}
