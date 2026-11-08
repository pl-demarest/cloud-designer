import { describe, expect, test } from 'vitest'
import { extractSpiral } from '../../src/geometry/flowField'
import { fillField, gridFromBounds, polygonise } from '../../src/geometry/marchingCubes/polygonise'
import { makeFlowCloud, makeSphere, makeTail } from '../../src/model/defaults'
import { generateFlowCloud } from '../../src/workers/core/flowCloud'
import type { CloudPreset } from '../../src/model/types'
import { fixture, marchingCubesMessage } from '../fixtures/presets'

/** Bands and flow lines (extractSpiral in src/geometry/flowField.ts): level sets chained over the mesh. */

function longestEdge(vertices: Float32Array, indices: Uint32Array): number {
  let m = 0
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k] * 3
      const b = indices[t + ((k + 1) % 3)] * 3
      m = Math.max(m, Math.hypot(vertices[a] - vertices[b], vertices[a + 1] - vertices[b + 1], vertices[a + 2] - vertices[b + 2]))
    }
  }
  return m
}

/** Lengths of the steps between consecutive points of a polyline. */
function steps(line: Float32Array): number[] {
  const out: number[] = []
  for (let i = 3; i < line.length; i += 3) {
    out.push(Math.hypot(line[i] - line[i - 3], line[i + 1] - line[i - 2], line[i + 2] - line[i - 1]))
  }
  return out
}

/** For segment pairs: how many segments end at each point. A closed contour gives 2 everywhere. */
function endpointUses(segments: Float32Array): number[] {
  const uses = new Map<string, number>()
  for (let i = 0; i < segments.length; i += 3) {
    const key = `${segments[i]},${segments[i + 1]},${segments[i + 2]}`
    uses.set(key, (uses.get(key) ?? 0) + 1)
  }
  return [...new Set(uses.values())].sort()
}

function zeroLengthSegments(segments: Float32Array): number {
  let n = 0
  for (let i = 0; i < segments.length; i += 6) {
    if (segments[i] === segments[i + 3] && segments[i + 1] === segments[i + 4] && segments[i + 2] === segments[i + 5]) n++
  }
  return n
}

describe('flow lines', () => {
  for (const name of ['default', 'rotated', 'tailStart', 'tailStrength'] as const) {
    test(`${name}: polylines over the mesh, no repeated point, no step longer than a mesh edge`, () => {
      const p = fixture(name)
      const { vertices, indices, flowLines } = generateFlowCloud(marchingCubesMessage(p))
      const longest = longestEdge(vertices, indices)
      // Every flow line meets the surface; a line can come in more than one piece.
      expect(flowLines.length).toBeGreaterThanOrEqual(p.flowCloud.wireframe.numFlowLines)
      const all = flowLines.flatMap(steps)
      expect(all.filter((s) => s === 0)).toHaveLength(0)
      expect(Math.max(...all)).toBeLessThanOrEqual(longest)
      for (const line of flowLines) expect(line.length).toBeGreaterThanOrEqual(6)
    })
  }
})

describe('bands', () => {
  /** The bands fixture with the first tail setpoint inside the cloud: vertices past it clamp to u = 1. */
  function plateau(): CloudPreset {
    const p = fixture('bands')
    p.tail.attachToBase = 'none'
    p.tail.setpoints[0].position = [0.5, -0.8, 0]
    return p
  }

  for (const [name, preset] of [
    ['bands', () => fixture('bands')],
    ['bands with a u = 1 plateau', plateau],
  ] as const) {
    test(`${name}: every contour closes, and no segment has zero length`, () => {
      const { bands } = generateFlowCloud(marchingCubesMessage(preset()))
      expect(bands.length).toBeGreaterThan(0)
      for (const band of bands) {
        expect(endpointUses(band)).toEqual([2])
        expect(zeroLengthSegments(band)).toBe(0)
      }
    })
  }
})

describe('extractSpiral on a sphere', () => {
  // A unit sphere at the origin, axis from (-1, 0, 0) to (1, 0, 0) and no tail, so u = (x + 1) / 2.
  // The angle is atan2(-y, z): extractSpiral's perpendicular basis for this axis is (0, 0, 1), (0, -1, 0).
  const grid = gridFromBounds(-1, -1, -1, 1, 1, 1, 32)
  const mesh = polygonise(fillField(grid, (x, y, z) => 1 - Math.hypot(x, y, z)), grid, 0)
  const flowCloud = makeFlowCloud()
  Object.assign(flowCloud.wireframe, {
    frontPoint: [-1, 0, 0],
    backPoint: [1, 0, 0],
    numBands: 4,
    numFlowLines: 8,
    spiralTwist: Math.PI / 2,
    generateBands: true,
    showFlowLines: true,
  })
  const tail = { ...makeTail(), setpoints: [] }
  const { bands, flowLines } = extractSpiral(mesh.positions, mesh.indices, flowCloud, [makeSphere('s')], tail)

  test('each band is a closed contour on its plane x = 2u - 1 (u = 0 and 1 touch no edge)', () => {
    expect(bands).toHaveLength(3)
    bands.forEach((band, i) => {
      const x = -0.5 + 0.5 * i
      for (let k = 0; k < band.length; k += 3) expect(Math.abs(band[k] - x)).toBeLessThan(1e-5)
      expect(endpointUses(band)).toEqual([2])
    })
  })

  test('each flow line is one polyline from front to back at its angle', () => {
    expect(flowLines).toHaveLength(8)
    flowLines.forEach((line, i) => {
      const target = (i / 8) * 2 * Math.PI - Math.PI
      expect(line[0]).toBeLessThan(line[line.length - 3])
      for (let k = 0; k < line.length; k += 3) {
        const [x, y, z] = [line[k], line[k + 1], line[k + 2]]
        // Away from the poles, where the angle varies slowly along an edge.
        if (Math.hypot(y, z) < 0.3) continue
        const off = Math.atan2(-y, z) + (Math.PI / 2) * ((x + 1) / 2) - target
        expect(Math.abs(off - 2 * Math.PI * Math.round(off / (2 * Math.PI)))).toBeLessThan(0.02)
      }
      expect(steps(line).filter((s) => s === 0)).toHaveLength(0)
    })
  })
})
