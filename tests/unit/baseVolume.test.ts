import { describe, expect, test } from 'vitest'
import { baseSDF, buildBaseVolume, insideBase, sampleBasePath, type BaseVolume } from '../../src/geometry/primitives/base'
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

  describe('a base deeper than its ring spacing still ends at its caps', () => {
    // The default base at the Height slider's maximum, 2: half-height 1 and half-width 0.6. Past a
    // shared ring a piece keeps going with its depth reduced by the distance past the ring's
    // plane, and that depth, 0.6, is almost three ring spacings (0.217) here.
    const tall: BaseDef = { ...fixture('default').base, crossSectionHeight: 2 }
    const TALL: Array<[string, BaseDef]> = [
      ['oval', tall],
      ['rect', { ...tall, crossSectionShape: 'rect' }],
    ]
    for (const [name, base] of TALL) {
      test(`${name}: no point more than 1e-6 past the start or the end cap's plane is inside`, () => {
        const v = buildBaseVolume(base)
        const path = sampleBasePath(base, base.lengthSegments)
        for (const [at, sign] of [[0, -1], [base.lengthSegments, 1]] as const) {
          const c = path.points[at], t = path.tangents[at], N = path.normals[at], B = path.binormals[at]
          const where = (h: number, ln: number, lb: number) => [
            c.x + sign * h * t.x + ln * N.x + lb * B.x,
            c.y + sign * h * t.y + ln * N.y + lb * B.y,
            c.z + sign * h * t.z + ln * N.z + lb * B.z,
          ] as const
          // A grid past the cap's plane, across one and a half times the cross-section.
          for (const h of [2e-6, 1e-3, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.72, 0.8, 1, 1.5]) {
            for (let i = -6; i <= 6; i++) {
              for (let j = -6; j <= 6; j++) {
                const [x, y, z] = where(h, (i / 6) * 1.5 * v.halfH, (j / 6) * 1.5 * v.halfW)
                const label = `ring ${at}, ${h} past, (${i}, ${j})`
                expect(baseSDF(x, y, z, v), label).toBeGreaterThan(0)
                expect(insideBase(x, y, z, v), label).toBe(false)
              }
            }
          }
          // Random points around the end, wherever they lie past the plane.
          const rnd = lcg(29)
          let past = 0
          for (let n = 0; n < 3000; n++) {
            const x = c.x + (rnd() * 2 - 1) * 2, y = c.y + (rnd() * 2 - 1) * 2, z = c.z + (rnd() * 2 - 1) * 2
            if (sign * ((x - c.x) * t.x + (y - c.y) * t.y + (z - c.z) * t.z) <= 1e-6) continue
            past++
            expect(insideBase(x, y, z, v), `ring ${at}, (${x}, ${y}, ${z})`).toBe(false)
          }
          expect(past).toBeGreaterThan(1000)
          // Inside the cap the solid is whole: on the axis the nearest surface is the cap.
          const [x, y, z] = where(-0.05, 0, 0)
          expect(baseSDF(x, y, z, v)).toBeCloseTo(-0.05, 9)
        }
      })
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

describe('a centre line that turns back within one segment', () => {
  // A control polygon that doubles back makes the curve turn round within one segment (here
  // pieces 10 and 16 of 24), oval or rectangular. A two-point curve did the same at its start
  // while the kernel used three's CatmullRomCurve3, which puts both of its phantom ends at
  // 2 P1 - P0; it is now straight, and the two-point cuts of the default base stay as cases.
  const pts = fixture('default').base.controlPoints
  const DOUBLING_BACK: [number, number, number][] = [[-2, -1, 0], [1.5, -1, 0], [-0.5, -0.9, 0.05], [2, -1, 0.1]]
  const TURNING: Array<[string, BaseDef]> = [
    ...([[0, 1], [0, 2], [1, 3], [2, 3]] as const).map(
      ([a, b]) => [`the default base cut to P${a} and P${b}`, { ...fixture('default').base, controlPoints: [pts[a], pts[b]] }] as [string, BaseDef],
    ),
    ['a rectangular base whose control polygon doubles back', {
      ...fixture('default').base,
      crossSectionShape: 'rect',
      controlPoints: DOUBLING_BACK,
    }],
    ['an oval base whose control polygon doubles back', { ...fixture('default').base, controlPoints: DOUBLING_BACK }],
  ]

  /** Distance from (x, y, z) to the nearest straight piece between two of the volume's samples. */
  function centreLineDistance(v: BaseVolume, x: number, y: number, z: number): number {
    let best = Infinity
    for (let k = 0; k < v.count - 1; k++) {
      const [ax, ay, az] = [v.p[3 * k], v.p[3 * k + 1], v.p[3 * k + 2]]
      const [bx, by, bz] = [v.p[3 * k + 3] - ax, v.p[3 * k + 4] - ay, v.p[3 * k + 5] - az]
      const len2 = bx * bx + by * by + bz * bz
      const h = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / len2)) : 0
      best = Math.min(best, Math.hypot(x - ax - h * bx, y - ay - h * by, z - az - h * bz))
    }
    return best
  }

  for (const [name, base] of TURNING) {
    test(`${name}: nothing farther from the centre line than its drawn rings reach is inside`, () => {
      const v = buildBaseVolume(base)
      // Every drawn ring vertex lies within this distance of its ring's centre.
      const reach = base.crossSectionShape === 'rect' ? Math.hypot(v.halfH, v.halfW) : Math.max(v.halfH, v.halfW)
      const rnd = lcg(13)
      let far = 0
      for (let n = 0; n < 4000; n++) {
        const x = (rnd() * 2 - 1) * 12, y = (rnd() * 2 - 1) * 12, z = (rnd() * 2 - 1) * 12
        if (centreLineDistance(v, x, y, z) <= reach + 1e-9) continue
        far++
        expect(baseSDF(x, y, z, v), `(${x}, ${y}, ${z})`).toBeGreaterThan(0)
        expect(insideBase(x, y, z, v), `(${x}, ${y}, ${z})`).toBe(false)
      }
      expect(far).toBeGreaterThan(3000)
    })
  }
})
