// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { Viewport } from '../../../src/engine/Viewport'
import { SphereMesh } from '../../../src/engine/views/SphereMesh'
import { BaseMesh } from '../../../src/engine/views/BaseMesh'
import { TailMesh } from '../../../src/engine/views/TailMesh'
import { SpiralMesh } from '../../../src/engine/views/SpiralMesh'
import { FlowCloud } from '../../../src/engine/views/FlowCloud'
import { CutGlueResult } from '../../../src/engine/views/CutGlueResult'
import { createModuleWorker } from '../../../src/engine/workers'
import { useCloudStore } from '../../../src/store/cloudStore'
import { createViewportStub, installFakeWorker, isHandle, regenerateFlowCloud, serializeGroup } from '../../helpers/scene'
import { THICK_SPIRAL, fixture } from '../../fixtures/presets'
import { digestArray } from '../../helpers/digest'
import type { CloudPreset } from '../../../src/model/types'

/**
 * Editor behaviour the goldens do not exercise, found by mutation testing (Stage A
 * net check, 2026-11-07): viewport dragging of every primitive, repeated Regenerate
 * and Cut & Glue runs, visibility-aware edge collection, and Viewport.zoomToFit.
 * Stage C replaces the five drag implementations with one DragController; these
 * tests pin what each does today.
 */

const store = () => useCloudStore.getState()
const disposers: Array<() => void> = []

beforeAll(() => installFakeWorker())
beforeEach(() => store().resetToDefault())
afterEach(() => {
  while (disposers.length > 0) disposers.pop()!()
})

type Vp = ReturnType<typeof createViewportStub>

/** A 100 x 100 canvas with pointer capture stubbed, as in knownBugs.editor.test.tsx. */
function viewport(preset: CloudPreset): Vp {
  store().loadPreset(preset)
  const vp = createViewportStub()
  const canvas = vp.renderer.domElement
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  canvas.setPointerCapture = () => {}
  canvas.releasePointerCapture = () => {}
  vp.camera.updateMatrixWorld()
  return vp
}

function pointer(vp: Vp, type: string, ndc: THREE.Vector2, target: EventTarget = vp.renderer.domElement): void {
  target.dispatchEvent(new PointerEvent(type, { clientX: (ndc.x + 1) * 50, clientY: (1 - ndc.y) * 50, pointerId: 1 }))
}

interface Drag {
  /** World-space displacement the module should apply: plane hit at the end minus the grab point. */
  expectedDelta: THREE.Vector3
  /** Pointer position at the end of the move, for a follow-up event. */
  end: THREE.Vector2
}

/**
 * Presses over `handle`, moves the pointer by `by` (normalized device coordinates) and
 * returns the displacement a camera-facing drag plane through the grab point gives.
 * Pointer up is left to the caller.
 */
function dragHandle(vp: Vp, handle: THREE.Object3D, by = new THREE.Vector2(0.1, 0.05)): Drag {
  vp.scene.updateMatrixWorld(true)
  const world = handle.getWorldPosition(new THREE.Vector3())
  const projected = world.clone().project(vp.camera)
  const start = new THREE.Vector2(projected.x, projected.y)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(start, vp.camera)
  const hit = ray.intersectObject(handle)[0]
  expect(hit, 'the press lands on the handle').toBeDefined()
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    vp.camera.position.clone().sub(hit.point).normalize(),
    hit.point,
  )
  const end = start.clone().add(by)
  ray.setFromCamera(end, vp.camera)
  const planeHit = ray.ray.intersectPlane(plane, new THREE.Vector3())!
  pointer(vp, 'pointerdown', start)
  pointer(vp, 'pointermove', end)
  return { expectedDelta: planeHit.sub(hit.point), end }
}

function expectMovedBy(after: number[], before: number[], delta: THREE.Vector3): void {
  const moved = new THREE.Vector3(...after).sub(new THREE.Vector3(...before))
  expect(moved.distanceTo(delta), `moved ${moved.toArray()} expected ${delta.toArray()}`).toBeLessThan(1e-9)
  expect(delta.length()).toBeGreaterThan(0.1)
}

function expectDragReleased(vp: Vp): void {
  expect(vp.controls.enabled, 'orbit controls re-enabled').toBe(true)
  expect(vp.claimDrag(), 'the drag claim was released').toBe(true)
  vp.releaseDrag()
}

describe('viewport dragging', () => {
  test('SphereMesh: the grabbed sphere follows the pointer on a camera-facing plane', () => {
    const vp = viewport(fixture('default'))
    const m = new SphereMesh(vp)
    disposers.push(() => m.dispose())
    const handle = vp.sphereGroup.children.find((c) => isHandle(c) && c.userData.sphereId === 'sphere-1')!
    const before = [...store().preset.spheres[1].position]
    const { expectedDelta, end } = dragHandle(vp, handle)
    expect(vp.controls.enabled, 'orbit disabled while dragging').toBe(false)
    expectMovedBy(store().preset.spheres[1].position, before, expectedDelta)
    expect(store().preset.spheres[0].position).toEqual([0, 0, 0])
    pointer(vp, 'pointerup', end)
    expectDragReleased(vp)
  })

  test('BaseMesh: dragging a control point moves only that point, and pointer up ends the drag', () => {
    const vp = viewport(fixture('default'))
    const m = new BaseMesh(vp)
    disposers.push(() => m.dispose())
    const handle = vp.baseGroup.children.filter(isHandle)[1]
    const before = structuredClone(store().preset.base.controlPoints)
    const { expectedDelta, end } = dragHandle(vp, handle)
    const after = store().preset.base.controlPoints
    expectMovedBy(after[1], before[1], expectedDelta)
    expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]])
    pointer(vp, 'pointerup', end)
    expectDragReleased(vp)
  })

  test('BaseMesh: a window pointer up (released outside the canvas) also ends the drag', () => {
    const vp = viewport(fixture('default'))
    const m = new BaseMesh(vp)
    disposers.push(() => m.dispose())
    const { end } = dragHandle(vp, vp.baseGroup.children.filter(isHandle)[2])
    pointer(vp, 'pointerup', end, window)
    expectDragReleased(vp)
    const before = structuredClone(store().preset.base.controlPoints)
    pointer(vp, 'pointermove', end.clone().add(new THREE.Vector2(0.2, 0)))
    expect(store().preset.base.controlPoints, 'no drag after release').toEqual(before)
  })

  function tailScene(attach: 'none' | 'end') {
    const p = fixture('default')
    p.tail.attachToBase = attach
    p.tail.attachOffset = 0.5 // mid-base, clear of the base handles
    p.tail.setpoints[0].position = [2.7, -0.2, 0.1] // off base handle P3, which would win the press
    const vp = viewport(p)
    const base = new BaseMesh(vp)
    const tail = new TailMesh(vp)
    disposers.push(() => {
      tail.dispose()
      base.dispose()
    })
    const handles = vp.tailGroup.children.filter(isHandle)
    return { vp, handles }
  }

  test('TailMesh: an unattached first setpoint is draggable', () => {
    const { vp, handles } = tailScene('none')
    const before = [...store().preset.tail.setpoints[0].position]
    const { expectedDelta, end } = dragHandle(vp, handles[0])
    expectMovedBy(store().preset.tail.setpoints[0].position, before, expectedDelta)
    pointer(vp, 'pointerup', end)
    expectDragReleased(vp)
  })

  test('TailMesh: the first setpoint of an attached tail does not move, but the others do', () => {
    const { vp, handles } = tailScene('end')
    const before = structuredClone(store().preset.tail.setpoints)
    const first = dragHandle(vp, handles[0])
    expect(vp.controls.enabled, 'the press still claims the drag').toBe(false)
    expect(store().preset.tail.setpoints).toEqual(before)
    pointer(vp, 'pointerup', first.end)
    expectDragReleased(vp)

    const second = dragHandle(vp, handles[1])
    expectMovedBy(store().preset.tail.setpoints[1].position, before[1].position, second.expectedDelta)
    pointer(vp, 'pointerup', second.end)
  })

  test('SpiralMesh: the grabbed spiral follows the pointer', () => {
    const vp = viewport(fixture('flatSpiral'))
    const m = new SpiralMesh(vp)
    disposers.push(() => m.dispose())
    const handle = vp.spiralGroup.children.find(isHandle)!
    const before = [...store().preset.spirals[0].position]
    const { expectedDelta, end } = dragHandle(vp, handle)
    expectMovedBy(store().preset.spirals[0].position, before, expectedDelta)
    pointer(vp, 'pointerup', end)
    expectDragReleased(vp)
  })

  test('FlowCloud: after Regenerate the handle drags flowCloud.position', async () => {
    const vp = viewport(fixture('default'))
    const fc = new FlowCloud(vp, createModuleWorker('flowCloud'))
    disposers.push(() => fc.dispose())
    await regenerateFlowCloud(fc)
    const handle = vp.flowCloudGroup.children.find(isHandle)!
    expect(handle.visible).toBe(true)
    const before = [...store().preset.flowCloud.position]
    const { expectedDelta, end } = dragHandle(vp, handle)
    expectMovedBy(store().preset.flowCloud.position, before, expectedDelta)
    expect(vp.flowCloudGroup.position.toArray()).toEqual(store().preset.flowCloud.position)
    pointer(vp, 'pointerup', end)
    expectDragReleased(vp)
  })
})

describe('SpiralMesh wireframe variants outside the fixture set', () => {
  // The goldens draw one flat archimedean and one thick golden spiral with rounded corners.
  const variants: Array<[string, Partial<typeof THICK_SPIRAL>]> = [
    ['thick archimedean', { spiralType: 'archimedean' }],
    ['thick, sharp corners', { cornerRadius: 0 }],
    ['thick, taperPower 0', { taperPower: 0 }],
  ]
  for (const [name, edit] of variants) {
    test(name, () => {
      const p = fixture('thickSpiral')
      p.spirals = [{ ...structuredClone(THICK_SPIRAL), ...edit }]
      const vp = viewport(p)
      const m = new SpiralMesh(vp)
      disposers.push(() => m.dispose())
      expect(digestArray(m.getEdges())).toMatchSnapshot()
    })
  }
})

describe('repeated generation', () => {
  test('a second Regenerate replaces the flow-cloud scene instead of adding to it', async () => {
    const vp = viewport(fixture('bands'))
    const fc = new FlowCloud(vp, createModuleWorker('flowCloud'))
    disposers.push(() => fc.dispose())
    await regenerateFlowCloud(fc)
    const once = { group: serializeGroup(vp.flowCloudGroup), edges: fc.getEdges().length }
    await regenerateFlowCloud(fc)
    expect(vp.flowCloudGroup.children).toHaveLength(2) // handle + spiral wireframe group
    expect({ group: serializeGroup(vp.flowCloudGroup), edges: fc.getEdges().length }).toEqual(once)
  })

  test('a second Cut & Glue result replaces the first', () => {
    const vp = createViewportStub()
    const cg = new CutGlueResult(vp)
    disposers.push(() => cg.dispose())
    cg.update(new Float32Array([0, 0, 0, 1, 0, 0]))
    const second = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1])
    cg.update(second)
    expect(vp.cutGlueGroup.children).toHaveLength(1)
    const lines = vp.cutGlueGroup.children[0] as THREE.LineSegments
    expect(lines.geometry.getAttribute('position').array).toBe(second)
    expect(cg.getEdges()).toBe(second)
    cg.update(new Float32Array(0))
    expect(vp.cutGlueGroup.children).toHaveLength(0)
  })
})

describe('FlowCloud.getEdges is visibility-aware', () => {
  test('hiding flow lines (with no bands generated) leaves nothing for Cut & Glue', async () => {
    const vp = viewport(fixture('default'))
    const fc = new FlowCloud(vp, createModuleWorker('flowCloud'))
    disposers.push(() => fc.dispose())
    await regenerateFlowCloud(fc)
    const shown = fc.getEdges().length
    expect(shown).toBeGreaterThan(0)
    const wf = store().preset.flowCloud.wireframe
    store().setFlowCloud({ wireframe: { ...wf, showFlowLines: false } })
    expect(fc.getEdges().length).toBe(0)
    store().setFlowCloud({ wireframe: { ...wf, showFlowLines: true } })
    expect(fc.getEdges().length).toBe(shown)
  })

  test('hiding bands drops exactly the band segments', async () => {
    const vp = viewport(fixture('bands'))
    const fc = new FlowCloud(vp, createModuleWorker('flowCloud'))
    disposers.push(() => fc.dispose())
    await regenerateFlowCloud(fc)
    const all = fc.getEdges().length
    const wf = store().preset.flowCloud.wireframe
    store().setFlowCloud({ wireframe: { ...wf, showFlowLines: false } })
    const bandsOnly = fc.getEdges().length
    store().setFlowCloud({ wireframe: { ...wf, showBands: false } })
    const linesOnly = fc.getEdges().length
    expect(bandsOnly).toBeGreaterThan(0)
    expect(linesOnly).toBeGreaterThan(0)
    expect(bandsOnly + linesOnly).toBe(all)
  })
})

describe('Viewport.zoomToFit', () => {
  /** The fields zoomToFit reads, on a real camera; no WebGL. */
  function fitStub() {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
    const stub = {
      camera,
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      flowCloudGroup: new THREE.Group(),
      sphereGroup: new THREE.Group(),
    }
    const fit = (box?: THREE.Box3) => Viewport.prototype.zoomToFit.call(stub as unknown as Viewport, box)
    return { stub, fit }
  }

  // dist = maxDim / (2 tan(fov / 2)); the camera sits at center + (0, 0.4 dist, 1.4 dist).
  const DIST_PER_UNIT = 1 / (2 * Math.tan((25 * Math.PI) / 180))

  test('frames an explicit box from above and in front of its center', () => {
    const { stub, fit } = fitStub()
    fit(new THREE.Box3(new THREE.Vector3(0, -1, -2), new THREE.Vector3(4, 1, 2)))
    const dist = 4 * DIST_PER_UNIT
    expect(stub.camera.position.x).toBeCloseTo(2, 12)
    expect(stub.camera.position.y).toBeCloseTo(0.4 * dist, 12)
    expect(stub.camera.position.z).toBeCloseTo(1.4 * dist, 12)
    expect(stub.controls.target.toArray()).toEqual([2, 0, 0])
    expect(stub.controls.update).toHaveBeenCalledTimes(1)
  })

  test('with no box it frames the flow-cloud group, hidden children included', () => {
    const { stub, fit } = fitStub()
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25))
    hidden.visible = false
    stub.flowCloudGroup.add(hidden)
    stub.sphereGroup.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4)))
    fit()
    expect(stub.camera.position.z).toBeCloseTo(1.4 * 0.25 * DIST_PER_UNIT, 12)
  })

  test('falls back to the sphere group when the flow-cloud group is empty, and ignores an empty box', () => {
    const { stub, fit } = fitStub()
    stub.sphereGroup.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
    fit()
    expect(stub.camera.position.z).toBeCloseTo(1.4 * 2 * DIST_PER_UNIT, 12)
    const before = stub.camera.position.clone()
    fit(new THREE.Box3())
    expect(stub.camera.position.equals(before)).toBe(true)
    expect(stub.controls.update).toHaveBeenCalledTimes(1)
  })
})
