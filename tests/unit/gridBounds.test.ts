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

describe('the flow-cloud grid holds what is in the field', () => {
  // With tailStrength 0 the tail adds nothing to the metaball field (audit
  // mc-bbox-includes-disabled-tail), so it must not stretch the grid: the cells go to the body.
  test('with tailStrength 0 the mesh does not depend on the tail: none, the default one, or one far away', () => {
    const mesh = (edit: (p: CloudPreset) => void) => {
      const p = fixture('default')
      edit(p)
      const { vertices, indices } = generateFlowCloud(marchingCubesMessage(p))
      return { vertices, indices }
    }
    const noTail = mesh((p) => (p.tail.setpoints = []))
    expect(noTail.indices.length).toBeGreaterThan(0)
    expect(mesh(() => {})).toEqual(noTail)
    expect(
      mesh((p) => {
        p.tail.attachToBase = 'none'
        for (const sp of p.tail.setpoints) sp.position = [sp.position[0] + 20, sp.position[1], sp.position[2]]
      }),
    ).toEqual(noTail)
  })
})

describe("a sphere's scale counts only for an ellipsoid (cd:review CDR-02)", () => {
  // The model keeps the scale of a sphere whose Shape went back from Ellipsoid to Sphere; the
  // field, the volume and the wire then ignore it, and so must the grid and the flow lines' u range.
  function hiddenScale(): CloudPreset {
    const p = fixture('default')
    p.flowCloud.resolution = 32
    p.surfaceMeshResolution = 32
    p.spheres[0].scale = [3, 1, 1] // shape stays 'sphere'
    return p
  }
  function plain(): CloudPreset {
    const p = fixture('default')
    p.flowCloud.resolution = 32
    p.surfaceMeshResolution = 32
    return p
  }

  test('the flow cloud and its flow lines are those of the same sphere without the scale', () => {
    const got = generateFlowCloud(marchingCubesMessage(hiddenScale()))
    const want = generateFlowCloud(marchingCubesMessage(plain()))
    expect(got.vertices).toEqual(want.vertices)
    expect(got.indices).toEqual(want.indices)
    expect(got.flowLines).toEqual(want.flowLines)
  })

  test('the surface mesh is that of the same sphere without the scale', () => {
    const got = generateSurfaceMesh(surfaceMeshMessage(hiddenScale()))
    const want = generateSurfaceMesh(surfaceMeshMessage(plain()))
    expect(got.positions).toEqual(want.positions)
    expect(got.indices).toEqual(want.indices)
  })
})
