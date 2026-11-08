import { describe, expect, test } from 'vitest'
import { DEFAULT_PRESET, PRESET_VERSION, makeBase, makeFlowCloud, makeSpiral, makeTail } from '../../src/model/defaults'
import { MIN_DIMENSION, normalizePreset } from '../../src/model/normalize'
import { RANGES, RESOLUTIONS, type NumberRange } from '../../src/model/ranges'

/** Every object and array reachable from `v`. */
function containers(v: unknown, out = new Set<object>()): Set<object> {
  if (typeof v === 'object' && v !== null) {
    out.add(v)
    for (const child of Object.values(v)) containers(child, out)
  }
  return out
}

/**
 * The default preset as the first commit (ad14f08) exported it: spheres were `swirls`, the flow
 * cloud was `merge`, and neither spheres nor the flow cloud had rotation, half, tailStrength,
 * position or generateBands. githubLanding's CloudLayer.ts still reads this schema.
 */
const FIRST_COMMIT_PRESET = {
  name: 'Default Cloud',
  version: 1,
  swirls: [
    { id: 'swirl-0', position: [0, 0, 0], radius: 1.2, falloff: 2.0, shape: 'sphere', scale: [1, 1, 1] },
    { id: 'swirl-1', position: [1.6, 0.3, 0], radius: 1.0, falloff: 2.0, shape: 'sphere', scale: [1, 1, 1] },
  ],
  base: {
    controlPoints: [
      [-2.5, -0.8, 0],
      [2.5, -0.8, 0],
    ],
    crossSectionWidth: 1.2,
    crossSectionHeight: 0.4,
    crossSectionShape: 'oval',
    closed: false,
  },
  tail: {
    setpoints: [
      { id: 'tail-0', position: [2.5, -0.8, 0], width: 0.8 },
      { id: 'tail-1', position: [3.5, -0.4, 0.5], width: 0.4 },
    ],
    curlAmount: Math.PI * 0.5,
    attachToBase: 'end',
    attachOffset: 1.0,
  },
  merge: {
    resolution: 64,
    threshold: 1.0,
    smooth: true,
    wireframe: {
      mode: 'spiral',
      frontPoint: [0, 0, 2],
      backPoint: [0, 0, -2],
      numBands: 8,
      numFlowLines: 8,
      spiralTwist: Math.PI,
      showBands: true,
      showFlowLines: true,
    },
  },
}

describe('normalizePreset', () => {
  test('leaves DEFAULT_PRESET as it is, in a fresh object that shares nothing with it', () => {
    const out = normalizePreset(DEFAULT_PRESET)
    expect(out).toEqual(DEFAULT_PRESET)
    expect(JSON.stringify(out)).toBe(JSON.stringify(DEFAULT_PRESET)) // key order too
    const shared = [...containers(out)].filter((o) => containers(DEFAULT_PRESET).has(o))
    expect(shared).toEqual([])
  })

  test('is idempotent', () => {
    const once = normalizePreset(FIRST_COMMIT_PRESET)
    expect(normalizePreset(once)).toEqual(once)
  })

  test('writes the current version, 2', () => {
    expect(PRESET_VERSION).toBe(2)
    expect(normalizePreset({ ...DEFAULT_PRESET, version: 1 }).version).toBe(2)
    expect(normalizePreset({ ...DEFAULT_PRESET, version: undefined }).version).toBe(2)
  })

  test("keeps a version-1 'start' tail where it was attached: the offset flips, 'end' and version 2 stay", () => {
    const tail = (attachToBase: string, version?: number) =>
      normalizePreset({ ...DEFAULT_PRESET, version, tail: { ...DEFAULT_PRESET.tail, attachToBase, attachOffset: 0.25 } }).tail
    expect(tail('start', 1)).toMatchObject({ attachToBase: 'start', attachOffset: 0.75 })
    expect(tail('start', undefined)).toMatchObject({ attachToBase: 'start', attachOffset: 0.75 })
    expect(tail('end', 1)).toMatchObject({ attachToBase: 'end', attachOffset: 0.25 })
    expect(tail('start', 2)).toMatchObject({ attachToBase: 'start', attachOffset: 0.25 })
  })

  test("migrates the first commit's names: swirls become spheres, merge becomes flowCloud", () => {
    const out = normalizePreset(FIRST_COMMIT_PRESET)
    expect(out.spheres).toEqual([
      { id: 'swirl-0', position: [0, 0, 0], radius: 1.2, falloff: 2.0, shape: 'sphere', scale: [1, 1, 1], rotation: [0, 0, 0], half: false },
      { id: 'swirl-1', position: [1.6, 0.3, 0], radius: 1.0, falloff: 2.0, shape: 'sphere', scale: [1, 1, 1], rotation: [0, 0, 0], half: false },
    ])
    expect(out.flowCloud).toEqual({
      resolution: 64,
      threshold: 1.0,
      smooth: true,
      tailStrength: 0,
      position: [0, 0, 0],
      wireframe: { ...FIRST_COMMIT_PRESET.merge.wireframe, generateBands: false },
    })
    expect(out).not.toHaveProperty('swirls')
    expect(out).not.toHaveProperty('merge')
  })

  test('fills the fields version 1 made optional, and tailStrength, with their defaults', () => {
    const out = normalizePreset(FIRST_COMMIT_PRESET)
    expect(out.base.ringSegments).toBe(16)
    expect(out.base.lengthSegments).toBe(24)
    expect(out.tail.radialSegments).toBe(12)
    expect(out.tail.lengthSegments).toBe(32)
    expect(out.spirals).toEqual([])
    expect(out.surfaceMeshResolution).toBe(64)
    expect(out.flowCloud.tailStrength).toBe(DEFAULT_PRESET.flowCloud.tailStrength)
  })

  test('an empty object becomes the default base, tail and flow cloud with no spheres or spirals', () => {
    expect(normalizePreset({})).toEqual({
      name: 'Default Cloud',
      version: 2,
      spheres: [],
      base: makeBase(),
      tail: makeTail(),
      spirals: [],
      flowCloud: makeFlowCloud(),
      surfaceMeshResolution: 64,
    })
  })

  test('a spiral without thickness and cornerRadius is a flat ribbon, as version 1 read it', () => {
    const out = normalizePreset({ ...DEFAULT_PRESET, spirals: [{ id: 's', turns: 3 }] })
    expect(out.spirals[0]).toMatchObject({ id: 's', turns: 3, thickness: 0, cornerRadius: 0, spiralType: 'golden' })
  })

  test('invalid values fall back per field: null (exported NaN), wrong types, unknown options', () => {
    const d = structuredClone(DEFAULT_PRESET)
    const out = normalizePreset({
      ...d,
      spheres: [{ ...d.spheres[0], radius: null, position: [1, null, 'x'], shape: 'cube' }],
      base: { ...d.base, closed: 'yes' },
      tail: { ...d.tail, attachToBase: 'middle' },
      flowCloud: { ...d.flowCloud, wireframe: { ...d.flowCloud.wireframe, numBands: Infinity } },
      surfaceMeshResolution: '128',
    })
    expect(out.spheres[0].radius).toBe(1)
    expect(out.spheres[0].position).toEqual([1, 0, 0])
    expect(out.spheres[0].shape).toBe('sphere')
    expect(out.base.closed).toBe(false)
    expect(out.tail.attachToBase).toBe('end')
    expect(out.flowCloud.wireframe.numBands).toBe(8)
    expect(out.surfaceMeshResolution).toBe(64)
  })

  test('drops fields the model does not know', () => {
    const out = normalizePreset({ ...DEFAULT_PRESET, extra: 1, base: { ...DEFAULT_PRESET.base, extra: 2 } })
    expect(out).not.toHaveProperty('extra')
    expect(out.base).not.toHaveProperty('extra')
  })

  test('clamps degenerate dimensions to MIN_DIMENSION so no volume divides by zero', () => {
    const raw = structuredClone(DEFAULT_PRESET)
    raw.base.crossSectionWidth = -1
    raw.base.crossSectionHeight = 0
    raw.spheres[0] = { ...raw.spheres[0], shape: 'ellipsoid', scale: [1, 0, -2] }
    raw.tail.setpoints[2].width = 0
    const out = normalizePreset(raw)
    expect(MIN_DIMENSION).toBe(1e-3)
    expect(out.base.crossSectionWidth).toBe(1e-3)
    expect(out.base.crossSectionHeight).toBe(1e-3)
    expect(out.spheres[0].scale).toEqual([1, 1e-3, 1e-3])
    expect(out.tail.setpoints.map((s) => s.width)).toEqual([0.8, 0.4, 1e-3])
  })

  test("rounds the whole-number fields and clamps them to their sliders' ranges", () => {
    const raw = structuredClone(DEFAULT_PRESET)
    Object.assign(raw.base, { ringSegments: 7.6, lengthSegments: 0 })
    Object.assign(raw.tail, { radialSegments: 0.4, lengthSegments: 1e9 })
    raw.spirals = [makeSpiral('s', { rungDensity: -3 })]
    Object.assign(raw.flowCloud.wireframe, { numBands: 2.5, numFlowLines: 24.4 })
    const out = normalizePreset(raw)
    expect(out.base).toMatchObject({ ringSegments: 8, lengthSegments: 8 })
    expect(out.tail).toMatchObject({ radialSegments: 4, lengthSegments: 64 })
    expect(out.spirals[0].rungDensity).toBe(1)
    expect(out.flowCloud.wireframe).toMatchObject({ numBands: 4, numFlowLines: 24 })
  })

  test('takes each grid resolution to the nearest value the editor offers, the smaller of two equally near', () => {
    const resolutions = (flowCloud: number, surfaceMesh: number) => {
      const out = normalizePreset({
        ...DEFAULT_PRESET,
        flowCloud: { ...DEFAULT_PRESET.flowCloud, resolution: flowCloud },
        surfaceMeshResolution: surfaceMesh,
      })
      return [out.flowCloud.resolution, out.surfaceMeshResolution]
    }
    expect(resolutions(100, 100)).toEqual([128, 96])
    expect(resolutions(96, 160)).toEqual([64, 128])
    expect(resolutions(48, 48)).toEqual([32, 32])
    expect(resolutions(64.4, 191.5)).toEqual([64, 192])
    expect(resolutions(1e9, 1e9)).toEqual([128, 256])
    expect(resolutions(0, -5)).toEqual([32, 32])
  })

  test("keeps every value the editor's controls produce", () => {
    const raw = structuredClone(DEFAULT_PRESET)
    raw.spirals = [makeSpiral('s')]
    const fields: Array<[NumberRange, string]> = [
      [RANGES.base.ringSegments, 'base.ringSegments'],
      [RANGES.base.lengthSegments, 'base.lengthSegments'],
      [RANGES.tail.radialSegments, 'tail.radialSegments'],
      [RANGES.tail.lengthSegments, 'tail.lengthSegments'],
      [RANGES.spiral.rungDensity, 'spirals.0.rungDensity'],
      [RANGES.flowCloud.numBands, 'flowCloud.wireframe.numBands'],
      [RANGES.flowCloud.numFlowLines, 'flowCloud.wireframe.numFlowLines'],
    ]
    /** The object that holds the field at `path`, and the field's key. */
    const at = (preset: unknown, path: string): [Record<string, unknown>, string] => {
      const keys = path.split('.')
      const key = keys.pop()!
      return [keys.reduce((o, k) => (o as Record<string, unknown>)[k], preset) as Record<string, unknown>, key]
    }
    for (const [range, path] of fields) {
      for (let n = range.min; n <= range.max; n++) {
        const p = structuredClone(raw)
        const [owner, key] = at(p, path)
        owner[key] = n
        const [out, outKey] = at(normalizePreset(p), path)
        expect(out[outKey], `${path} = ${n}`).toBe(n)
      }
    }
    for (const resolution of RESOLUTIONS.flowCloud) {
      expect(normalizePreset({ ...raw, flowCloud: { ...raw.flowCloud, resolution } }).flowCloud.resolution).toBe(resolution)
    }
    for (const resolution of RESOLUTIONS.surfaceMesh) {
      expect(normalizePreset({ ...raw, surfaceMeshResolution: resolution }).surfaceMeshResolution).toBe(resolution)
    }
  })

  test('rejects a value that is not an object', () => {
    for (const raw of [null, 3, 'preset', [DEFAULT_PRESET]]) {
      expect(() => normalizePreset(raw), JSON.stringify(raw)).toThrow(TypeError)
    }
  })
})
