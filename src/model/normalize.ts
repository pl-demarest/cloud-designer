/**
 * normalizePreset turns anything that claims to be a preset (an imported file, an undo
 * snapshot, a preset of an older version) into a CloudPreset of the current version with every
 * field set. It is the one place where defaults are filled in, so code past the store and the
 * workers can read every field without a fallback.
 */

import {
  DEFAULT_PRESET,
  PRESET_VERSION,
  makeBase,
  makeFlowCloud,
  makeSphere,
  makeSpiral,
  makeTail,
  makeTailSetpoint,
} from './defaults';
import type {
  BaseDef,
  CloudPreset,
  FlowCloudSettings,
  SphereDef,
  SpiralDef,
  TailDef,
  TailSetpoint,
  WireframeStyle,
} from './types';
import { RANGES, RESOLUTIONS, type NumberRange } from './ranges';

type Vec3 = [number, number, number];

/** What normalizePreset changed to fit the editor's ranges, for the person importing. */
export interface NormalizeReport {
  /** Finite numbers outside their range (src/model/ranges.ts), clamped or wrapped into it. */
  clamped: number;
}

type Fields = Record<string, unknown>;

function fields(v: unknown): Fields {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Fields) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A finite number, else the fallback (JSON writes NaN and Infinity as null). */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** A full turn of an angle's range. */
const TURN = Math.PI * 2;

/**
 * Normalizes the numbers of one preset into their ranges, counting the finite ones it had to
 * move. Every geometry kernel input stays finite and sized as the editor's controls make it: a
 * finite but huge value (1e308) broke the curve code and left the editor blank, a zero size
 * divided by zero in the volumes, a segment count of 0 or below made the surface-mesh core throw.
 */
class Ranger {
  clamped = 0;

  /** A number in `range`: a whole-number field rounded, then clamped; an angle wrapped by whole
   *  turns; any other clamped. A value that is not a finite number gets `fallback`, and -0 is 0
   *  (adding 0 changes nothing else), which is what Export JSON writes for it. */
  in(v: unknown, fallback: number, range: NumberRange): number {
    const x = (range.integer ? Math.round(num(v, fallback)) : num(v, fallback)) + 0;
    if (x >= range.min && x <= range.max) return x;
    this.clamped++;
    if (range.angle) {
      // The remainder is exact; at most one more turn brings it into [min, max].
      let a = x % TURN;
      if (a > range.max) a -= TURN;
      if (a < range.min) a += TURN;
      return Math.min(Math.max(a, range.min), range.max);
    }
    return x < range.min ? range.min : range.max;
  }

  /** Three numbers, each in its range (one for all three, or one per axis), each falling back
   *  separately. */
  vec3(v: unknown, fallback: Vec3, range: NumberRange | readonly NumberRange[]): Vec3 {
    const a = list(v);
    const r = (i: number) => ('min' in range ? range : range[i]);
    return [this.in(a[0], fallback[0], r(0)), this.in(a[1], fallback[1], r(1)), this.in(a[2], fallback[2], r(2))];
  }

  /** The value in `values` (ascending) nearest to v, the smaller of two equally near; a value
   *  beyond either end counts as clamped. A fractional resolution made the cores throw allocating
   *  the grid. */
  nearest(v: unknown, values: readonly number[], fallback: number): number {
    const x = num(v, fallback);
    if (x < values[0] || x > values[values.length - 1]) this.clamped++;
    let best = values[0];
    for (const value of values) if (Math.abs(value - x) < Math.abs(best - x)) best = value;
    return best;
  }
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.find((o) => o === v) ?? fallback;
}

/**
 * The ids of a list's entries, unique within the list: an entry's string id at its first
 * occurrence; a repeated id, or an entry without a string id, gets that id or `<kind>-<index>`,
 * or else the first of `<id>-2`, `<id>-3`, ... that no entry of the list takes. The editor keys
 * its views, edits and removals by id, so two entries with one id were drawn once and edited and
 * removed together.
 */
function uniqueIds(raws: readonly unknown[], kind: string): string[] {
  const given = raws.map((raw) => {
    const id = fields(raw).id;
    return typeof id === 'string' ? id : null;
  });
  const taken = new Set<string>();
  const kept = given.map((id) => {
    if (id === null || taken.has(id)) return false;
    taken.add(id);
    return true;
  });
  return given.map((id, i) => {
    if (kept[i]) return id!;
    const base = id ?? `${kind}-${i}`;
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
    taken.add(candidate);
    return candidate;
  });
}

function normalizeSphere(raw: unknown, id: string, n: Ranger): SphereDef {
  const r = fields(raw);
  const d = makeSphere(id);
  const R = RANGES.sphere;
  return {
    id,
    position: n.vec3(r.position, d.position, R.position),
    radius: n.in(r.radius, d.radius, R.radius),
    falloff: n.in(r.falloff, d.falloff, R.falloff),
    shape: oneOf(r.shape, ['sphere', 'ellipsoid'], d.shape),
    // In range for every shape: the scale takes effect as soon as the panel switches to ellipsoid.
    scale: n.vec3(r.scale, d.scale, R.scale),
    rotation: n.vec3(r.rotation, d.rotation, R.rotation),
    half: bool(r.half, d.half),
  };
}

/** Each entry of a keyed list normalized with its unique id (uniqueIds). */
function normalizeList<T>(raws: readonly unknown[], kind: string, normalize: (raw: unknown, id: string, n: Ranger) => T, n: Ranger): T[] {
  const ids = uniqueIds(raws, kind);
  return raws.map((raw, i) => normalize(raw, ids[i], n));
}

function normalizeBase(raw: unknown, n: Ranger): BaseDef {
  const r = fields(raw);
  const d = makeBase();
  const R = RANGES.base;
  return {
    controlPoints: Array.isArray(r.controlPoints)
      ? r.controlPoints.map((p) => n.vec3(p, [0, 0, 0], R.controlPoint))
      : d.controlPoints,
    crossSectionWidth: n.in(r.crossSectionWidth, d.crossSectionWidth, R.crossSectionWidth),
    crossSectionHeight: n.in(r.crossSectionHeight, d.crossSectionHeight, R.crossSectionHeight),
    crossSectionShape: oneOf(r.crossSectionShape, ['oval', 'rect'], d.crossSectionShape),
    closed: bool(r.closed, d.closed),
    ringSegments: n.in(r.ringSegments, d.ringSegments, R.ringSegments),
    lengthSegments: n.in(r.lengthSegments, d.lengthSegments, R.lengthSegments),
  };
}

function normalizeTailSetpoint(raw: unknown, id: string, n: Ranger): TailSetpoint {
  const r = fields(raw);
  const d = makeTailSetpoint(id);
  return {
    id,
    position: n.vec3(r.position, d.position, RANGES.tail.setpointPosition),
    width: n.in(r.width, d.width, RANGES.tail.width),
  };
}

function normalizeTail(raw: unknown, fromVersion1: boolean, n: Ranger): TailDef {
  const r = fields(raw);
  const d = makeTail();
  const R = RANGES.tail;
  const attachToBase = oneOf(r.attachToBase, ['start', 'end', 'none'], d.attachToBase);
  const attachOffset = n.in(r.attachOffset, d.attachOffset, R.attachOffset);
  return {
    setpoints: Array.isArray(r.setpoints) ? normalizeList(r.setpoints, 'tail', normalizeTailSetpoint, n) : d.setpoints,
    curlAmount: n.in(r.curlAmount, d.curlAmount, R.curlAmount),
    attachToBase,
    // Version 1 attached 'start' like 'end', at attachOffset from the base's start. Version 2
    // measures 'start' from the other end, so the offset flips to keep the tail where it was.
    attachOffset: fromVersion1 && attachToBase === 'start' ? 1 - attachOffset : attachOffset,
    radialSegments: n.in(r.radialSegments, d.radialSegments, R.radialSegments),
    lengthSegments: n.in(r.lengthSegments, d.lengthSegments, R.lengthSegments),
  };
}

function normalizeSpiral(raw: unknown, id: string, n: Ranger): SpiralDef {
  const r = fields(raw);
  const d = makeSpiral(id);
  const R = RANGES.spiral;
  return {
    id,
    position: n.vec3(r.position, d.position, R.position),
    rotation: n.vec3(r.rotation, d.rotation, R.rotation),
    startRadius: n.in(r.startRadius, d.startRadius, R.startRadius),
    endRadius: n.in(r.endRadius, d.endRadius, R.endRadius),
    turns: n.in(r.turns, d.turns, R.turns),
    separation: n.in(r.separation, d.separation, R.separation),
    taperPower: n.in(r.taperPower, d.taperPower, R.taperPower),
    rungDensity: n.in(r.rungDensity, d.rungDensity, R.rungDensity),
    spiralType: oneOf(r.spiralType, ['archimedean', 'golden'], d.spiralType),
    thickness: n.in(r.thickness, d.thickness, R.thickness),
    cornerRadius: n.in(r.cornerRadius, d.cornerRadius, R.cornerRadius),
  };
}

function normalizeWireframe(raw: unknown, d: WireframeStyle, n: Ranger): WireframeStyle {
  const r = fields(raw);
  const R = RANGES.flowCloud;
  return {
    mode: oneOf(r.mode, ['edges', 'spiral'], d.mode),
    frontPoint: n.vec3(r.frontPoint, d.frontPoint, R.anchor),
    backPoint: n.vec3(r.backPoint, d.backPoint, R.anchor),
    numBands: n.in(r.numBands, d.numBands, R.numBands),
    numFlowLines: n.in(r.numFlowLines, d.numFlowLines, R.numFlowLines),
    spiralTwist: n.in(r.spiralTwist, d.spiralTwist, R.spiralTwist),
    generateBands: bool(r.generateBands, d.generateBands),
    showBands: bool(r.showBands, d.showBands),
    showFlowLines: bool(r.showFlowLines, d.showFlowLines),
  };
}

function normalizeFlowCloud(raw: unknown, n: Ranger): FlowCloudSettings {
  const r = fields(raw);
  const d = makeFlowCloud();
  const R = RANGES.flowCloud;
  return {
    resolution: n.nearest(r.resolution, RESOLUTIONS.flowCloud, d.resolution),
    threshold: n.in(r.threshold, d.threshold, R.threshold),
    smooth: bool(r.smooth, d.smooth),
    tailStrength: n.in(r.tailStrength, d.tailStrength, R.tailStrength),
    position: n.vec3(r.position, d.position, R.position),
    wireframe: normalizeWireframe(r.wireframe, d.wireframe, n),
  };
}

/**
 * A complete preset of version PRESET_VERSION built from `raw`, sharing no object with it.
 *
 * - Version 1 (also assumed without a version), including the first commit's names (`swirls`
 *   for spheres, `merge` for the flow cloud), migrates: a tail attached at 'start' keeps its
 *   attachment point. Any version is read as far as its fields match; version 2 is written.
 * - A missing or invalid field (wrong type, NaN, an unknown option) gets its default from the
 *   factories in ./defaults.ts: a missing base, tail or flow cloud is the default one, missing
 *   sphere and spiral lists are empty. Unknown fields are dropped.
 * - The ids of the spheres, the tail setpoints and the spirals are unique within each list
 *   (uniqueIds).
 * - Every number is brought into its range in the range table (./ranges.ts): whole-number fields
 *   rounded, then clamped; Euler angles wrapped by whole turns into -pi to pi; every other number
 *   clamped; the two grid resolutions taken to the nearest value the editor offers
 *   (RESOLUTIONS). Every value the editor's controls produce is kept as it is, and `report`, when
 *   given, counts the finite numbers that were outside their range.
 *
 * Throws a TypeError when `raw` is not an object.
 */
export function normalizePreset(raw: unknown, report?: NormalizeReport): CloudPreset {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('normalizePreset: a preset must be an object');
  }
  const r = raw as Fields;
  const n = new Ranger();
  const preset: CloudPreset = {
    name: str(r.name, DEFAULT_PRESET.name),
    version: PRESET_VERSION,
    spheres: normalizeList(list(r.spheres ?? r.swirls), 'sphere', normalizeSphere, n),
    base: normalizeBase(r.base, n),
    tail: normalizeTail(r.tail, num(r.version, 1) < 2, n),
    spirals: normalizeList(list(r.spirals), 'spiral', normalizeSpiral, n),
    flowCloud: normalizeFlowCloud(r.flowCloud ?? r.merge, n),
    surfaceMeshResolution: n.nearest(r.surfaceMeshResolution, RESOLUTIONS.surfaceMesh, DEFAULT_PRESET.surfaceMeshResolution),
  };
  if (report) report.clamped += n.clamped;
  return preset;
}
