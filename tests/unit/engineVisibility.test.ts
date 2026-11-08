// @vitest-environment happy-dom
import * as THREE from 'three'
import { fullScene } from '../../src/export/scenes'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { useCloudStore } from '../../src/store/cloudStore'
import { useUiStore } from '../../src/store/uiStore'
import { installFakeWorker, isHandle } from '../helpers/scene'
import { TEST_ENGINE_OPTIONS, installCanvas2dStub, mountCanvas } from '../helpers/engine'

/**
 * The engine shows what the view flags say, whatever order they were set in: the mode and
 * Show/Hide combine (computeVisibility, tested on its own in visibility.test.ts), a spiral added
 * in Preview is shown or hidden like the others, and a new Cut & Glue result keeps the Surface
 * Mesh choice.
 */

const store = () => useCloudStore.getState()
const ui = () => useUiStore.getState()

let engine: EditorEngine

beforeAll(() => {
  installFakeWorker()
  installCanvas2dStub()
})

beforeEach(() => {
  store().resetToDefault()
  store().setSurfaceMeshResolution(32)
  store().setFlowCloud({ resolution: 32 })
  useUiStore.setState(useUiStore.getInitialState())
  engine = new EditorEngine(mountCanvas(), TEST_ENGINE_OPTIONS)
})

afterEach(() => engine.dispose())

describe('mode and Show/Hide', () => {
  test('visibility-desync: Hide, then Preview, then Edit leaves the flow cloud hidden', () => {
    ui().toggleFlowCloud() // Hide
    ui().setMode('preview')
    ui().setMode('edit')
    expect(ui().showFlowCloud).toBe(false)
    expect(engine.viewport.flowCloudGroup.visible).toBe(false)
    expect(engine.viewport.sphereGroup.visible).toBe(true)
  })

  test('visibility-desync: Show in Preview does not draw the flow cloud over the Cut & Glue result', () => {
    ui().toggleFlowCloud() // Hide
    ui().setMode('preview')
    ui().toggleFlowCloud() // Show
    expect(engine.viewport.flowCloudGroup.visible).toBe(false)
    expect(engine.viewport.cutGlueGroup.visible).toBe(true)
    ui().setMode('edit')
    expect(engine.viewport.flowCloudGroup.visible).toBe(true)
  })
})

describe('spirals in Preview', () => {
  test('a flat spiral added with the surface mesh shown is drawn, without its handle; removing it hides the group', () => {
    ui().setMode('preview')
    ui().setSurfaceMeshVisible(true)
    expect(engine.viewport.spiralGroup.visible, 'no spirals yet').toBe(false)

    store().addSpiral()
    const id = store().preset.spirals[0].id
    store().updateSpiral(id, { thickness: 0 })
    expect(engine.viewport.spiralGroup.visible, 'a flat spiral beside the surface mesh').toBe(true)
    const handle = engine.viewport.spiralGroup.children.find(isHandle)!
    expect(handle.visible, "the new spiral's handle is hidden in Preview").toBe(false)

    store().removeSpiral(id)
    expect(engine.viewport.spiralGroup.visible).toBe(false)
  })
})

describe('beside the surface mesh only the flat spirals are drawn (cd:review CDR-06)', () => {
  /** Whether the renderer draws `obj`: shown with its ancestors, and on a layer the camera sees. */
  const drawn = (obj: THREE.Object3D) => {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false
    return obj.layers.test(engine.viewport.camera.layers)
  }
  const wire = (id: string) => engine.viewport.spiralGroup.children.find((c) => c.userData.spiralId === id && !isHandle(c))!

  test('Preview with the surface mesh: the flat wire is drawn, the thick one is not (the mesh holds it); Edit draws both', () => {
    store().addSpiral() // thick
    store().addSpiral()
    const [thick, flat] = store().preset.spirals.map((s) => s.id)
    store().updateSpiral(flat, { thickness: 0 })
    ui().setMode('preview')
    ui().setSurfaceMeshVisible(true)
    expect([drawn(wire(flat)), drawn(wire(thick))]).toEqual([true, false])
    ui().setMode('edit')
    expect([drawn(wire(flat)), drawn(wire(thick))]).toEqual([true, true])
    // A thickness edit in Preview moves the wire between the two.
    ui().setMode('preview')
    store().updateSpiral(thick, { thickness: 0 })
    expect(drawn(wire(thick)), 'now flat').toBe(true)
  })

  test('the exports keep every spiral, whatever the viewport draws', () => {
    store().addSpiral()
    store().addSpiral()
    store().updateSpiral(store().preset.spirals[1].id, { thickness: 0 })
    ui().setMode('preview')
    ui().setSurfaceMeshVisible(true)
    const full = fullScene({ ...engine.scaffoldGroups(), flowCloud: engine.viewport.flowCloudGroup })!
    const spirals = full.getObjectByName('spirals')!
    expect(spirals.children.filter((c) => c instanceof THREE.LineSegments && c.visible)).toHaveLength(2)
  })
})

describe('Cut & Glue', () => {
  /** The result's two wireframes: the clipped edges and the surface mesh (a WireframeGeometry). */
  function layers() {
    const lines = engine.viewport.cutGlueGroup.children as THREE.LineSegments[]
    const surface = lines.find((l) => l.geometry instanceof THREE.WireframeGeometry)!
    const clipped = lines.find((l) => !(l.geometry instanceof THREE.WireframeGeometry))!
    return { clipped: clipped.visible, surface: surface.visible }
  }

  test('surface-toggle-desync: a run with the Surface Mesh box checked shows the surface mesh', async () => {
    await engine.regenerate()
    await engine.cutAndGlue()
    expect(layers()).toEqual({ clipped: true, surface: false })
    ui().setSurfaceMeshVisible(true)
    expect(layers()).toEqual({ clipped: false, surface: true })

    await engine.cutAndGlue()
    expect(layers(), 'the new result keeps the choice').toEqual({ clipped: false, surface: true })
  }, 20_000)
})
