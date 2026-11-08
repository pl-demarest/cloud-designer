// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { installFakeWorker } from '../helpers/scene'
import { TEST_ENGINE_OPTIONS, installCanvas2dStub, mountCanvas } from '../helpers/engine'
import { trackResources, type ResourceTracker } from '../helpers/resources'

/**
 * Editing creates no materials and leaves no geometry behind: a sequence of adds, edits,
 * removals and an undo that ends on the preset it started from, with a Regenerate and a Cut &
 * Glue run before and after, ends with the live counts it started with. Counted without a
 * renderer (tests/helpers/resources.ts).
 */

const store = () => useCloudStore.getState()
const history = () => useHistoryStore.getState()

let engine: EditorEngine | null = null
let resources: ResourceTracker

beforeAll(() => {
  installFakeWorker()
  installCanvas2dStub()
})

beforeEach(() => {
  store().resetToDefault()
  // The smallest grids the editor offers: the counts do not depend on them.
  store().setSurfaceMeshResolution(32)
  store().setFlowCloud({ resolution: 32 })
  history().clear()
  resources = trackResources()
  engine = new EditorEngine(mountCanvas(), TEST_ENGINE_OPTIONS)
})

afterEach(() => {
  engine?.dispose()
  engine = null
  resources.stop()
})

const lastId = (list: Array<{ id: string }>) => list[list.length - 1].id

describe('materials and geometries across editing', () => {
  test('add, edit, remove and undo, with Regenerate and Cut & Glue, end on the starting counts', async () => {
    const e = engine!
    expect((await e.regenerate()).status).toBe('done')
    expect((await e.cutAndGlue()).map((o) => o.status)).toEqual(['done', 'done'])
    const settled = resources.live()
    const materialsCreated = resources.created().materials

    // Add, edit and remove a sphere and a spiral.
    store().addSphere()
    const sphereId = lastId(store().preset.spheres)
    store().updateSphere(sphereId, { radius: 0.7, rotation: [0.2, 0.1, 0] })
    store().updateSphere(sphereId, { shape: 'ellipsoid', scale: [1.5, 1, 1] })
    store().removeSphere(sphereId)
    store().addSpiral()
    const spiralId = lastId(store().preset.spirals)
    store().updateSpiral(spiralId, { thickness: 0.3 })
    store().updateSpiral(spiralId, { thickness: 0 })
    store().removeSpiral(spiralId)
    const width = store().preset.base.crossSectionWidth
    store().setBase({ crossSectionWidth: 0.9 })
    store().setBase({ crossSectionWidth: width })

    // Undo an added sphere, as the toolbar does.
    history().push(store().preset)
    store().addSphere()
    history().push(store().preset)
    store().loadPreset(history().undo())
    expect(store().preset.spheres).toHaveLength(3)

    // Each run replaces the previous result.
    expect((await e.regenerate()).status).toBe('done')
    expect((await e.cutAndGlue()).map((o) => o.status)).toEqual(['done', 'done'])

    expect(resources.created().materials - materialsCreated, 'materials created while editing').toBe(0)
    expect(resources.live(), 'live geometries, materials and textures').toEqual(settled)
  }, 20_000)
})
