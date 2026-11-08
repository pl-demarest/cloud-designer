// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { BasePanel } from '../../src/ui/panels/BasePanel'
import { TailPanel } from '../../src/ui/panels/TailPanel'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'

/**
 * The panel controls make each edit one undo step. happy-dom has no native range stepping, so a
 * slider step is simulated by the events a browser sends for it: input (React's onChange), then
 * change, between the pointer or key events.
 */

const store = () => useCloudStore.getState()
const history = () => useHistoryStore.getState()

beforeEach(() => {
  store().resetToDefault()
  useCloudStore.setState({ gestureActive: false })
  history().clear()
  store().commit() // the opening entry
})

afterEach(() => cleanup())

/** One value change of a range input, as a browser reports it: input, then change. */
function step(input: HTMLInputElement, value: string): void {
  fireEvent.input(input, { target: { value } })
  fireEvent.change(input)
}

/** The range input of the SliderRow labelled `label`. */
function slider(container: HTMLElement, label: string): HTMLInputElement {
  const row = Array.from(container.querySelectorAll('.slider-row')).find(
    (r) => r.querySelector('label')?.textContent === label,
  )
  return row!.querySelector('input[type=range]')!
}

describe('SliderRow', () => {
  test('slider-commit-events: a keyboard step is one undo step', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    fireEvent.keyDown(width, { key: 'ArrowRight' })
    step(width, '1.25')
    fireEvent.keyUp(width, { key: 'ArrowRight' })
    expect(history().past).toHaveLength(2)
    expect(history().past[1].base.crossSectionWidth).toBe(1.25)
    store().undo()
    expect(store().preset.base.crossSectionWidth).toBe(1.2)
  })

  test('a held key (repeated keydown) is one undo step', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    fireEvent.keyDown(width, { key: 'ArrowRight' })
    step(width, '1.25')
    for (const value of ['1.3', '1.35']) {
      fireEvent.keyDown(width, { key: 'ArrowRight', repeat: true })
      step(width, value)
    }
    expect(history().past, 'nothing recorded while the key is held').toHaveLength(1)
    fireEvent.keyUp(width, { key: 'ArrowRight' })
    expect(history().past).toHaveLength(2)
    expect(history().past[1].base.crossSectionWidth).toBe(1.35)
  })

  test('a change without key or pointer events (assistive technology) is one undo step', () => {
    const { container } = render(<BasePanel />)
    step(slider(container, 'Height'), '0.5')
    expect(history().past).toHaveLength(2)
    expect(history().past[1].base.crossSectionHeight).toBe(0.5)
  })

  test('a pointer drag is one undo step, committed at the release', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    fireEvent.pointerDown(width, { pointerId: 1 })
    for (const value of ['1.5', '1.8', '2.1']) step(width, value)
    expect(history().past, 'nothing recorded mid-drag').toHaveLength(1)
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(history().past).toHaveLength(2)
    expect(history().past[1].base.crossSectionWidth).toBe(2.1)
  })

  test('a press and release without a change records nothing', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    fireEvent.pointerDown(width, { pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    fireEvent.keyDown(width, { key: 'ArrowLeft' })
    fireEvent.keyUp(width, { key: 'ArrowLeft' })
    expect(history().past).toHaveLength(1)
    expect(store().gestureActive).toBe(false)
  })

  test('a cancelled pointer ends the gesture and commits what changed', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    fireEvent.pointerDown(width, { pointerId: 1 })
    step(width, '1.6')
    fireEvent.pointerCancel(window, { pointerId: 1 })
    expect(store().gestureActive).toBe(false)
    expect(history().past).toHaveLength(2)
  })
})

describe('whole-number sliders', () => {
  test('segment counts round explicitly: a fractional value stores the nearest whole number', () => {
    const base = render(<BasePanel />)
    step(slider(base.container, 'Ring Density'), '12.6')
    step(slider(base.container, 'Length Density'), '20.4')
    base.unmount()
    const tail = render(<TailPanel />)
    step(slider(tail.container, 'Radial Density'), '7.5')
    step(slider(tail.container, 'Length Density'), '40.49')
    const { base: b, tail: t } = store().preset
    expect([b.ringSegments, b.lengthSegments, t.radialSegments, t.lengthSegments]).toEqual([13, 20, 8, 40])
  })
})

describe('NumberField', () => {
  /** Base control point `point`'s input for `axis` (0 = X). */
  function pointInput(container: HTMLElement, point: number, axis: number): HTMLInputElement {
    return container.querySelectorAll('.control-point-row')[point].querySelectorAll<HTMLInputElement>('input')[axis]
  }

  test('typing edits a draft; blur parses it and commits one undo step', () => {
    const { container } = render(<BasePanel />)
    const x = pointInput(container, 0, 0)
    fireEvent.change(x, { target: { value: '-2' } })
    fireEvent.change(x, { target: { value: '-2.25' } })
    expect(store().preset.base.controlPoints[0][0], 'the preset waits for blur or Enter').toBe(-2.5)
    fireEvent.blur(x)
    expect(store().preset.base.controlPoints[0][0]).toBe(-2.25)
    expect(history().past).toHaveLength(2)
    expect(x.value).toBe('-2.25')
  })

  test('Enter applies the draft; Escape drops it', () => {
    const { container } = render(<BasePanel />)
    const y = pointInput(container, 1, 1)
    fireEvent.change(y, { target: { value: '0.5' } })
    fireEvent.keyDown(y, { key: 'Enter' })
    expect(store().preset.base.controlPoints[1][1]).toBe(0.5)
    fireEvent.change(y, { target: { value: '3' } })
    fireEvent.keyDown(y, { key: 'Escape' })
    expect(y.value).toBe('0.50')
    fireEvent.blur(y)
    expect(store().preset.base.controlPoints[1][1]).toBe(0.5)
    expect(history().past).toHaveLength(2)
  })

  test('an empty or non-numeric entry is rejected and the field shows the preset value again', () => {
    const { container } = render(<BasePanel />)
    const z = pointInput(container, 2, 2)
    for (const entry of ['', ' ', 'abc', '-']) {
      fireEvent.change(z, { target: { value: entry } })
      fireEvent.blur(z)
      expect(store().preset.base.controlPoints[2][2], JSON.stringify(entry)).toBe(-0.3)
      expect(z.value).toBe('-0.30')
    }
    expect(history().past).toHaveLength(1)
  })

  test('a typed value is clamped to the field range (tail width 0.05 to 1.5)', () => {
    const { container } = render(<TailPanel />)
    const width = container.querySelectorAll('.setpoint-row')[1].querySelectorAll<HTMLInputElement>('input')[3]
    fireEvent.change(width, { target: { value: '5' } })
    fireEvent.blur(width)
    expect(store().preset.tail.setpoints[1].width).toBe(1.5)
    fireEvent.change(width, { target: { value: '-1' } })
    fireEvent.blur(width)
    expect(store().preset.tail.setpoints[1].width).toBe(0.05)
  })

  test('re-entering the value the field holds records nothing', () => {
    const { container } = render(<BasePanel />)
    const x = pointInput(container, 3, 0)
    fireEvent.change(x, { target: { value: '2.5' } })
    fireEvent.blur(x)
    fireEvent.blur(x)
    expect(history().past).toHaveLength(1)
  })
})
