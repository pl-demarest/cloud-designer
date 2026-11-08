// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { importPresetFile } from '../../src/ui/importPreset'
import { NoticeBar } from '../../src/ui/NoticeBar'
import { ViewportArea } from '../../src/ui/ViewportArea'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { useUiStore } from '../../src/store/uiStore'
import { DEFAULT_PRESET } from '../../src/model/defaults'
import { RANGES } from '../../src/model/ranges'
import { SphereMesh } from '../../src/engine/views/SphereMesh'
import { createViewportStub } from '../helpers/scene'
import * as THREE from 'three'

/** Import JSON: one undo step, a notice for the outcome, and the viewport as a drop target. */

const store = () => useCloudStore.getState()
const history = () => useHistoryStore.getState()

function presetFile(name: string, edit: (p: typeof DEFAULT_PRESET) => void = () => {}): File {
  const p = structuredClone(DEFAULT_PRESET)
  edit(p)
  return new File([JSON.stringify(p)], name, { type: 'application/json' })
}

const fourSpheres = (p: typeof DEFAULT_PRESET) => {
  p.name = 'Storm'
  p.spheres.push({ ...p.spheres[0], id: 'sphere-3', position: [3, 0, 0] })
}

beforeEach(() => {
  store().resetToDefault()
  history().clear()
  store().commit()
  useUiStore.setState(useUiStore.getInitialState())
})
afterEach(() => cleanup())

describe('importPresetFile', () => {
  test('loads the preset as one undo step and says so', async () => {
    await importPresetFile(presetFile('storm.json', fourSpheres))
    expect(store().preset.name).toBe('Storm')
    expect(store().preset.spheres).toHaveLength(4)
    expect(history().past).toHaveLength(2)
    expect(useUiStore.getState().notice).toEqual({ tone: 'info', text: 'Imported storm.json.' })
    store().undo()
    expect(store().preset).toEqual(DEFAULT_PRESET)
  })

  test('a file that is not a preset changes nothing and the notice says why', async () => {
    await importPresetFile(new File(['not json'], 'notes.txt'))
    expect(store().preset).toEqual(DEFAULT_PRESET)
    expect(history().past).toHaveLength(1)
    expect(useUiStore.getState().notice).toEqual({ tone: 'error', text: 'Could not import notes.txt: it is not valid JSON.' })
  })

  test('an edit not yet committed before the import stays its own undo step', async () => {
    store().setBase({ closed: true })
    await importPresetFile(presetFile('storm.json', fourSpheres))
    store().undo()
    expect(store().preset.base.closed, 'back to the edit, not past it').toBe(true)
    expect(store().preset.spheres).toHaveLength(3)
  })
})

describe('a file with values outside the editor\'s ranges (C4 F7, plan decision D11)', () => {
  const F7 = '{"spheres":[{"position":[1e308,-1e308,0],"radius":1e308}],"surfaceMeshResolution":1e9}'

  test('imports clamped, with finite bounds and no console error, and the notice counts the clamped values', async () => {
    const errors = vi.spyOn(console, 'error')
    const mesh = new SphereMesh(createViewportStub())
    try {
      await importPresetFile(new File([F7], 'huge.json', { type: 'application/json' }))
      const sphere = store().preset.spheres[0]
      expect(sphere.position).toEqual([RANGES.sphere.position[0].max, RANGES.sphere.position[1].min, 0])
      expect(sphere.radius).toBe(RANGES.sphere.radius.max)
      expect(store().preset.surfaceMeshResolution).toBe(256)
      expect(useUiStore.getState().notice).toEqual({
        tone: 'info',
        text: "Imported huge.json. 4 values were outside the editor's ranges and clamped to them.",
      })
      // The sphere's wire, as the renderer and the raycaster bound it.
      const wire = mesh.getEdgesGrouped()
      expect(wire).toHaveLength(1)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(wire[0].edges, 3))
      geometry.computeBoundingSphere()
      expect(Number.isFinite(geometry.boundingSphere!.radius), 'finite bounds').toBe(true)
      expect(errors, 'no console error').not.toHaveBeenCalled()
    } finally {
      mesh.dispose()
      errors.mockRestore()
    }
  })

  test('a file inside every range says nothing about clamping', async () => {
    await importPresetFile(presetFile('fine.json'))
    expect(useUiStore.getState().notice?.text).toBe('Imported fine.json.')
  })

  test('one value outside its range: the notice says one value', async () => {
    await importPresetFile(presetFile('one.json', (p) => { p.base.crossSectionWidth = 9 }))
    expect(useUiStore.getState().notice?.text).toBe("Imported one.json. 1 value was outside the editor's ranges and clamped to them.")
  })
})

describe('a file with a repeated sphere id (cd:explore CDX-02)', () => {
  test('every sphere is drawn and exported, an edit changes one, and Remove removes one', async () => {
    const mesh = new SphereMesh(createViewportStub())
    try {
      // The default preset with sphere 2 copied by hand: ids [sphere-0, sphere-1, sphere-2, sphere-1].
      await importPresetFile(presetFile('copied.json', (p) => { p.spheres.push({ ...p.spheres[1], position: [0, 2, 0] }) }))
      expect(store().preset.spheres).toHaveLength(4)
      expect(mesh.getEdgesGrouped(), 'one wire per sphere').toHaveLength(4)
      const [, second, , fourth] = store().preset.spheres
      store().updateSphere(fourth.id, { radius: 3 })
      expect(store().preset.spheres.map((s) => s.radius)).toEqual([1.2, 1, 0.9, 3])
      store().removeSphere(fourth.id)
      expect(store().preset.spheres.map((s) => s.id)).toEqual(['sphere-0', second.id, 'sphere-2'])
    } finally {
      mesh.dispose()
    }
  })
})

describe('NoticeBar', () => {
  test('shows the notice, an error as an alert, and dismisses it', () => {
    render(<NoticeBar />)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => useUiStore.getState().showNotice({ tone: 'error', text: 'Could not import x.json: it is not valid JSON.' }))
    expect(screen.getByRole('alert').textContent).toContain('it is not valid JSON.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useUiStore.getState().notice).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test("a notice's action button runs its action", () => {
    let runs = 0
    render(<NoticeBar />)
    act(() => useUiStore.getState().showNotice({ tone: 'info', text: 'Restored.', action: { label: 'Discard', run: () => runs++ } }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(runs).toBe(1)
  })
})

describe('ViewportArea', () => {
  test('a JSON file dropped on the viewport is imported; the frame is outlined while dragged over', async () => {
    const { container } = render(<ViewportArea><canvas /></ViewportArea>)
    const area = container.querySelector('.viewport-wrap')!
    const file = presetFile('dropped.json', fourSpheres)
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    fireEvent.dragOver(area, { dataTransfer })
    expect(area.className).toBe('viewport-wrap drop-target')
    fireEvent.drop(area, { dataTransfer })
    expect(area.className).toBe('viewport-wrap')
    await waitFor(() => expect(store().preset.spheres).toHaveLength(4))
    expect(useUiStore.getState().notice?.text).toBe('Imported dropped.json.')
  })

  test('a drag without files (text, a link) is not taken', () => {
    const { container } = render(<ViewportArea><canvas /></ViewportArea>)
    const area = container.querySelector('.viewport-wrap')!
    const over = fireEvent.dragOver(area, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(over, 'default not prevented').toBe(true)
    expect(area.className).toBe('viewport-wrap')
  })
})
