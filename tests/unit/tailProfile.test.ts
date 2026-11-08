import { describe, expect, test } from 'vitest'
import {
  attachedTail,
  buildTailVolume,
  insideTail,
  resolveTailSetpoints,
  sampleTailPath,
  sampleTailSpine,
  tailCurve,
  tailSDF,
  tailWidthAt,
} from '../../src/geometry/primitives/tail'
import { fixture } from '../fixtures/presets'

/** A pseudo-random sequence, so the sample points are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

/** The tail's width profile and spine samples (src/geometry/primitives/tail.ts), on their own. */

describe('tail width profile', () => {
  const setpoints = fixture('tailNone').tail.setpoints // widths 0.9, 0.7, 0.25, 0.05

  test("each setpoint's width at its own parameter k / (n - 1), where the curve passes through it", () => {
    const curve = tailCurve(setpoints)
    setpoints.forEach((sp, k) => {
      const t = k / (setpoints.length - 1)
      expect(tailWidthAt(setpoints, t)).toBe(sp.width)
      const { x, y, z } = curve.getPoint(t)
      expect([x, y, z].map((v, i) => v - sp.position[i]).every((d) => Math.abs(d) < 1e-12)).toBe(true)
    })
  })

  test('linear in the curve parameter between setpoints', () => {
    expect(tailWidthAt(setpoints, 0.5 / 3)).toBeCloseTo((0.9 + 0.7) / 2, 12)
    expect(tailWidthAt(setpoints, 2.25 / 3)).toBeCloseTo(0.25 + 0.25 * (0.05 - 0.25), 12)
  })

  test('the spine samples are the path samples: arc-length points with their widths', () => {
    const p = fixture('default')
    const tail = { ...p.tail, setpoints: resolveTailSetpoints(p.tail, p.base) }
    const path = sampleTailPath(tail.setpoints, tail.lengthSegments)
    const spine = sampleTailSpine(tail)
    expect(spine).toHaveLength(tail.lengthSegments + 1)
    spine.forEach((s, i) => {
      expect([s.px, s.py, s.pz]).toEqual([path.points[i].x, path.points[i].y, path.points[i].z])
      expect(s.width).toBe(path.widths[i])
    })
    expect(sampleTailSpine({ ...tail, setpoints: tail.setpoints.slice(0, 1) })).toEqual([])
  })
})

describe('tail volume', () => {
  const TAILS = (['default', 'tailNone', 'tailStart'] as const).map((name) => {
    const p = fixture(name)
    return [name, attachedTail(p.tail, p.base)] as const
  })

  for (const [name, tail] of TAILS) {
    const v = buildTailVolume(tail)

    test(`${name}: finite near and far, and 1-Lipschitz along short steps`, () => {
      const rnd = lcg(5)
      for (let n = 0; n < 2000; n++) {
        const far = n % 4 === 0 ? 20 : 2
        const x = 3.3 + (rnd() * 2 - 1) * far, y = -0.3 + (rnd() * 2 - 1) * far, z = 0.4 + (rnd() * 2 - 1) * far
        const d = tailSDF(x, y, z, v)
        expect(Number.isFinite(d), `(${x}, ${y}, ${z})`).toBe(true)
        // A step of 1e-3 changes the value by about 1e-3 or less: no jump at caps or joints.
        expect(Math.abs(tailSDF(x + 6e-4, y - 6e-4, z + 6e-4, v) - d), `(${x}, ${y}, ${z})`).toBeLessThan(1.1e-3)
      }
    })

    test(`${name}: insideTail is tailSDF < 0`, () => {
      const rnd = lcg(7)
      for (let n = 0; n < 4000; n++) {
        const x = 3.3 + (rnd() * 2 - 1) * 1.8, y = -0.3 + (rnd() * 2 - 1) * 1.2, z = 0.4 + (rnd() * 2 - 1) * 1.2
        expect(insideTail(x, y, z, v)).toBe(tailSDF(x, y, z, v) < 0)
      }
    })
  }

  test('the tube ends in flat caps: past an end ring the distance is the distance to its plane', () => {
    const [, tail] = TAILS[0]
    const v = buildTailVolume(tail)
    const path = sampleTailPath(tail.setpoints, tail.lengthSegments)
    for (const [at, sign] of [[0, -1], [tail.lengthSegments, 1]] as const) {
      const c = path.points[at]
      const t = path.tangents[at]
      // Inside, nearer the cap than the side: 0.02 against a radius of at least 0.1.
      for (const h of [-0.02, 0.02, 0.3]) {
        expect(tailSDF(c.x + sign * h * t.x, c.y + sign * h * t.y, c.z + sign * h * t.z, v)).toBeCloseTo(h, 9)
      }
    }
  })

  test('without two setpoints there is no tail: Infinity, never inside', () => {
    const v = buildTailVolume({ ...fixture('default').tail, setpoints: fixture('default').tail.setpoints.slice(0, 1) })
    expect(v.count).toBe(0)
    expect(tailSDF(3, 0, 0, v)).toBe(Infinity)
    expect(insideTail(3, 0, 0, v)).toBe(false)
  })
})
