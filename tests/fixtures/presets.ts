import { DEFAULT_PRESET } from '../../src/model/defaults'
import { normalizePreset } from '../../src/model/normalize'
import type { CloudPreset, SpiralDef } from '../../src/model/types'

/**
 * Fixed preset set for the characterization goldens.
 *
 * Every fixture starts from structuredClone(DEFAULT_PRESET) and changes only what
 * its name says. Grids are kept small (32) except for the default preset (64, the
 * shipped value) so the whole unit suite stays well under a minute.
 */

const SMALL_RES = 32

function fromDefault(name: string, edit: (p: CloudPreset) => void): CloudPreset {
  const p = structuredClone(DEFAULT_PRESET)
  p.name = name
  p.flowCloud.resolution = SMALL_RES
  p.surfaceMeshResolution = SMALL_RES
  edit(p)
  return p
}

const NON_UNIFORM_TAIL = [
  { id: 'tail-0', position: [2.5, -0.8, 0] as [number, number, number], width: 0.9 },
  { id: 'tail-1', position: [2.9, -0.6, 0.2] as [number, number, number], width: 0.7 },
  { id: 'tail-2', position: [4.0, -0.1, 0.7] as [number, number, number], width: 0.25 },
  { id: 'tail-3', position: [4.3, 0.3, 0.9] as [number, number, number], width: 0.05 },
]

export const FLAT_SPIRAL: SpiralDef = {
  id: 'spiral-flat',
  position: [0, 2.5, 0],
  rotation: [0, 0, 0],
  startRadius: 0.1,
  endRadius: 1.2,
  turns: 2,
  separation: 0.3,
  taperPower: 1,
  rungDensity: 8,
  spiralType: 'archimedean',
  thickness: 0,
  cornerRadius: 0,
}

export const THICK_SPIRAL: SpiralDef = {
  id: 'spiral-thick',
  position: [0.5, 2.2, -0.3],
  rotation: [0.4, 0.2, 0.1],
  startRadius: 0.1,
  endRadius: 1.4,
  turns: 2.5,
  separation: 0.3,
  taperPower: 1,
  rungDensity: 8,
  spiralType: 'golden',
  thickness: 0.15,
  cornerRadius: 0.04,
}

export const FIXTURES = {
  /** (a) The shipped default, unchanged (grid 64). */
  default: structuredClone(DEFAULT_PRESET),

  /** (b) A rotated ellipsoid and a rotated half sphere. */
  rotated: fromDefault('rotated', (p) => {
    Object.assign(p.spheres[1], { shape: 'ellipsoid', scale: [1.4, 0.7, 1.0], rotation: [0.3, 0.5, 0.2] })
    Object.assign(p.spheres[2], { half: true, rotation: [0.6, 0, 0.4] })
  }),

  /** (c) Rect cross-section, closed base, non-uniform control-point spacing. */
  rectClosedBase: fromDefault('rectClosedBase', (p) => {
    p.base.crossSectionShape = 'rect'
    p.base.closed = true
    p.base.controlPoints = [
      [-2.6, -0.9, 0],
      [-2.2, -1.1, 0.4],
      [0.5, -1.0, -0.2],
      [2.4, -0.7, 0.1],
      [2.6, -0.85, -0.3],
    ]
  }),

  /** (d) Tail attached at 'start' (interior offset), non-uniform setpoints and widths. */
  tailStart: fromDefault('tailStart', (p) => {
    p.tail.setpoints = structuredClone(NON_UNIFORM_TAIL)
    p.tail.attachToBase = 'start'
    p.tail.attachOffset = 0.25
  }),

  /** (d) The same tail, unattached. */
  tailNone: fromDefault('tailNone', (p) => {
    p.tail.setpoints = structuredClone(NON_UNIFORM_TAIL)
    p.tail.attachToBase = 'none'
    p.tail.attachOffset = 0.25
  }),

  /** (e) One flat spiral (thickness 0). */
  flatSpiral: fromDefault('flatSpiral', (p) => {
    p.spirals = [structuredClone(FLAT_SPIRAL)]
  }),

  /** (f) One thick, rotated spiral with rounded corners. */
  thickSpiral: fromDefault('thickSpiral', (p) => {
    p.spirals = [structuredClone(THICK_SPIRAL)]
  }),

  /** (g) Flow cloud drawn as feature edges instead of the spiral wireframe. */
  edgesMode: fromDefault('edgesMode', (p) => {
    p.flowCloud.wireframe.mode = 'edges'
  }),

  /** (h) Band contours generated. */
  bands: fromDefault('bands', (p) => {
    p.flowCloud.wireframe.generateBands = true
    p.flowCloud.wireframe.numBands = 6
  }),

  /** (i) Tail contributes to the metaball field; flow cloud moved off the origin. */
  tailStrength: fromDefault('tailStrength', (p) => {
    p.flowCloud.tailStrength = 1
    p.flowCloud.position = [0.2, 0.1, -0.1]
  }),

  /** (j) Degenerate: zero base cross-section height (audit: nan-on-degenerate-dims). */
  degenerateBase: fromDefault('degenerateBase', (p) => {
    p.base.crossSectionHeight = 0
  }),

  /** (j) Degenerate: an ellipsoid with a zero scale component (audit: nan-on-degenerate-dims). */
  degenerateEllipsoid: fromDefault('degenerateEllipsoid', (p) => {
    Object.assign(p.spheres[0], { shape: 'ellipsoid', scale: [1, 0, 1] })
  }),
} satisfies Record<string, CloudPreset>

export type FixtureName = keyof typeof FIXTURES

export const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[]

/** A fresh copy, so no test can mutate the shared fixture. */
export function fixture(name: FixtureName): CloudPreset {
  return structuredClone(FIXTURES[name])
}

// ── Worker payloads, exactly as the app builds them ──────────────────────────
//
// The app posts parts of the store's preset, which loadPreset has passed through
// normalizePreset, so each builder normalizes its preset first. A fixture can stay
// raw (the degenerate ones keep their zero dimensions) and still reach the worker
// the way the app would send it.

/** FlowCloud.dispatch (src/engine/views/FlowCloud.ts). */
export function marchingCubesMessage(raw: CloudPreset) {
  const p = normalizePreset(raw)
  return { spheres: p.spheres, base: p.base, tail: p.tail, flowCloud: p.flowCloud }
}

/** EditorEngine.cutAndGlue, surface-mesh half (src/engine/EditorEngine.ts). */
export function surfaceMeshMessage(raw: CloudPreset) {
  const p = normalizePreset(raw)
  return {
    spheres: p.spheres,
    base: p.base,
    tail: p.tail,
    flowCloud: p.flowCloud,
    spirals: p.spirals,
    resolution: p.surfaceMeshResolution,
  }
}

export interface PrimitiveEdges {
  sphereEdgeGroups: Array<{ sphereId: string; edges: Float32Array }>
  baseEdges: Float32Array
  tailEdges: Float32Array
  spiralEdges: Float32Array
  flowCloudEdges: Float32Array
}

/** EditorEngine.cutAndGlue, cut-and-glue half (src/engine/EditorEngine.ts). */
export function cutAndGlueMessage(raw: CloudPreset, edges: PrimitiveEdges) {
  const p = normalizePreset(raw)
  return { spheres: p.spheres, base: p.base, tail: p.tail, ...edges }
}
