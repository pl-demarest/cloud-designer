import { describe, expect, test } from 'vitest'
import { generateFlowCloud } from '../../src/workers/core/flowCloud'
import { generateSurfaceMesh } from '../../src/workers/core/surfaceMesh'
import type { CloudPreset } from '../../src/model/types'
import { fixture, marchingCubesMessage, surfaceMeshMessage } from '../fixtures/presets'
import { edgeUse } from '../helpers/mesh'

/**
 * The marching-cubes grid must hold the whole isosurface, or the mesh is cut open where the
 * surface meets the grid's boundary. The flow cloud's metaball surface reaches furthest at the
 * slider limits: falloff 5 (SpherePanel) and threshold 0.5 (FlowCloudPanel).
 */

/** The default preset at grid 32 with every sphere's falloff and the threshold at their limits. */
function extreme(edit: (p: CloudPreset) => void = () => {}): CloudPreset {
  const p = fixture('default')
  p.flowCloud.resolution = 32
  p.surfaceMeshResolution = 32
  p.flowCloud.threshold = 0.5
  for (const s of p.spheres) s.falloff = 5
  edit(p)
  return p
}

const CASES: Array<[string, CloudPreset]> = [
  ['one sphere of radius 1.2', extreme((p) => (p.spheres = [p.spheres[0]]))],
  ['the default three spheres', extreme()],
  ['tail in the field (tailStrength 1)', extreme((p) => (p.flowCloud.tailStrength = 1))],
  [
    'tail in the field, flow cloud moved 3 along x',
    extreme((p) => {
      p.flowCloud.tailStrength = 1
      p.flowCloud.position = [3, 0, 0]
    }),
  ],
]

describe('grid bounds at the slider limits', () => {
  for (const [name, p] of CASES) {
    test(`${name}: the flow-cloud and surface meshes are closed`, () => {
      const flowCloud = generateFlowCloud(marchingCubesMessage(p))
      const surface = generateSurfaceMesh(surfaceMeshMessage(p))
      for (const indices of [flowCloud.indices, surface.indices]) {
        expect(indices.length).toBeGreaterThan(0)
        expect(edgeUse(indices).notShared).toHaveLength(0)
      }
    })
  }
})
