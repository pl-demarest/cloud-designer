import { describe, expect, test } from 'vitest'
import { boxDistance } from '../../src/geometry/bounds'
import { baseSDF, buildBaseVolume } from '../../src/geometry/primitives/base'
import { buildSpiralVolume, sampleSpiral, spiralSDF, type SpiralVolume } from '../../src/geometry/primitives/spiral'
import { sampleTailSpine, tailSDF, tailSpineBounds } from '../../src/geometry/primitives/tail'
import type { BaseDef, SpiralDef } from '../../src/model/types'
import { THICK_SPIRAL, fixture } from '../fixtures/presets'

/**
 * The lower bounds the surface-mesh SDF uses to skip primitives (src/geometry/bounds.ts and the
 * `cap` arguments of spiralSDF and baseSDF). A skip must never change a minimum.
 */

/** A pseudo-random sequence, so the sample points are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

/** n points in the cube of half-size `half` about c. */
function points(n: number, c: [number, number, number], half: number, seed: number): Array<[number, number, number]> {
  const rnd = lcg(seed)
  return Array.from({ length: n }, () => [c[0] + (rnd() * 2 - 1) * half, c[1] + (rnd() * 2 - 1) * half, c[2] + (rnd() * 2 - 1) * half])
}

/** The same spiral with every segment's bound disabled, so spiralSDF evaluates every segment. */
function noSkip(v: SpiralVolume): SpiralVolume {
  return { ...v, reach: v.reach.map(() => Infinity), maxReach: Infinity }
}

const SPIRALS: Array<[string, SpiralDef]> = [
  ['thick golden', THICK_SPIRAL],
  ['archimedean', { ...THICK_SPIRAL, spiralType: 'archimedean' }],
  ['taperPower 0', { ...THICK_SPIRAL, taperPower: 0 }],
  ['sharp corners', { ...THICK_SPIRAL, cornerRadius: 0 }],
  ['wide, flat', { ...THICK_SPIRAL, thickness: 0.6, separation: 0.05, turns: 1 }],
]

describe('spiralSDF bounds', () => {
  for (const [name, def] of SPIRALS) {
    test(`${name}: skipping segments changes no value, and a cap changes nothing below it`, () => {
      const v = buildSpiralVolume(sampleSpiral(def, 64))
      const all = noSkip(v)
      const rnd = lcg(3)
      for (const [x, y, z] of points(3000, def.position, 2.5, 5)) {
        const exact = spiralSDF(x, y, z, all)
        expect(Object.is(spiralSDF(x, y, z, v), exact), `(${x}, ${y}, ${z})`).toBe(true)
        expect(exact).toBeGreaterThanOrEqual(boxDistance(v.box, x, y, z) - v.maxReach)
        const cap = rnd() * 2 - 0.5
        expect(Object.is(Math.min(cap, spiralSDF(x, y, z, v, cap)), Math.min(cap, exact))).toBe(true)
      }
    })
  }

  test('a segment whose rectangle is not a valid shape is never skipped', () => {
    const v = buildSpiralVolume(sampleSpiral({ ...THICK_SPIRAL, separation: -0.2 }, 64))
    expect(v.maxReach).toBe(Infinity)
  })
})

describe('baseSDF bounds', () => {
  const BASES: Array<[string, BaseDef]> = [
    ['default', fixture('default').base],
    ['rect', { ...fixture('default').base, crossSectionShape: 'rect' }],
    ['rectClosedBase', fixture('rectClosedBase').base],
  ]
  for (const [name, base] of BASES) {
    test(`${name}: a cap changes nothing below it`, () => {
      const v = buildBaseVolume(base)
      const rnd = lcg(9)
      for (const [x, y, z] of points(3000, [0, -0.9, 0], 3.5, 13)) {
        const cap = rnd() * 2 - 0.5
        expect(Object.is(Math.min(cap, baseSDF(x, y, z, v, cap)), Math.min(cap, baseSDF(x, y, z, v)))).toBe(true)
      }
    })
  }
})

describe('tail bounds', () => {
  for (const name of ['default', 'tailStart'] as const) {
    test(`${name}: tailSDF is at least the distance to the spine box minus the largest width`, () => {
      const samples = sampleTailSpine(fixture(name).tail)
      const { box, maxWidth } = tailSpineBounds(samples)
      for (const [x, y, z] of points(3000, [3.3, -0.3, 0.4], 3, 17)) {
        expect(tailSDF(x, y, z, samples)).toBeGreaterThanOrEqual(boxDistance(box, x, y, z) - maxWidth)
      }
    })
  }
})
