// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { useUiStore } from '../../src/store/uiStore'
import { countRebuilds, installFakeWorker, isHandle } from '../helpers/scene'
import { TEST_ENGINE_OPTIONS, installCanvas2dStub, mountCanvas } from '../helpers/engine'
import { digestArray } from '../helpers/digest'

/**
 * Each view rebuilds a wireframe or a handle only when its own inputs change by value, so an
 * edit rebuilds what it changed and an undo (a whole new, normalized preset) rebuilds what the
 * undone step changed. countRebuilds (tests/helpers/scene.ts) counts the geometries an action
 * builds, per view. Before this, adding a sphere rebuilt all 4 sphere wires plus the new handle
 * (5), each move of a base handle rebuilt the base wire and its 4 handles (5) and the tail's wire
 * and 3 handles (4), and an undo rebuilt every sphere, the base and the tail.
 */

const store = () => useCloudStore.getState()
const history = () => useHistoryStore.getState()
const NONE = { sphereGroup: 0, baseGroup: 0, tailGroup: 0, spiralGroup: 0 }

let engine: EditorEngine
let canvas: HTMLCanvasElement

beforeAll(() => {
  installFakeWorker()
  installCanvas2dStub()
})

beforeEach(() => {
  store().resetToDefault()
  history().clear()
  useUiStore.setState(useUiStore.getInitialState())
  canvas = mountCanvas()
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  canvas.setPointerCapture = () => {}
  canvas.releasePointerCapture = () => {}
  engine = new EditorEngine(canvas, TEST_ENGINE_OPTIONS)
  engine.viewport.resize(100, 100)
  history().push(store().preset) // App pushes the opening preset
})

afterEach(() => engine.dispose())

function pointer(type: string, ndc: THREE.Vector2): void {
  canvas.dispatchEvent(new PointerEvent(type, { clientX: (ndc.x + 1) * 50, clientY: (1 - ndc.y) * 50, pointerId: 1 }))
}

/** Drags base handle `i` in three moves; returns the rebuilds of each step. */
function dragBaseHandle(i: number) {
  const vp = engine.viewport
  vp.scene.updateMatrixWorld(true)
  const p = vp.baseGroup.children.filter(isHandle)[i].getWorldPosition(new THREE.Vector3()).project(vp.camera)
  const at = new THREE.Vector2(p.x, p.y)
  const press = countRebuilds(vp, () => pointer('pointerdown', at))
  const moves = [1, 2, 3].map((k) =>
    countRebuilds(vp, () => pointer('pointermove', at.clone().add(new THREE.Vector2(0.03 * k, 0)))),
  )
  const release = countRebuilds(vp, () => pointer('pointerup', at))
  return { press, moves, release }
}

const edges = () => ({
  spheres: digestArray(engine.spheres.getEdges()),
  base: digestArray(engine.base.getEdges()),
  tail: digestArray(engine.tail.getEdges()),
  spirals: digestArray(engine.spirals.getEdges()),
})

describe('rebuilds per action', () => {
  test('adding a sphere builds its wire and handle and nothing else', () => {
    expect(countRebuilds(engine.viewport, () => store().addSphere())).toEqual({ ...NONE, sphereGroup: 2 })
  })

  test('each move of a base handle rebuilds the base wire; its handles move', () => {
    const { press, moves, release } = dragBaseHandle(0)
    expect(press).toEqual(NONE)
    expect(moves).toEqual([1, 2, 3].map(() => ({ ...NONE, baseGroup: 1 })))
    expect(release).toEqual(NONE)
  })

  test('undo rebuilds only what the undone step changed', () => {
    store().addSphere()
    history().push(store().preset)
    dragBaseHandle(0) // one undo step
    expect(history().past).toHaveLength(3)

    const vp = engine.viewport
    expect(countRebuilds(vp, () => store().loadPreset(history().undo())), 'undo the drag').toEqual({ ...NONE, baseGroup: 1 })
    expect(countRebuilds(vp, () => store().loadPreset(history().undo())), 'undo the add').toEqual(NONE)
    expect(store().preset.spheres).toHaveLength(3)
    expect(countRebuilds(vp, () => store().loadPreset(history().redo())), 'redo the add').toEqual({ ...NONE, sphereGroup: 2 })
  })

  test('the tail follows a base edit that moves its attachment point, and only such an edit', () => {
    const vp = engine.viewport
    // The default tail is attached at the base's end, control point 3.
    expect(countRebuilds(vp, () => store().setBase({ crossSectionWidth: 0.9 }))).toEqual({ ...NONE, baseGroup: 1 })
    expect(countRebuilds(vp, () => store().updateBasePoint(3, [3, -0.5, 0.2]))).toEqual({ ...NONE, baseGroup: 1, tailGroup: 1 })
    const firstTailHandle = vp.tailGroup.children.filter(isHandle)[0]
    expect(firstTailHandle.position.distanceTo(new THREE.Vector3(3, -0.5, 0.2))).toBeLessThan(1e-9)
  })

  test('a moved sphere keeps its wire geometry, a resized one rebuilds it; spirals rebuild one at a time', () => {
    const vp = engine.viewport
    expect(countRebuilds(vp, () => store().updateSphere('sphere-1', { position: [1.7, 0.3, 0] }))).toEqual(NONE)
    expect(countRebuilds(vp, () => store().updateSphere('sphere-1', { radius: 0.8 }))).toEqual({ ...NONE, sphereGroup: 1 })
    store().addSpiral()
    store().addSpiral()
    const id = store().preset.spirals[1].id
    expect(countRebuilds(vp, () => store().updateSpiral(id, { turns: 3 }))).toEqual({ ...NONE, spiralGroup: 1 })
  })

  test('skipping a rebuild draws the same wireframes as rebuilding everything', () => {
    store().addSphere()
    store().addSpiral()
    store().updateSphere('sphere-1', { position: [1.7, 0.4, 0.1], rotation: [0.3, 0, 0] })
    store().updateBasePoint(1, [-1.1, -0.9, 0.4])
    const incremental = edges()

    // A fresh engine builds everything from the same preset.
    engine.dispose()
    engine = new EditorEngine(mountCanvas(), TEST_ENGINE_OPTIONS)
    expect(edges()).toEqual(incremental)
  })
})
