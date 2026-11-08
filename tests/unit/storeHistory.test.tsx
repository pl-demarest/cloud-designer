// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Toolbar } from '../../src/components/Toolbar'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'

/**
 * The history actions of cloudStore: commit() records the preset as it is when it runs and skips
 * a snapshot equal to the newest one; a gesture (beginGesture to endGesture) is one undo step;
 * undo() and redo() apply the snapshot, so the toolbar and the keyboard share one path. The
 * snapshot stack itself is pinned in historyStore.test.ts.
 */

const store = () => useCloudStore.getState()
const history = () => useHistoryStore.getState()
const sphereCount = () => store().preset.spheres.length

beforeEach(() => {
  store().resetToDefault()
  useCloudStore.setState({ gestureActive: false })
  history().clear()
  store().commit() // the opening entry, as App commits it on mount
})

afterEach(() => cleanup())

describe('commit', () => {
  test('records the preset as it is when commit runs', () => {
    store().addSphere()
    store().commit()
    expect(history().past).toHaveLength(2)
    expect(history().past[1]).toEqual(store().preset)
    expect(history().past[1].spheres).toHaveLength(4)
  })

  test('skips a snapshot equal to the newest one', () => {
    store().commit()
    expect(history().past).toHaveLength(1)
    store().setBase({ crossSectionWidth: 2 })
    store().setBase({ crossSectionWidth: 1.2 }) // back to the committed value
    store().commit()
    expect(history().past).toHaveLength(1)
  })

  test('into an empty history it records the current preset', () => {
    history().clear()
    store().commit()
    expect(history().past).toHaveLength(1)
    expect(history().canUndo()).toBe(false)
  })
})

describe('gestures', () => {
  test('the edits between beginGesture and endGesture are one undo step', () => {
    store().beginGesture()
    for (const radius of [1.3, 1.4, 1.5]) {
      store().updateSphere('sphere-0', { radius })
      store().commit() // a keyup or a change event during the gesture
    }
    expect(history().past, 'nothing recorded while the gesture runs').toHaveLength(1)
    store().endGesture()
    expect(history().past).toHaveLength(2)
    expect(history().past[1].spheres[0].radius).toBe(1.5)
    expect(store().gestureActive).toBe(false)
  })

  test('a gesture that changed nothing adds no step', () => {
    store().beginGesture()
    store().endGesture()
    expect(history().past).toHaveLength(1)
  })

  test('undo during a gesture ends it, then undoes it', () => {
    store().beginGesture()
    store().updateSphere('sphere-0', { radius: 2 })
    store().undo()
    expect(store().gestureActive).toBe(false)
    expect(store().preset.spheres[0].radius).toBe(1.2)
    expect(history().canRedo()).toBe(true)
  })
})

describe('undo and redo', () => {
  test('apply the previous and the next snapshot', () => {
    store().addSphere()
    store().commit()
    store().undo()
    expect(sphereCount()).toBe(3)
    expect(history().canUndo()).toBe(false)
    store().redo()
    expect(sphereCount()).toBe(4)
    expect(history().canRedo()).toBe(false)
  })

  test('with nothing to undo or redo the preset stays as it is', () => {
    const before = store().preset
    store().undo()
    store().redo()
    expect(store().preset).toBe(before)
  })

  test('undo records an edit not yet committed, then steps back over it only', () => {
    store().addSphere()
    store().commit()
    store().setBase({ closed: true }) // no commit yet
    store().undo()
    expect(store().preset.base.closed).toBe(false)
    expect(sphereCount(), 'the committed add stays').toBe(4)
    store().redo()
    expect(store().preset.base.closed).toBe(true)
  })

  test('an edit after undo clears the redo stack, so redo keeps it', () => {
    store().addSphere()
    store().commit()
    store().undo()
    store().setBase({ closed: true })
    store().redo()
    expect(store().preset.base.closed).toBe(true)
    expect(sphereCount()).toBe(3)
    expect(history().canRedo()).toBe(false)
  })
})

describe('Toolbar', () => {
  function renderToolbar() {
    const noop = () => {}
    render(
      <Toolbar
        mode="edit"
        onModeChange={noop}
        showAxes
        onToggleAxes={noop}
        showGrid
        onToggleGrid={noop}
        onZoomFit={noop}
      />,
    )
  }

  test('Undo and Redo run the store actions', () => {
    renderToolbar()
    const undo = screen.getByRole('button', { name: 'Undo' })
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(undo).toHaveProperty('disabled', true)

    act(() => {
      store().addSphere()
      store().commit()
    })
    expect(undo).toHaveProperty('disabled', false)
    fireEvent.click(undo)
    expect(sphereCount()).toBe(3)
    expect(redo).toHaveProperty('disabled', false)
    fireEvent.click(redo)
    expect(sphereCount()).toBe(4)
    expect(undo).toHaveProperty('disabled', false)
  })
})
