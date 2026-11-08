import { describe, expect, test } from 'vitest'
import { Float32Builder } from '../../src/geometry/arrayBuilder'
import { clipEdgeSet } from '../../src/geometry/clip'
import { cutAndGlue } from '../../src/workers/core/cutAndGlue'
import { cutAndGlueMessage, fixture } from '../fixtures/presets'

/** Cut & Glue's clipping (src/geometry/clip.ts) and its output (src/workers/core/cutAndGlue.ts). */

/** `count` unit segments along x, spaced along y, around (cx, cy, cz). */
function segments(count: number, cx: number, cy: number, cz: number): Float32Array {
  const out = new Float32Array(count * 6)
  for (let i = 0; i < count; i++) {
    const y = cy + i * 1e-3
    out.set([cx, y, cz, cx + 1, y, cz], i * 6)
  }
  return out
}

describe('clipEdgeSet', () => {
  const unitSphere = (x: number, y: number, z: number) => x * x + y * y + z * z < 1

  function clip(edges: number[]): number[] {
    const out = new Float32Builder(1)
    clipEdgeSet(new Float32Array(edges), unitSphere, out)
    return Array.from(out.toArray())
  }

  test('keeps the parts of a segment outside the solid, to the bisection tolerance', () => {
    const pieces = clip([-2, 0, 0, 2, 0, 0])
    expect(pieces).toHaveLength(12)
    expect(pieces.slice(0, 3)).toEqual([-2, 0, 0])
    expect(pieces[3]).toBeCloseTo(-1, 3)
    expect(pieces[6]).toBeCloseTo(1, 3)
    expect(pieces.slice(9)).toEqual([2, 0, 0])
  })

  test('drops a segment inside the solid and keeps one outside it whole', () => {
    expect(clip([-0.5, 0, 0, 0.5, 0, 0])).toEqual([])
    expect(clip([3, 0, 0, 4, 0, 0, 0.25, 0, 0, 0.5, 0, 0])).toEqual([3, 0, 0, 4, 0, 0])
  })
})

describe('cutAndGlue output', () => {
  // Pushing an edge set's output with push(...array) threw RangeError (call stack size) above
  // about 120,000 floats.
  test('keeps an edge set of 300,000 floats that no volume touches', () => {
    const far = segments(50_000, 50, 0, 50)
    const empty = new Float32Array(0)
    const { clippedEdges } = cutAndGlue(
      cutAndGlueMessage(fixture('default'), {
        sphereEdgeGroups: [],
        baseEdges: empty,
        tailEdges: empty,
        spiralEdges: empty,
        flowCloudEdges: far,
      }),
    )
    expect(clippedEdges).toEqual(far)
  })
})
