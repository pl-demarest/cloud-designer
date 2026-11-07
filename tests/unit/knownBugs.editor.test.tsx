// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SpherePanel } from '../../src/components/SpherePanel'
import { BasePanel } from '../../src/components/BasePanel'
import { BaseMesh } from '../../src/three/BaseMesh'
import { TailMesh } from '../../src/three/TailMesh'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { createViewportStub, isHandle } from '../helpers/scene'
import { fixture } from '../fixtures/presets'
import type { CloudPreset } from '../../src/types/cloud'

/**
 * Known editor defects as expected-to-fail tests asserting the correct behaviour,
 * each named after its audit finding id (see knownBugs.workers.test.ts).
 */

const store = () => useCloudStore.getState()
const disposers: Array<() => void> = []

beforeEach(() => {
  store().resetToDefault()
  useHistoryStore.getState().clear()
})

afterEach(() => {
  cleanup()
  while (disposers.length > 0) disposers.pop()!()
})

function baseAndTail(preset: CloudPreset) {
  store().loadPreset(preset)
  const vp = createViewportStub()
  const base = new BaseMesh(vp)
  const tail = new TailMesh(vp, base)
  disposers.push(() => {
    tail.dispose()
    base.dispose()
  })
  return { vp, base, tail }
}

function tailHandlePositions(vp: ReturnType<typeof createViewportStub>): number[][] {
  return vp.tailGroup.children.filter(isHandle).map((h) => h.position.toArray())
}

describe('known editor defects (expected to fail until fixed)', () => {
  it.fails('history-stale-commit: after "+ Add" the newest history snapshot is the post-add preset', () => {
    useHistoryStore.getState().push(store().preset) // App pushes the initial preset on mount
    render(<SpherePanel />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    expect(store().preset.spheres).toHaveLength(4)
    expect(useHistoryStore.getState().past.at(-1)).toEqual(store().preset)
  })

  it.fails('number-input-nan: clearing a base control-point input never stores NaN', () => {
    render(<BasePanel />)
    const input = screen.getAllByRole('spinbutton').find((el) => el.classList.contains('cp-input'))!
    fireEvent.change(input, { target: { value: '' } })
    expect(store().preset.base.controlPoints.flat().some(Number.isNaN)).toBe(false)
  })

  it.fails('tail-not-resynced-on-base-change: an attached tail follows a base control-point edit', () => {
    const { vp } = baseAndTail(fixture('default')) // attachToBase 'end', offset 1.0
    const last = store().preset.base.controlPoints.length - 1
    store().updateBasePoint(last, [3, -0.5, 0.2])
    const first = new THREE.Vector3(...tailHandlePositions(vp)[0])
    expect(first.distanceTo(new THREE.Vector3(3, -0.5, 0.2))).toBeLessThan(1e-9)
  })

  it.fails("attach-start-end-identical: 'start' and 'end' attach the tail at different points", () => {
    const start = fixture('default')
    start.tail.attachToBase = 'start'
    const a = tailHandlePositions(baseAndTail(start).vp)[0]
    const end = fixture('default')
    end.tail.attachToBase = 'end'
    const b = tailHandlePositions(baseAndTail(end).vp)[0]
    expect(a).not.toEqual(b)
  })

  it.fails('base-attach-curve-type-mismatch: getPointAt lies on the drawn (uniform Catmull-Rom) base curve', () => {
    const { base } = baseAndTail(fixture('default'))
    const drawn = new THREE.CatmullRomCurve3(
      store().preset.base.controlPoints.map((p) => new THREE.Vector3(...p)),
      false,
      'catmullrom',
      0.5,
    )
    for (const t of [0.1, 0.25, 0.4]) {
      expect(base.getPointAt(t).distanceTo(drawn.getPointAt(t)), `t=${t}`).toBeLessThan(1e-6)
    }
  })

  it.fails('export-includes-handles: base and tail handles carry the userData.isHandle tag the exporter filters on', () => {
    const { vp } = baseAndTail(fixture('default'))
    const handles = [...vp.baseGroup.children, ...vp.tailGroup.children].filter((c) => c instanceof THREE.Mesh)
    expect(handles.length).toBeGreaterThan(0)
    for (const h of handles) expect(h.userData.isHandle, h.type).toBe(true)
  })

  describe('hidden-handles-raycastable', () => {
    /** Presses the pointer over base handle 1, in a 100 x 100 canvas. */
    function pressOverBaseHandle(visible: boolean): boolean {
      const { vp } = baseAndTail(fixture('default'))
      vp.baseGroup.visible = visible
      const canvas = vp.renderer.domElement
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
      canvas.setPointerCapture = () => {}
      const handle = vp.baseGroup.children.filter(isHandle)[1]
      vp.camera.updateMatrixWorld()
      const ndc = handle.getWorldPosition(new THREE.Vector3()).project(vp.camera)
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: (ndc.x + 1) * 50, clientY: (1 - ndc.y) * 50, pointerId: 1 }),
      )
      return vp.controls.enabled
    }

    it('sanity: pressing over a visible base handle starts a drag (orbit disabled)', () => {
      expect(pressOverBaseHandle(true)).toBe(false)
    })

    it.fails('a hidden base handle (Preview mode) does not start a drag', () => {
      expect(pressOverBaseHandle(false)).toBe(true)
    })
  })
})
