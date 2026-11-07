/**
 * The tail primitive: its spine, sampled as a Catmull-Rom spline through the setpoints, and the
 * volume around it, a chain of capsules whose radius follows the setpoint widths.
 */

import type { TailDef } from '../../model/types';

// Sampled tail spine point: position + interpolated width (radius)
export interface TailSample {
  px: number; py: number; pz: number;
  width: number;
}

// Sample the tail setpoints as a Catmull-Rom spline
export function sampleTailSpline(tail: TailDef, nSamples: number): TailSample[] {
  const pts = tail.setpoints;
  if (pts.length < 2) return [];
  const samples: TailSample[] = [];
  const segs = pts.length - 1;

  for (let i = 0; i < nSamples; i++) {
    const g = i / (nSamples - 1);
    const seg = Math.min(Math.floor(g * segs), segs - 1);
    const t = g * segs - seg;
    const t2 = t * t;
    const t3 = t2 * t;

    const p0 = pts[Math.max(0, seg - 1)];
    const p1 = pts[seg];
    const p2 = pts[Math.min(pts.length - 1, seg + 1)];
    const p3 = pts[Math.min(pts.length - 1, seg + 2)];

    const px = 0.5 * (2*p1.position[0] + (-p0.position[0]+p2.position[0])*t + (2*p0.position[0]-5*p1.position[0]+4*p2.position[0]-p3.position[0])*t2 + (-p0.position[0]+3*p1.position[0]-3*p2.position[0]+p3.position[0])*t3);
    const py = 0.5 * (2*p1.position[1] + (-p0.position[1]+p2.position[1])*t + (2*p0.position[1]-5*p1.position[1]+4*p2.position[1]-p3.position[1])*t2 + (-p0.position[1]+3*p1.position[1]-3*p2.position[1]+p3.position[1])*t3);
    const pz = 0.5 * (2*p1.position[2] + (-p0.position[2]+p2.position[2])*t + (2*p0.position[2]-5*p1.position[2]+4*p2.position[2]-p3.position[2])*t2 + (-p0.position[2]+3*p1.position[2]-3*p2.position[2]+p3.position[2])*t3);

    const width = p1.width + t * (p2.width - p1.width);
    samples.push({ px, py, pz, width });
  }
  return samples;
}

/** Signed distance to the tail capsule chain. */
export function tailSDF(x: number, y: number, z: number, tailSamples: TailSample[]): number {
  let minD = Infinity;
  for (let i = 0; i < tailSamples.length - 1; i++) {
    const a = tailSamples[i];
    const b = tailSamples[i + 1];
    const abx = b.px - a.px;
    const aby = b.py - a.py;
    const abz = b.pz - a.pz;
    const ab2 = abx * abx + aby * aby + abz * abz;
    let param = 0;
    if (ab2 > 0.0001) {
      param = ((x - a.px) * abx + (y - a.py) * aby + (z - a.pz) * abz) / ab2;
      param = Math.max(0, Math.min(1, param));
    }
    const cx = a.px + param * abx;
    const cy = a.py + param * aby;
    const cz = a.pz + param * abz;
    const r = a.width + (b.width - a.width) * param;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    minD = Math.min(minD, dist - r);
  }
  return minD;
}

export function insideTailCapsule(x: number, y: number, z: number, tailSamples: TailSample[], inset: number): boolean {
  for (let i = 0; i < tailSamples.length - 1; i++) {
    const a = tailSamples[i];
    const b = tailSamples[i + 1];
    const abx = b.px - a.px;
    const aby = b.py - a.py;
    const abz = b.pz - a.pz;
    const ab2 = abx*abx + aby*aby + abz*abz;
    let param = 0;
    if (ab2 > 0.0001) {
      param = ((x - a.px)*abx + (y - a.py)*aby + (z - a.pz)*abz) / ab2;
      param = Math.max(0, Math.min(1, param));
    }
    const cx = a.px + param * abx;
    const cy = a.py + param * aby;
    const cz = a.pz + param * abz;
    const r = (a.width + (b.width - a.width) * param) * inset;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    if (dx*dx + dy*dy + dz*dz < r*r) return true;
  }
  return false;
}
