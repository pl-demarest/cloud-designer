// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, test } from 'vitest'
import { digestArray } from '../helpers/digest'
import { goldenSuite } from '../helpers/golden'
import { runWorker } from '../helpers/workerHarness'
import { buildEditorScene, installFakeWorker, regenerateFlowCloud, serializeGroup, type EditorScene } from '../helpers/scene'
import { FIXTURE_NAMES, cutAndGlueMessage, fixture, surfaceMeshMessage, type PrimitiveEdges } from '../fixtures/presets'
import { useCloudStore } from '../../src/store/cloudStore'

/**
 * Characterization goldens for the editor side: each primitive module's wireframe
 * (getEdges / getEdgesGrouped and every child geometry in its group, handles
 * included), the flow-cloud scene FlowCloud builds from the real marchingCubes
 * worker, the cut-and-glue worker fed with those real edge buffers, and the
 * CutGlueResult scene built from the cut-and-glue and surface-mesh outputs.
 */

const primitives = goldenSuite('primitives')
const flowCloudScene = goldenSuite('flowCloud-scene')
const cutAndGlue = goldenSuite('worker-cutAndGlue')
const cutGlueScene = goldenSuite('cutGlueResult-scene')

beforeAll(() => {
  installFakeWorker()
})

let scene: EditorScene | null = null
afterEach(() => {
  scene?.dispose()
  scene = null
})

function collectEdges(s: EditorScene): PrimitiveEdges {
  // Same calls, same order as App.handleCutAndGlue.
  return {
    sphereEdgeGroups: s.sphere.getEdgesGrouped(),
    baseEdges: s.base.getEdges(),
    tailEdges: s.tail.getEdges(),
    spiralEdges: s.spiral.getEdges(),
    flowCloudEdges: s.flowCloud.getEdges(),
  }
}

describe('editor goldens per fixture', () => {
  for (const name of FIXTURE_NAMES) {
    test(name, async () => {
      const s = (scene = buildEditorScene(fixture(name)))
      const vp = s.vp

      primitives.check(`${name}/sphere`, {
        edgesGrouped: s.sphere.getEdgesGrouped().map((g) => ({ sphereId: g.sphereId, edges: digestArray(g.edges) })),
        edges: digestArray(s.sphere.getEdges()),
        group: serializeGroup(vp.sphereGroup),
      })
      primitives.check(`${name}/base`, {
        edges: digestArray(s.base.getEdges()),
        pointAt: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((t) => s.base.getPointAt(t).toArray()),
        group: serializeGroup(vp.baseGroup),
      })
      primitives.check(`${name}/tail`, {
        edges: digestArray(s.tail.getEdges()),
        group: serializeGroup(vp.tailGroup),
      })
      primitives.check(`${name}/spiral`, {
        edgesGrouped: s.spiral.getEdgesGrouped().map((g) => ({ spiralId: g.spiralId, edges: digestArray(g.edges) })),
        edges: digestArray(s.spiral.getEdges()),
        group: serializeGroup(vp.spiralGroup),
      })

      // Before any Regenerate the flow-cloud group holds only its hidden handle.
      flowCloudScene.check(`${name}/before-regenerate`, {
        edges: digestArray(s.flowCloud.getEdges()),
        group: serializeGroup(vp.flowCloudGroup),
      })
      await regenerateFlowCloud(s.flowCloud)
      flowCloudScene.check(`${name}/after-regenerate`, {
        generating: s.flowCloud.isGenerating(),
        edges: digestArray(s.flowCloud.getEdges()),
        group: serializeGroup(vp.flowCloudGroup),
      })

      // Cut & Glue with the real edge buffers, as after Regenerate in the app.
      const preset = useCloudStore.getState().preset
      const edges = collectEdges(s)
      const cg = await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', cutAndGlueMessage(preset, edges))
      cutAndGlue.check(name, {
        input: {
          sphereEdgeGroups: edges.sphereEdgeGroups.map((g) => ({ sphereId: g.sphereId, edges: digestArray(g.edges) })),
          baseEdges: digestArray(edges.baseEdges),
          tailEdges: digestArray(edges.tailEdges),
          spiralEdges: digestArray(edges.spiralEdges),
          flowCloudEdges: digestArray(edges.flowCloudEdges),
        },
        output: {
          keys: Object.keys(cg.message),
          clippedEdges: digestArray(cg.message.clippedEdges),
          transferIsOutputBuffer: cg.transfer.length === 1 && cg.transfer[0] === cg.message.clippedEdges.buffer,
        },
      })

      const sm = await runWorker<{ positions: Float32Array; indices: Uint32Array }>(
        'surfaceMesh',
        surfaceMeshMessage(preset),
      )
      s.cutGlue.update(cg.message.clippedEdges)
      s.cutGlue.updateSurfaceMesh(sm.message.positions, sm.message.indices)
      const shown = {
        hasSurfaceMesh: s.cutGlue.hasSurfaceMesh(),
        edges: digestArray(s.cutGlue.getEdges()),
        group: serializeGroup(vp.cutGlueGroup),
      }
      s.cutGlue.setSurfaceMeshVisible(true)
      cutGlueScene.check(name, {
        ...shown,
        afterSurfaceMeshVisible: serializeGroup(vp.cutGlueGroup).map((o) => ({ type: o.type, visible: o.visible })),
      })
    })
  }
})

describe('editor visibility toggles', () => {
  const golden = goldenSuite('editor-toggles')

  test('SpiralMesh.setHandlesVisible and FlowCloud.setHandlesVisible', async () => {
    const s = (scene = buildEditorScene(fixture('thickSpiral')))
    const visibility = () => ({
      spiral: s.vp.spiralGroup.children.map((c) => [c.type, c.visible]),
      flowCloud: s.vp.flowCloudGroup.children.map((c) => [c.type, c.visible]),
    })
    const initial = visibility()
    s.spiral.setHandlesVisible(false)
    s.flowCloud.setHandlesVisible(false)
    const hiddenBeforeGenerate = visibility()
    s.flowCloud.setHandlesVisible(true)
    const shownBeforeGenerate = visibility()
    await regenerateFlowCloud(s.flowCloud)
    const shownAfterGenerate = visibility()
    s.flowCloud.clear()
    const afterClear = { ...visibility(), edges: digestArray(s.flowCloud.getEdges()) }
    golden.check('handles', { initial, hiddenBeforeGenerate, shownBeforeGenerate, shownAfterGenerate, afterClear })
  })

  test('store edits after construction resync the modules', async () => {
    const s = (scene = buildEditorScene(fixture('default')))
    const store = useCloudStore.getState()
    store.updateSphere('sphere-1', { radius: 0.7, rotation: [0.2, 0.1, 0] })
    store.setBase({ crossSectionWidth: 0.9 })
    store.updateTailSetpoint('tail-2', { width: 0.3 })
    store.addSpiral() // random id; only geometry is pinned
    golden.check('after-edits', {
      sphere: digestArray(s.sphere.getEdges()),
      base: digestArray(s.base.getEdges()),
      tail: digestArray(s.tail.getEdges()),
      spiral: digestArray(s.spiral.getEdges()),
      spiralChildren: s.vp.spiralGroup.children.length,
    })
  })
})
