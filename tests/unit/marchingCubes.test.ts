import { describe, expect, test } from 'vitest'
import { fillField, gridFromBounds, polygonise } from '../../src/geometry/marchingCubes/polygonise'
import { generateFlowCloud } from '../../src/workers/core/flowCloud'
import { generateSurfaceMesh } from '../../src/workers/core/surfaceMesh'
import { FIXTURE_NAMES, fixture, marchingCubesMessage, surfaceMeshMessage, type FixtureName } from '../fixtures/presets'
import { edgeUse, signedVolume } from '../helpers/mesh'

/** Marching cubes (src/geometry/marchingCubes/polygonise.ts) on analytic fields and on the workers' meshes. */

/** A sphere of `radius` at the origin, meshed on the grid over [-1.5, 1.5]^3 with `res` cells per axis. */
function sphere(radius: number, res: number) {
  // gridFromBounds pads the box by 0.5 on every side.
  const grid = gridFromBounds(-1, -1, -1, 1, 1, 1, res)
  const field = fillField(grid, (x, y, z) => radius - Math.sqrt(x * x + y * y + z * z))
  return { grid, field, ...polygonise(field, grid, 0) }
}

/** Grid edges whose two nodes lie on different sides of the iso level 0. */
function crossedGridEdges(field: Float32Array, res: number): number {
  const n = res + 1
  const inside = (x: number, y: number, z: number) => field[(z * n + y) * n + x] >= 0
  let count = 0
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (x < res && inside(x, y, z) !== inside(x + 1, y, z)) count++
        if (y < res && inside(x, y, z) !== inside(x, y + 1, z)) count++
        if (z < res && inside(x, y, z) !== inside(x, y, z + 1)) count++
      }
  return count
}

describe('polygonise', () => {
  test('a sphere inside the grid is one closed, consistently oriented surface with shared vertices', () => {
    const { grid, field, positions, indices } = sphere(1, 24)
    const use = edgeUse(indices)
    expect(use.notShared).toEqual([])
    expect(use.sameDirection).toBe(0)

    // Euler characteristic V - E + F of a sphere.
    expect(positions.length / 3 - use.edges + indices.length / 3).toBe(2)

    // One vertex per crossed grid edge, whichever cubes use it. (Six nodes lie exactly on this
    // sphere; the crossed edges around each end at that node, so their vertices coincide there.)
    expect(positions.length / 3).toBe(crossedGridEdges(field, grid.res))

    // Every vertex lies on the sphere, to within a small fraction of a cell.
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2])
      expect(Math.abs(r - 1)).toBeLessThan(0.1 * grid.sx)
    }
  })

  test("a sphere's triangles face outward: positive signed volume, close to 4/3 pi", () => {
    const { positions, indices } = sphere(1, 24)
    const volume = signedVolume(positions, indices)
    expect(volume).toBeGreaterThan(0)
    expect(volume / ((4 / 3) * Math.PI)).toBeCloseTo(1, 1)
  })

  test('a surface cut open by the grid boundary is open only along the boundary', () => {
    const { grid, positions, indices } = sphere(1.7, 24)
    const { notShared } = edgeUse(indices)
    expect(notShared.length).toBeGreaterThan(0)
    const lo = [grid.minX, grid.minY, grid.minZ]
    const hi = [grid.minX + grid.res * grid.sx, grid.minY + grid.res * grid.sy, grid.minZ + grid.res * grid.sz]
    for (const [a, b] of notShared) {
      // Both ends on the same boundary plane.
      const onPlane = [0, 1, 2].some((k) =>
        [lo[k], hi[k]].some((p) => positions[a * 3 + k] === p && positions[b * 3 + k] === p),
      )
      expect(onPlane, `edge ${a}-${b}`).toBe(true)
    }
  })
})

describe('worker meshes', () => {
  /** Each fixture's flow-cloud and surface meshes, computed once. */
  const cache = new Map<FixtureName, Array<{ positions: Float32Array; indices: Uint32Array }>>()
  function meshes(name: FixtureName) {
    if (!cache.has(name)) {
      const flowCloud = generateFlowCloud(marchingCubesMessage(fixture(name)))
      const surface = generateSurfaceMesh(surfaceMeshMessage(fixture(name)))
      cache.set(name, [{ positions: flowCloud.vertices, indices: flowCloud.indices }, surface])
    }
    return cache.get(name)!
  }

  // None of the fixtures' surfaces reaches its grid's boundary, so each mesh is closed.
  for (const name of FIXTURE_NAMES) {
    test(`${name}: every flow-cloud and surface-mesh edge is shared by two triangles, in opposite directions`, () => {
      for (const { indices } of meshes(name)) {
        expect(indices.length).toBeGreaterThan(0)
        const use = edgeUse(indices)
        expect(use.notShared).toEqual([])
        expect(use.sameDirection).toBe(0)
      }
    })

    test(`${name}: the flow-cloud and surface meshes face outward (positive signed volume)`, () => {
      for (const { positions, indices } of meshes(name)) expect(signedVolume(positions, indices)).toBeGreaterThan(0)
    })
  }
})
