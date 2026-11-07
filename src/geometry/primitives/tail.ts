/**
 * The tail primitive: where it attaches (resolveTailSetpoints), its spine and width profile as
 * TailMesh draws them (tailCurve, sampleTailPath), and the workers' volume, a chain of capsules
 * through the same samples (sampleTailSpine, tailSDF, insideTailCapsule).
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import type { BaseDef, TailDef, TailSetpoint } from '../../model/types';
import { samplePath, type PathSamples } from '../path';
import { basePointAt } from './base';

/**
 * The setpoints the tail is drawn and modelled through. An attached tail starts on the base:
 * attachToBase 'end' puts its first setpoint attachOffset of the way along the base (1 is the
 * base's end), 'start' measures the same distance from the other end (1 is the base's start).
 * The stored first position is then unused. A new array; the input is not changed.
 */
export function resolveTailSetpoints(tail: TailDef, base: BaseDef): TailSetpoint[] {
  const pts = [...tail.setpoints];
  if (tail.attachToBase !== 'none' && pts.length > 0) {
    const t = tail.attachToBase === 'end' ? tail.attachOffset : 1 - tail.attachOffset;
    pts[0] = { ...pts[0], position: basePointAt(base, t) };
  }
  return pts;
}

/** `tail` with its setpoints resolved against `base` (resolveTailSetpoints). */
export function attachedTail(tail: TailDef, base: BaseDef): TailDef {
  return { ...tail, setpoints: resolveTailSetpoints(tail, base) };
}

/** The tail's spine: open uniform Catmull-Rom (tension 0.5) through the setpoint positions. */
export function tailCurve(setpoints: TailSetpoint[]): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    setpoints.map((sp) => new Vector3(...sp.position)),
    false,
    'catmullrom',
    0.5
  );
}

/**
 * The tail's width at curve parameter t: linear between setpoint k, at t = k / (n - 1) where the
 * curve passes through it, and setpoint k + 1, so each setpoint's own width is met exactly.
 */
export function tailWidthAt(setpoints: TailSetpoint[], t: number): number {
  if (setpoints.length === 0) return 0.5;
  if (setpoints.length === 1) return setpoints[0].width;
  const s = t * (setpoints.length - 1);
  const k = Math.min(Math.floor(s), setpoints.length - 2);
  const f = s - k;
  // (1 - f) a + f b is exactly a at f = 0 and exactly b at f = 1.
  return (1 - f) * setpoints[k].width + f * setpoints[k + 1].width;
}

export interface TailPathSamples extends PathSamples {
  /** The width at each sample (tailWidthAt). */
  widths: number[];
}

/**
 * The spine at `segments` equal arc-length steps, where TailMesh puts its rings: point, Frenet
 * frame and width all at the same curve parameter. Needs at least two setpoints.
 */
export function sampleTailPath(setpoints: TailSetpoint[], segments: number): TailPathSamples {
  const curve = tailCurve(setpoints);
  const path = samplePath(curve, segments, false);
  const widths: number[] = [];
  // getPointAt(u) is getPoint(getUtoTmapping(u)); three reads the 0 distance as none.
  for (let i = 0; i <= segments; i++) widths.push(tailWidthAt(setpoints, curve.getUtoTmapping(i / segments, 0)));
  return { ...path, widths };
}

/** A sample of the tail's spine: position and width (the radius of its capsules). */
export interface TailSample {
  px: number; py: number; pz: number;
  width: number;
}

/** The spine as the workers model it: TailMesh's ring centres and widths (sampleTailPath with
 *  the tail's lengthSegments). Empty for fewer than two setpoints. */
export function sampleTailSpine(tail: TailDef): TailSample[] {
  if (tail.setpoints.length < 2) return [];
  const { points, widths } = sampleTailPath(tail.setpoints, tail.lengthSegments);
  return points.map((p, i) => ({ px: p.x, py: p.y, pz: p.z, width: widths[i] }));
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
