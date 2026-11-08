// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { useUiStore } from '../../src/store/uiStore'
import { installFakeWorker, isHandle } from '../helpers/scene'
import { TEST_ENGINE_OPTIONS, installCanvas2dStub, mountCanvas } from '../helpers/engine'
import { RANGES } from '../../src/model/ranges'
import { parsePresetJson } from '../../src/model/presetFile'

/**
 * Dragging in the assembled editor (every view, as EditorEngine registers them), on a 100 x 100
 * canvas: the nearest handle under the pointer wins, hidden handles are not grabbed, a cancelled
 * pointer ends the drag, and a drag that moved something is one undo step.
 */

const store = () => useCloudStore.getState()
const history = () => useHistoryStore.getState()

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
})

afterEach(() => engine.dispose())

/** The pointer position (normalized device coordinates) over `obj`'s centre. */
function over(obj: THREE.Object3D): THREE.Vector2 {
  engine.viewport.scene.updateMatrixWorld(true)
  engine.viewport.camera.updateMatrixWorld()
  const p = obj.getWorldPosition(new THREE.Vector3()).project(engine.viewport.camera)
  return new THREE.Vector2(p.x, p.y)
}

function pointer(type: string, ndc: THREE.Vector2, target: EventTarget = canvas, button = 0): void {
  target.dispatchEvent(new PointerEvent(type, { clientX: (ndc.x + 1) * 50, clientY: (1 - ndc.y) * 50, pointerId: 1, button }))
}

const orbitEnabled = () => engine.viewport.controls.enabled
const baseHandles = () => engine.viewport.baseGroup.children.filter(isHandle)
const sphereHandle = (id: string) => engine.viewport.sphereGroup.children.find((c) => isHandle(c) && c.userData.sphereId === id)!

describe('picking', () => {
  test('drag-arbitration-first-listener: the nearest handle under the pointer wins, not the first view registered', () => {
    // Put sphere 2's handle on the camera ray through base point 1, behind it.
    const cp = new THREE.Vector3(...store().preset.base.controlPoints[1])
    const behind = cp.clone().add(cp.clone().sub(engine.viewport.camera.position).multiplyScalar(0.3))
    store().updateSphere('sphere-2', { position: [behind.x, behind.y, behind.z] })
    const before = structuredClone(store().preset)

    const at = over(baseHandles()[1])
    expect(over(sphereHandle('sphere-2')).distanceTo(at), 'the two handles overlap on screen').toBeLessThan(1e-9)
    pointer('pointerdown', at)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0)))
    pointer('pointerup', at)

    expect(store().preset.spheres[2].position, 'the farther sphere handle did not move').toEqual(before.spheres[2].position)
    expect(store().preset.base.controlPoints[1], 'the nearer base handle moved').not.toEqual(before.base.controlPoints[1])
  })

  describe('the flow-cloud handle yields to any other handle under the pointer', () => {
    // On the default preset sphere 1 (sphere-0) sits at the origin, the flow cloud's position.
    // After a Regenerate the flow-cloud handle, a 0.25 box, encloses the sphere's 0.18 box.
    beforeEach(async () => {
      expect((await engine.regenerate()).status).toBe('done')
    })

    /** The pointer position over the world point (x, y, z). */
    function overPoint(x: number, y: number, z: number): THREE.Vector2 {
      engine.viewport.scene.updateMatrixWorld(true) // as a rendered frame does, for the raycast
      engine.viewport.camera.updateMatrixWorld()
      const p = new THREE.Vector3(x, y, z).project(engine.viewport.camera)
      return new THREE.Vector2(p.x, p.y)
    }

    test("a press on sphere 1's handle drags sphere 1, not the flow cloud", () => {
      const at = over(sphereHandle('sphere-0'))
      pointer('pointerdown', at)
      pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0.05)))
      pointer('pointerup', at)
      expect(store().preset.flowCloud.position, 'the flow cloud stays').toEqual([0, 0, 0])
      expect(store().preset.spheres[0].position, 'sphere 1 moves').not.toEqual([0, 0, 0])
    })

    test('a press on the flow-cloud handle where no other handle is under the pointer drags the flow cloud', () => {
      // Inside the flow-cloud box's front-top-right corner, beside the sphere's smaller box.
      const at = overPoint(0.115, 0.115, 0.12)
      pointer('pointerdown', at)
      pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0.05)))
      pointer('pointerup', at)
      expect(store().preset.spheres[0].position, 'sphere 1 stays').toEqual([0, 0, 0])
      expect(store().preset.flowCloud.position, 'the flow cloud moves').not.toEqual([0, 0, 0])
    })
  })

  test('gizmo-hidden-still-draggable: in Preview the hidden F anchor is not grabbed', () => {
    const front = engine.viewport.gizmoGroup.children.find((c) => c.userData.which === 'front')!
    const at = over(front)
    useUiStore.getState().setMode('preview')
    const before = structuredClone(store().preset.flowCloud.wireframe.frontPoint)
    pointer('pointerdown', at)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0.05)))
    expect(store().preset.flowCloud.wireframe.frontPoint).toEqual(before)
    expect(orbitEnabled(), 'the press orbits').toBe(true)
    pointer('pointerup', at)
  })

  test('in Preview the hidden spiral handles are not grabbed', () => {
    store().addSpiral()
    const handle = engine.viewport.spiralGroup.children.find(isHandle)!
    const at = over(handle)
    useUiStore.getState().setMode('preview')
    const before = structuredClone(store().preset.spirals[0].position)
    pointer('pointerdown', at)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0.05)))
    expect(store().preset.spirals[0].position).toEqual(before)
    expect(orbitEnabled()).toBe(true)
    pointer('pointerup', at)
  })
})

describe('a drag stays inside the range table (plan decision D11)', () => {
  test('outofrange: a sphere dragged far to the right stops at Pos X 8, and Export JSON then Import gives the same preset', () => {
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    for (let i = 1; i <= 12; i++) pointer('pointermove', at.clone().add(new THREE.Vector2(0.15 * i, 0)))
    pointer('pointerup', at)
    const x = store().preset.spheres[1].position[0]
    expect(x, 'the drag reached the end of the range').toBe(RANGES.sphere.position[0].max)
    const exported = JSON.stringify(store().preset, null, 2)
    expect(parsePresetJson(exported)).toEqual(store().preset)
  })

  test('the flow-cloud handle stops at Position 20, a base handle at 50', async () => {
    expect((await engine.regenerate()).status).toBe('done')
    store().updateSphere('sphere-0', { position: [0, 2, 0] }) // off the flow-cloud handle
    // From 200 units away, a drag plane faces the camera along z, and the pointer reaches x = 50.
    const { camera } = engine.viewport
    camera.position.set(0, 4, 200)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const fcAt = over(engine.viewport.flowCloudGroup.children.find(isHandle)!)
    pointer('pointerdown', fcAt)
    pointer('pointermove', fcAt.clone().add(new THREE.Vector2(0.5, 0)))
    pointer('pointerup', fcAt)
    expect(store().preset.flowCloud.position[0]).toBe(RANGES.flowCloud.position.max)
    // Base point P3; the flow-cloud handle no longer covers it.
    const at = over(baseHandles()[3])
    pointer('pointerdown', at)
    pointer('pointermove', at.clone().add(new THREE.Vector2(1, 0)))
    pointer('pointerup', at)
    expect(store().preset.base.controlPoints[3][0]).toBe(RANGES.base.controlPoint.max)
  })
})

describe('only the primary button drags', () => {
  for (const button of [2, 1]) {
    test(`a press of button ${button} on a handle starts nothing: the orbit controls keep it`, () => {
      history().push(store().preset)
      const before = structuredClone(store().preset)
      const at = over(sphereHandle('sphere-1'))
      pointer('pointerdown', at, canvas, button)
      expect(orbitEnabled(), 'the press goes to the orbit controls').toBe(true)
      expect(store().gestureActive, 'no gesture').toBe(false)
      pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0)))
      pointer('pointerup', at, canvas, button)
      expect(store().preset).toEqual(before)
      expect(history().past).toHaveLength(1)
    })
  }
})

describe('ending a drag', () => {
  test("another pointer's release does not end the drag (cd:review CDR-16)", () => {
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: 10, clientY: 10 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: 10, clientY: 10 }))
    expect(orbitEnabled(), 'still dragging').toBe(false)
    const before = structuredClone(store().preset.spheres[1].position)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0)))
    expect(store().preset.spheres[1].position, 'the drag still moves the sphere').not.toEqual(before)
    pointer('pointerup', at)
    expect(orbitEnabled()).toBe(true)
  })

  test('a window blur ends the drag: one undo step, the controls back, and later moves drag nothing', () => {
    history().push(store().preset)
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0)))
    window.dispatchEvent(new Event('blur'))
    expect(orbitEnabled(), 'orbit re-enabled').toBe(true)
    expect(store().gestureActive, 'the gesture ended').toBe(false)
    expect(history().past, 'the drag is one step').toHaveLength(2)
    const after = structuredClone(store().preset.spheres[1].position)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.2, 0)))
    expect(store().preset.spheres[1].position).toEqual(after)
  })

  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    test(`no-pointercancel: ${type} ends the drag and re-enables the orbit controls`, () => {
      const at = over(sphereHandle('sphere-1'))
      pointer('pointerdown', at)
      pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0)))
      expect(orbitEnabled()).toBe(false)
      pointer(type, at)
      expect(orbitEnabled(), 'orbit re-enabled').toBe(true)
      const after = structuredClone(store().preset.spheres[1].position)
      pointer('pointermove', at.clone().add(new THREE.Vector2(0.2, 0)))
      expect(store().preset.spheres[1].position, 'no drag after the cancel').toEqual(after)
    })
  }
})

describe('history', () => {
  test('drags-not-in-history: a viewport drag is one undo step', () => {
    history().push(store().preset) // App pushes the opening preset
    const before = structuredClone(store().preset)
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    for (let i = 1; i <= 3; i++) pointer('pointermove', at.clone().add(new THREE.Vector2(0.05 * i, 0)))
    pointer('pointerup', at)
    const dragged = structuredClone(store().preset)
    expect(dragged.spheres[1].position).not.toEqual(before.spheres[1].position)

    expect(history().past, 'one entry for the whole drag').toHaveLength(2)
    expect(history().past[1]).toEqual(dragged)
    store().loadPreset(history().undo())
    expect(store().preset.spheres[1].position).toEqual(before.spheres[1].position)
  })

  test('a drag is one history gesture: commits during it wait for its end', () => {
    history().push(store().preset)
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    expect(store().gestureActive, 'the press opens a gesture').toBe(true)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.05, 0)))
    store().commit() // a panel or key commit while the drag runs
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.1, 0)))
    expect(history().past, 'nothing recorded mid-drag').toHaveLength(1)
    pointer('pointerup', at)
    expect(store().gestureActive).toBe(false)
    expect(history().past).toHaveLength(2)
    expect(history().past[1]).toEqual(store().preset)
  })

  test('a press on a handle takes the focus before the gesture opens: the field it leaves records its own step', () => {
    history().push(store().preset)
    // A field that records its edit when it loses focus, as a number field and the name do.
    const field = document.createElement('input')
    field.addEventListener('blur', () => {
      store().setPresetName('Storm')
      store().commit()
    })
    document.body.append(field)
    field.focus()
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    pointer('pointermove', at.clone().add(new THREE.Vector2(0.05, 0)))
    pointer('pointerup', at)
    field.remove()
    const steps = history().past.map((p) => [p.name, p.spheres[1].position[0]])
    expect(steps, 'the opening preset, the rename, then the drag').toEqual([
      ['Default Cloud', 1.6],
      ['Storm', 1.6],
      ['Storm', store().preset.spheres[1].position[0]],
    ])
    expect(store().preset.spheres[1].position[0]).not.toBe(1.6)
  })

  test('a press and release without moving adds no undo step', () => {
    history().push(store().preset)
    const at = over(sphereHandle('sphere-1'))
    pointer('pointerdown', at)
    expect(orbitEnabled(), 'the press holds the handle').toBe(false)
    pointer('pointerup', at)
    expect(history().past).toHaveLength(1)
  })
})
