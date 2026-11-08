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

describe('the surface-mesh grid holds the solids, not only their control points (cd:review CDR-07)', () => {
  /** A base whose control polygon turns back on itself: the curve overshoots its ends by about
   *  0.125 of the leg, 1.5 here, past the 1.1 the control-point padding gives. */
  function hairpin(leg: number, shape: 'oval' | 'rect' = 'oval'): CloudPreset {
    const p = fixture('default')
    p.spheres = []
    p.base.controlPoints = [[-leg, 0, 0], [leg, 0, 0], [leg, 0.05, 0], [-leg, 0.05, 0]]
    p.base.crossSectionShape = shape
    p.tail.attachToBase = 'none'
    p.surfaceMeshResolution = 64
    return p
  }

  for (const [name, preset] of [
    ['a hairpin base with 12-unit legs', hairpin(6)],
    ['the same with a rectangular section', hairpin(6, 'rect')],
    ['a hairpin base with 4-unit legs (inside the padding before too)', hairpin(2)],
  ] as const) {
    test(`${name}: the surface mesh is closed`, () => {
      const { indices } = generateSurfaceMesh(surfaceMeshMessage(preset))
      expect(indices.length).toBeGreaterThan(0)
      expect(edgeUse(indices).notShared, 'open edges').toEqual([])
    })
  }

  test('a tail whose curve overshoots its setpoints: the surface mesh is closed', () => {
    const p = fixture('default')
    p.spheres = []
    p.tail.attachToBase = 'none'
    p.tail.setpoints = [
      { id: 't0', position: [-6, 4, 0], width: 0.3 },
      { id: 't1', position: [6, 4, 0], width: 0.3 },
      { id: 't2', position: [6, 4.05, 0], width: 0.3 },
      { id: 't3', position: [-6, 4.05, 0], width: 0.3 },
    ]
    p.surfaceMeshResolution = 64
    const { indices } = generateSurfaceMesh(surfaceMeshMessage(p))
    expect(edgeUse(indices).notShared, 'open edges').toEqual([])
  })
})
