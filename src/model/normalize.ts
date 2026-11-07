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

type Vec3 = [number, number, number];

/**
 * The smallest base cross-section width or height, ellipsoid scale component and tail width.
 * A zero there divides by zero in the volumes and puts NaN vertices into the surface mesh.
 */
export const MIN_DIMENSION = 1e-3;

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

function dimension(v: unknown, fallback: number): number {
  return Math.max(num(v, fallback), MIN_DIMENSION);
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

/** Three numbers, each component falling back separately. */
function vec3(v: unknown, fallback: Vec3): Vec3 {
  const a = list(v);
  return [num(a[0], fallback[0]), num(a[1], fallback[1]), num(a[2], fallback[2])];
}

function normalizeSphere(raw: unknown, index: number): SphereDef {
  const r = fields(raw);
  const d = makeSphere(`sphere-${index}`);
  const scale = vec3(r.scale, d.scale);
  return {
    id: str(r.id, d.id),
    position: vec3(r.position, d.position),
    radius: num(r.radius, d.radius),
    falloff: num(r.falloff, d.falloff),
    shape: oneOf(r.shape, ['sphere', 'ellipsoid'], d.shape),
    // Clamped for every shape: the scale takes effect as soon as the panel switches to ellipsoid.
    scale: [Math.max(scale[0], MIN_DIMENSION), Math.max(scale[1], MIN_DIMENSION), Math.max(scale[2], MIN_DIMENSION)],
    rotation: vec3(r.rotation, d.rotation),
    half: bool(r.half, d.half),
  };
}

function normalizeBase(raw: unknown): BaseDef {
  const r = fields(raw);
  const d = makeBase();
  return {
    controlPoints: Array.isArray(r.controlPoints)
      ? r.controlPoints.map((p) => vec3(p, [0, 0, 0]))
      : d.controlPoints,
    crossSectionWidth: dimension(r.crossSectionWidth, d.crossSectionWidth),
    crossSectionHeight: dimension(r.crossSectionHeight, d.crossSectionHeight),
    crossSectionShape: oneOf(r.crossSectionShape, ['oval', 'rect'], d.crossSectionShape),
    closed: bool(r.closed, d.closed),
    ringSegments: num(r.ringSegments, d.ringSegments),
    lengthSegments: num(r.lengthSegments, d.lengthSegments),
  };
}

function normalizeTailSetpoint(raw: unknown, index: number): TailSetpoint {
  const r = fields(raw);
  const d = makeTailSetpoint(`tail-${index}`);
  return {
    id: str(r.id, d.id),
    position: vec3(r.position, d.position),
    width: dimension(r.width, d.width),
  };
}

function normalizeTail(raw: unknown): TailDef {
  const r = fields(raw);
  const d = makeTail();
  return {
    setpoints: Array.isArray(r.setpoints) ? r.setpoints.map(normalizeTailSetpoint) : d.setpoints,
    curlAmount: num(r.curlAmount, d.curlAmount),
    attachToBase: oneOf(r.attachToBase, ['start', 'end', 'none'], d.attachToBase),
    attachOffset: num(r.attachOffset, d.attachOffset),
    radialSegments: num(r.radialSegments, d.radialSegments),
    lengthSegments: num(r.lengthSegments, d.lengthSegments),
  };
}

function normalizeSpiral(raw: unknown, index: number): SpiralDef {
  const r = fields(raw);
  const d = makeSpiral(`spiral-${index}`);
  return {
    id: str(r.id, d.id),
    position: vec3(r.position, d.position),
    rotation: vec3(r.rotation, d.rotation),
    startRadius: num(r.startRadius, d.startRadius),
    endRadius: num(r.endRadius, d.endRadius),
    turns: num(r.turns, d.turns),
    separation: num(r.separation, d.separation),
    taperPower: num(r.taperPower, d.taperPower),
    rungDensity: num(r.rungDensity, d.rungDensity),
    spiralType: oneOf(r.spiralType, ['archimedean', 'golden'], d.spiralType),
    thickness: num(r.thickness, d.thickness),
    cornerRadius: num(r.cornerRadius, d.cornerRadius),
  };
}

function normalizeWireframe(raw: unknown, d: WireframeStyle): WireframeStyle {
  const r = fields(raw);
  return {
    mode: oneOf(r.mode, ['edges', 'spiral'], d.mode),
    frontPoint: vec3(r.frontPoint, d.frontPoint),
    backPoint: vec3(r.backPoint, d.backPoint),
    numBands: num(r.numBands, d.numBands),
    numFlowLines: num(r.numFlowLines, d.numFlowLines),
    spiralTwist: num(r.spiralTwist, d.spiralTwist),
    generateBands: bool(r.generateBands, d.generateBands),
    showBands: bool(r.showBands, d.showBands),
    showFlowLines: bool(r.showFlowLines, d.showFlowLines),
  };
}

function normalizeFlowCloud(raw: unknown): FlowCloudSettings {
  const r = fields(raw);
  const d = makeFlowCloud();
  return {
    resolution: num(r.resolution, d.resolution),
    threshold: num(r.threshold, d.threshold),
    smooth: bool(r.smooth, d.smooth),
    tailStrength: num(r.tailStrength, d.tailStrength),
    position: vec3(r.position, d.position),
    wireframe: normalizeWireframe(r.wireframe, d.wireframe),
  };
}

/**
 * A complete preset of version PRESET_VERSION built from `raw`, sharing no object with it.
 *
 * - Version 1, including the first commit's names (`swirls` for spheres, `merge` for the flow
 *   cloud), migrates; any version is read as far as its fields match, and version 2 is written.
 * - A missing or invalid field (wrong type, NaN, an unknown option) gets its default from the
 *   factories in ./defaults.ts: a missing base, tail or flow cloud is the default one, missing
 *   sphere and spiral lists are empty. Unknown fields are dropped.
 * - Base cross-section width and height, sphere scale components and tail widths are at least
 *   MIN_DIMENSION.
 *
 * Throws a TypeError when `raw` is not an object.
 */
export function normalizePreset(raw: unknown): CloudPreset {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('normalizePreset: a preset must be an object');
  }
  const r = raw as Fields;
  return {
    name: str(r.name, DEFAULT_PRESET.name),
    version: PRESET_VERSION,
    spheres: list(r.spheres ?? r.swirls).map(normalizeSphere),
    base: normalizeBase(r.base),
    tail: normalizeTail(r.tail),
    spirals: list(r.spirals).map(normalizeSpiral),
    flowCloud: normalizeFlowCloud(r.flowCloud ?? r.merge),
    surfaceMeshResolution: num(r.surfaceMeshResolution, DEFAULT_PRESET.surfaceMeshResolution),
  };
}
