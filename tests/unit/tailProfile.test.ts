import { describe, expect, test } from 'vitest'
import { resolveTailSetpoints, sampleTailPath, sampleTailSpine, tailCurve, tailWidthAt } from '../../src/geometry/primitives/tail'
import { fixture } from '../fixtures/presets'

/** The tail's width profile and spine samples (src/geometry/primitives/tail.ts), on their own. */

describe('tail width profile', () => {
  const setpoints = fixture('tailNone').tail.setpoints // widths 0.9, 0.7, 0.25, 0.05

  test("each setpoint's width at its own parameter k / (n - 1), where the curve passes through it", () => {
    const curve = tailCurve(setpoints)
    setpoints.forEach((sp, k) => {
      const t = k / (setpoints.length - 1)
      expect(tailWidthAt(setpoints, t)).toBe(sp.width)
      expect(curve.getPoint(t).toArray().map((v, i) => v - sp.position[i]).every((d) => Math.abs(d) < 1e-12)).toBe(true)
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
      expect([s.px, s.py, s.pz]).toEqual(path.points[i].toArray())
      expect(s.width).toBe(path.widths[i])
    })
    expect(sampleTailSpine({ ...tail, setpoints: tail.setpoints.slice(0, 1) })).toEqual([])
  })
})
