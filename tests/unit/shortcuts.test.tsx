// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { historyShortcut, isEditableTarget } from '../../src/ui/shortcuts'
import { useHistoryShortcuts } from '../../src/ui/hooks/useHistoryShortcuts'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'

/**
 * The undo and redo keys: one window handler, case-insensitive keys, Ctrl or Cmd, and no effect
 * while focus is in a text field, whose own undo the keys belong to.
 */

const store = () => useCloudStore.getState()
const sphereCount = () => store().preset.spheres.length

type Keys = Partial<Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>>

function key(init: Keys) {
  return { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }
}

describe('historyShortcut', () => {
  const cases: Array<[string, Keys, 'undo' | 'redo' | null]> = [
    ['Ctrl+Z', { key: 'z', ctrlKey: true }, 'undo'],
    ['Cmd+Z', { key: 'z', metaKey: true }, 'undo'],
    ['Ctrl+Shift+Z (e.key is "Z")', { key: 'Z', ctrlKey: true, shiftKey: true }, 'redo'],
    ['Cmd+Shift+Z', { key: 'Z', metaKey: true, shiftKey: true }, 'redo'],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }, 'redo'],
    ['Cmd+Y', { key: 'y', metaKey: true }, 'redo'],
    ['Ctrl+Z with Caps Lock (e.key is "Z", no Shift)', { key: 'Z', ctrlKey: true }, 'undo'],
    ['Ctrl+Y with Caps Lock', { key: 'Y', ctrlKey: true }, 'redo'],
    ['a non-Latin layout: Ctrl and the Z key ("я")', { key: 'я', code: 'KeyZ', ctrlKey: true }, 'undo'],
    ['Z without Ctrl or Cmd', { key: 'z' }, null],
    ['Ctrl+Alt+Z (AltGr on some layouts)', { key: 'z', ctrlKey: true, altKey: true }, null],
    ['Ctrl+Shift+Y', { key: 'Y', ctrlKey: true, shiftKey: true }, null],
    ['Ctrl+X', { key: 'x', ctrlKey: true }, null],
  ]
  for (const [name, init, expected] of cases) {
    test(name, () => expect(historyShortcut(key(init))).toBe(expected))
  }
})

describe('isEditableTarget', () => {
  function input(type: string): HTMLInputElement {
    const el = document.createElement('input')
    el.type = type
    return el
  }

  test('text entry: text and number inputs, textarea, select, contenteditable', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inside = document.createElement('span')
    editable.append(inside)
    document.body.append(editable)
    for (const el of [input('text'), input('number'), input('search'), document.createElement('textarea'), document.createElement('select'), editable, inside]) {
      expect(isEditableTarget(el), el.outerHTML).toBe(true)
    }
    editable.remove()
  })

  test('not text entry: range, checkbox, button, the page, nothing', () => {
    for (const el of [input('range'), input('checkbox'), document.createElement('button'), document.body, window, null]) {
      expect(isEditableTarget(el)).toBe(false)
    }
  })
})

describe('useHistoryShortcuts', () => {
  function Harness() {
    useHistoryShortcuts()
    return <input aria-label="name" />
  }

  beforeEach(() => {
    store().resetToDefault()
    useHistoryStore.getState().clear()
    store().commit()
    store().addSphere()
    store().commit()
  })
  afterEach(() => cleanup())

  function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(e)
    return e
  }

  test('Ctrl+Z undoes and Ctrl+Shift+Z redoes, from anywhere but a text field', () => {
    render(<Harness />)
    const undo = press(document.body, { key: 'z', ctrlKey: true })
    expect(sphereCount()).toBe(3)
    expect(undo.defaultPrevented).toBe(true)
    press(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(sphereCount()).toBe(4)
  })

  test('in a text field the keys are left to the field', () => {
    const { getByLabelText } = render(<Harness />)
    const e = press(getByLabelText('name'), { key: 'z', ctrlKey: true })
    expect(sphereCount()).toBe(4)
    expect(e.defaultPrevented).toBe(false)
  })

  test('one listener: a remount does not double the undo', () => {
    const first = render(<Harness />)
    first.unmount()
    render(<Harness />)
    store().setBase({ closed: true })
    store().commit()
    press(document.body, { key: 'z', ctrlKey: true })
    expect(store().preset.base.closed).toBe(false)
    expect(sphereCount(), 'one step, not two').toBe(4)
  })
})
