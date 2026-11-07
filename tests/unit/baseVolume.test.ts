import { describe, expect, test } from 'vitest'
import { baseSDF, buildBaseVolume, insideBase, sampleBasePath } from '../../src/geometry/primitives/base'
import { fixture } from '../fixtures/presets'
import type { BaseDef } from '../../src/model/types'

/** The base solid's distance field (src/geometry/primitives/base.ts), on its own. */

const BASES: Array<[string, BaseDef]> = [
  ['default', fixture('default').base],
  ['rect', { ...fixture('default').base, crossSectionShape: 'rect' }],
  ['rectClosedBase', fixture('rectClosedBase').base],
]

/** A pseudo-random sequence, so the sample points are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

describe('baseSDF', () => {
  for (const [name, base] of BASES) {
    test(`${name}: finite everywhere, near and far, and 1-Lipschitz along short steps`, () => {
      const v = buildBaseVolume(base)
      const rnd = lcg(7)
      for (let n = 0; n < 2000; n++) {
        const far = n % 4 === 0 ? 20 : 4
        const x = (rnd() * 2 - 1) * far, y = (rnd() * 2 - 1) * far, z = (rnd() * 2 - 1) * far
        const d = baseSDF(x, y, z, v)
        expect(Number.isFinite(d), `(${x}, ${y}, ${z})`).toBe(true)
        // A step of 1e-3 changes the value by about 1e-3 or less: no jump at caps or joints.
        // The oval's distance is the scaled radial one, steeper by up to halfW / halfH = 3.
        const step = baseSDF(x + 6e-4, y - 6e-4, z + 6e-4, v) - d
        expect(Math.abs(step), `(${x}, ${y}, ${z})`).toBeLessThan(3.1e-3)
      }
    })

    test(`${name}: insideBase is baseSDF < 0`, () => {
      const v = buildBaseVolume(base)
      const rnd = lcg(11)
      for (let n = 0; n < 2000; n++) {
        const x = (rnd() * 2 - 1) * 3, y = -1 + (rnd() * 2 - 1) * 0.8, z = (rnd() * 2 - 1) * 0.8
        expect(insideBase(x, y, z, v)).toBe(baseSDF(x, y, z, v) < 0)
      }
    })
  }

  test('an open base ends in flat caps: past an end ring the distance is the distance to its plane', () => {
    const base = fixture('default').base
    const v = buildBaseVolume(base)
    const path = sampleBasePath(base, base.lengthSegments)
    for (const [at, sign] of [[0, -1], [base.lengthSegments, 1]] as const) {
      const c = path.points[at]
      const t = path.tangents[at]
      for (const h of [-0.05, 0.05, 0.3]) {
        const d = baseSDF(c.x + sign * h * t.x, c.y + sign * h * t.y, c.z + sign * h * t.z, v)
        // Inside, the nearest surface is the cap (0.05 away) and not the 0.2-high side.
        expect(d).toBeCloseTo(h, 9)
      }
    }
  })

  test('a closed base has no caps: the ring where the loop closes is inside', () => {
    const base = fixture('rectClosedBase').base
    const v = buildBaseVolume(base)
    const c = sampleBasePath(base, base.lengthSegments).points[0]
    expect(baseSDF(c.x, c.y, c.z, v)).toBeCloseTo(-0.2, 6) // half the 0.4 height
  })

  test('a rectangular section is a box: corners are inside, the inscribed oval is not the limit', () => {
    const base = { ...fixture('default').base, crossSectionShape: 'rect' as const }
    const v = buildBaseVolume(base)
    const path = sampleBasePath(base, base.lengthSegments)
    const i = 12
    const c = path.points[i], N = path.normals[i], B = path.binormals[i]
    const at = (ln: number, lb: number) => baseSDF(c.x + ln * N.x + lb * B.x, c.y + ln * N.y + lb * B.y, c.z + ln * N.z + lb * B.z, v)
    expect(at(0.19, 0.59)).toBeLessThan(0) // near the corner (0.2, 0.6)
    expect(at(0.21, 0.61)).toBeGreaterThan(0)
    expect(at(0, 0)).toBeCloseTo(-0.2, 6)
  })

  test('without two control points there is no base: Infinity, never inside', () => {
    const v = buildBaseVolume({ ...fixture('default').base, controlPoints: [[0, 0, 0]] })
    expect(v.count).toBe(0)
    expect(baseSDF(0, 0, 0, v)).toBe(Infinity)
    expect(insideBase(0, 0, 0, v)).toBe(false)
  })
})
