/**
 * Default values of the preset model: one factory per primitive, each returning a fresh object
 * with every field set, and DEFAULT_PRESET, the cloud the editor opens with, built from them.
 */

import type { BaseDef, CloudPreset, FlowCloudSettings, SphereDef, SpiralDef, TailDef, TailSetpoint } from './types';

/** The format version this code writes. normalizePreset migrates older ones. */
export const PRESET_VERSION = 2;

/** A unit sphere at the origin: full, unrotated, unscaled, falloff 0.5. */
export function makeSphere(id: string, fields: Partial<Omit<SphereDef, 'id'>> = {}): SphereDef {
  return {
    id,
    position: [0, 0, 0],
    radius: 1.0,
    falloff: 0.5,
    shape: 'sphere',
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    half: false,
    ...fields,
  };
}

/** The default base: an open oval extrusion along four control points under the spheres. */
export function makeBase(): BaseDef {
  return {
    controlPoints: [
      [-2.5, -0.8, 0],
      [-1.0, -1.0, 0.3],
      [1.0, -1.0, -0.3],
      [2.5, -0.8, 0],
    ],
    crossSectionWidth: 1.2,
    crossSectionHeight: 0.4,
    crossSectionShape: 'oval',
    closed: false,
    ringSegments: 16,
    lengthSegments: 24,
  };
}

/** A tail setpoint at the origin, 0.5 wide. */
export function makeTailSetpoint(id: string, fields: Partial<Omit<TailSetpoint, 'id'>> = {}): TailSetpoint {
  return { id, position: [0, 0, 0], width: 0.5, ...fields };
}

/** The default tail: three setpoints from the base's end, narrowing from 0.8 to 0.1. */
export function makeTail(): TailDef {
  return {
    setpoints: [
      makeTailSetpoint('tail-0', { position: [2.5, -0.8, 0], width: 0.8 }),
      makeTailSetpoint('tail-1', { position: [3.5, -0.4, 0.5], width: 0.4 }),
      makeTailSetpoint('tail-2', { position: [4.2, 0.2, 0.8], width: 0.1 }),
    ],
    curlAmount: Math.PI * 0.5,
    attachToBase: 'end',
    attachOffset: 1.0,
    radialSegments: 12,
    lengthSegments: 32,
  };
}

/**
 * A flat golden spiral ribbon (thickness 0) of two turns at the origin. Thickness and corner
 * radius default to 0 because that is how version 1 read a spiral saved without them; the
 * editor's "+ Add" sets its own thicker values.
 */
export function makeSpiral(id: string, fields: Partial<Omit<SpiralDef, 'id'>> = {}): SpiralDef {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    startRadius: 0.1,
    endRadius: 1.5,
    turns: 2,
    separation: 0.3,
    taperPower: 1,
    rungDensity: 8,
    spiralType: 'golden',
    thickness: 0,
    cornerRadius: 0,
    ...fields,
  };
}

/** The default flow cloud: spiral wireframe, no tail in the field, not offset. */
export function makeFlowCloud(): FlowCloudSettings {
  return {
    resolution: 64,
    threshold: 1.0,
    smooth: true,
    tailStrength: 0,
    position: [0, 0, 0],
    wireframe: {
      mode: 'spiral',
      frontPoint: [-2, 0, 0],
      backPoint: [2.5, 0, 0],
      numBands: 8,
      numFlowLines: 16,
      spiralTwist: Math.PI,
      generateBands: false,
      showBands: true,
      showFlowLines: true,
    },
  };
}

export const DEFAULT_PRESET: CloudPreset = {
  name: 'Default Cloud',
  version: PRESET_VERSION,
  spheres: [
    makeSphere('sphere-0', { radius: 1.2 }),
    makeSphere('sphere-1', { position: [1.6, 0.3, 0] }),
    makeSphere('sphere-2', { position: [-1.6, 0.2, 0], radius: 0.9 }),
  ],
  base: makeBase(),
  tail: makeTail(),
  spirals: [],
  flowCloud: makeFlowCloud(),
  surfaceMeshResolution: 64,
};
