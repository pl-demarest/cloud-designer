// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BasePanel } from '../../src/ui/panels/BasePanel'
import { TailPanel } from '../../src/ui/panels/TailPanel'
import { FlowCloudPanel } from '../../src/ui/panels/FlowCloudPanel'
import { SpherePanel } from '../../src/ui/panels/SpherePanel'
import { SpiralPanel } from '../../src/ui/panels/SpiralPanel'
import { formatPi } from '../../src/ui/controls/format'
import { parsePresetJson } from '../../src/model/presetFile'
import { Accordion } from '../../src/ui/controls/Accordion'
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

  test('leaving a slider while a step key is held ends its gesture (cd:review CDR-16)', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    fireEvent.keyDown(width, { key: 'ArrowRight' })
    step(width, '1.25')
    expect(store().gestureActive).toBe(true)
    fireEvent.blur(width)
    expect(store().gestureActive, 'the blur ended it').toBe(false)
    expect(history().past.map((p) => p.base.crossSectionWidth)).toEqual([1.2, 1.25])
  })

  test('a right or middle press opens no gesture', () => {
    const { container } = render(<BasePanel />)
    const width = slider(container, 'Width')
    for (const button of [2, 1]) {
      fireEvent.pointerDown(width, { pointerId: 1, button })
      expect(store().gestureActive, `button ${button}`).toBe(false)
      // A step key while the button is still down is its own step.
      fireEvent.keyDown(width, { key: 'ArrowRight' })
      step(width, String(1.2 + 0.05 * (3 - button)))
      fireEvent.keyUp(width, { key: 'ArrowRight' })
      fireEvent.pointerUp(window, { pointerId: 1, button })
    }
    expect(history().past.map((p) => p.base.crossSectionWidth)).toEqual([1.2, 1.25, 1.3])
  })

  for (const [name, end] of [
    ['a window blur', () => fireEvent.blur(window)],
    ['lost pointer capture', (input: HTMLInputElement) => fireEvent.lostPointerCapture(input, { pointerId: 1 })],
  ] as const) {
    test(`${name} without a pointerup ends the slider's gesture: the next typed edit is its own step`, () => {
      const { container } = render(<BasePanel />)
      const width = slider(container, 'Width')
      fireEvent.pointerDown(width, { pointerId: 1 })
      step(width, '1.5')
      end(width)
      expect(store().gestureActive, 'no gesture left open').toBe(false)
      expect(history().past.map((p) => p.base.crossSectionWidth)).toEqual([1.2, 1.5])
      const x = container.querySelector<HTMLInputElement>('.control-point-row input')!
      fireEvent.change(x, { target: { value: '-2' } })
      fireEvent.keyDown(x, { key: 'Enter' })
      expect(history().past.map((p) => p.base.controlPoints[0][0])).toEqual([-2.5, -2.5, -2])
      // A pointerup that comes later ends nothing: no other gesture was open.
      store().beginGesture()
      fireEvent.pointerUp(window, { pointerId: 1 })
      expect(store().gestureActive, "a later pointerup leaves another gesture alone").toBe(true)
      store().endGesture()
    })
  }

  test('a press takes the focus before the gesture opens: the number field it leaves records its own step', () => {
    const { container } = render(<BasePanel />)
    const x = container.querySelector<HTMLInputElement>('.control-point-row input')!
    x.focus()
    fireEvent.change(x, { target: { value: '-2' } })
    const width = slider(container, 'Width')
    fireEvent.pointerDown(width, { pointerId: 1 })
    step(width, '1.5')
    fireEvent.pointerUp(window, { pointerId: 1 })
    const steps = history().past.map((p) => [p.base.controlPoints[0][0], p.base.crossSectionWidth])
    expect(steps, 'the opening preset, the typed X, then the drag').toEqual([[-2.5, 1.2], [-2, 1.2], [-2, 1.5]])
  })
})

describe('values that round to zero (plan decision D22)', () => {
  describe('cdx-13: pasted text the number input would alter', () => {
    const paste = (input: HTMLInputElement, text: string) =>
      fireEvent.paste(input, { clipboardData: { getData: (type: string) => (type === 'text' || type === 'text/plain' ? text : '') } })

    test("'1,5' (a decimal comma) is taken as 1.5, not the 15 Chrome makes of it", () => {
      const { container } = render(<BasePanel />)
      const y = container.querySelectorAll('.control-point-row')[1].querySelectorAll<HTMLInputElement>('input')[1]
      expect(paste(y, '1,5'), 'the paste is handled').toBe(false)
      fireEvent.keyDown(y, { key: 'Enter' })
      expect(store().preset.base.controlPoints[1][1]).toBe(1.5)
    })

    test("'1,234.5' (a comma and a point) is refused, and a plain number is left to the browser", () => {
      const { container } = render(<BasePanel />)
      const y = container.querySelectorAll('.control-point-row')[1].querySelectorAll<HTMLInputElement>('input')[1]
      expect(paste(y, '1,234.5'), 'refused').toBe(false)
      fireEvent.keyDown(y, { key: 'Enter' })
      expect(store().preset.base.controlPoints[1][1]).toBe(-1)
      expect(paste(y, ' 2.5 '), 'the browser pastes it').toBe(true)
    })
  })

  test('cdx-12: a typed -0 is stored as 0, so Export JSON then Import gives the same preset', () => {
    const { container } = render(<BasePanel />)
    const z = container.querySelectorAll('.control-point-row')[1].querySelectorAll<HTMLInputElement>('input')[2]
    fireEvent.change(z, { target: { value: '-0' } })
    fireEvent.keyDown(z, { key: 'Enter' })
    expect(Object.is(store().preset.base.controlPoints[1][2], 0), 'stored +0').toBe(true)
    expect(parsePresetJson(JSON.stringify(store().preset, null, 2))).toEqual(store().preset)
  })

  test('a number field shows 0.00 for -0, -0.001 and -1.1e-16, never -0.00', () => {
    for (const y of [-0, -0.001, -1.1e-16]) {
      const p = structuredClone(store().preset)
      p.base.controlPoints[0] = [-2.5, y, 0]
      useCloudStore.setState({ preset: p })
      const { container, unmount } = render(<BasePanel />)
      expect(container.querySelector<HTMLInputElement>('.control-point-row input:nth-of-type(2)')!.value, String(y)).toBe('0.00')
      unmount()
    }
  })

  test('a slider shows 0.00 and 0°, never -0.00 or -0°', () => {
    const p = structuredClone(store().preset)
    p.spheres[0] = { ...p.spheres[0], position: [-0.001, 0, 0], rotation: [-0.0016, 0, 0] }
    useCloudStore.setState({ preset: p })
    const { container } = render(<SpherePanel />)
    fireEvent.click(container.querySelector('.swirl-item-header')!)
    expect(slider(container, 'Pos X').getAttribute('aria-valuetext')).toBe('0.00')
    expect(slider(container, 'Rotate X').getAttribute('aria-valuetext')).toBe('0°')
    expect(formatPi(-0.001)).toBe('0.00π')
  })
})

describe('angle sliders reach 0 and both ends (cd:explore CDX-08)', () => {
  /** Whether min + k * step hits 0 (where 0 is in range) and max, k whole: the browser's range
   *  input takes only those values. */
  function onGrid(input: HTMLInputElement): { zero: boolean; max: boolean } {
    const [min, max, step] = [Number(input.min), Number(input.max), Number(input.step)]
    const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-9
    return { zero: min > 0 || max < 0 || whole(-min / step), max: whole((max - min) / step) }
  }

  test('Rotate: 0, -180 and 180 degrees are on the grid and store 0, -pi and pi exactly', () => {
    const { container } = render(<SpherePanel />)
    fireEvent.click(container.querySelector('.swirl-item-header')!)
    const rotate = slider(container, 'Rotate X')
    expect(onGrid(rotate)).toEqual({ zero: true, max: true })
    for (const [value, radians] of [['180', Math.PI], ['-180', -Math.PI], ['0', 0], ['90', Math.PI / 2]] as const) {
      step(rotate, value)
      expect(Object.is(store().preset.spheres[0].rotation[0], radians), `${value} degrees`).toBe(true)
    }
  })

  test('Curl and Spiral Twist reach 2 pi and 4 pi', () => {
    const tail = render(<TailPanel />)
    const curl = slider(tail.container, 'Curl')
    expect(onGrid(curl).max).toBe(true)
    step(curl, curl.max)
    expect(store().preset.tail.curlAmount).toBe(2 * Math.PI)
    tail.unmount()
    const fc = render(<FlowCloudPanel />)
    const twist = slider(fc.container, 'Spiral Twist')
    expect(onGrid(twist).max).toBe(true)
    step(twist, twist.max)
    expect(store().preset.flowCloud.wireframe.spiralTwist).toBe(4 * Math.PI)
  })
})

describe('the Spheres and Spirals sections show their count once (plan decision D22)', () => {
  test('the panels leave the count to the section header', () => {
    for (const Panel of [SpherePanel, SpiralPanel]) {
      const { container, unmount } = render(<Panel />)
      expect(container.textContent).not.toMatch(/(Spheres|Spirals) \(\d+\)/)
      expect(screen.getByRole('button', { name: '+ Add' })).toBeTruthy()
      unmount()
    }
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

  test('a typed coordinate is clamped to -50 to 50: base points, tail setpoints, F and B (plan decision D11)', () => {
    const base = render(<BasePanel />)
    const x = pointInput(base.container, 1, 0)
    fireEvent.change(x, { target: { value: '1e200' } })
    fireEvent.keyDown(x, { key: 'Enter' })
    expect(store().preset.base.controlPoints[1][0]).toBe(50)
    base.unmount()
    const tail = render(<TailPanel />)
    const z = tail.container.querySelectorAll('.setpoint-row')[2].querySelectorAll<HTMLInputElement>('input')[2]
    fireEvent.change(z, { target: { value: '-1e308' } })
    fireEvent.blur(z)
    expect(store().preset.tail.setpoints[2].position[2]).toBe(-50)
    tail.unmount()
    const fc = render(<FlowCloudPanel />)
    const front = screen.getByRole('spinbutton', { name: 'Front Y' })
    fireEvent.change(front, { target: { value: '99' } })
    fireEvent.blur(front)
    expect(store().preset.flowCloud.wireframe.frontPoint[1]).toBe(50)
    fc.unmount()
  })

  test('the history keys stay in the field: without a draft they undo and redo the preset, with one Ctrl+Z drops it', () => {
    const { container } = render(<BasePanel />)
    const x = pointInput(container, 0, 0)
    fireEvent.change(x, { target: { value: '-2' } })
    fireEvent.keyDown(x, { key: 'Enter' })
    expect(store().preset.base.controlPoints[0][0]).toBe(-2)

    // fireEvent returns false when the handler called preventDefault: the browser does not undo.
    expect(fireEvent.keyDown(x, { key: 'z', ctrlKey: true }), 'Ctrl+Z handled').toBe(false)
    expect(store().preset.base.controlPoints[0][0]).toBe(-2.5)
    expect(fireEvent.keyDown(x, { key: 'Z', metaKey: true, shiftKey: true }), 'Cmd+Shift+Z handled').toBe(false)
    expect(store().preset.base.controlPoints[0][0]).toBe(-2)

    fireEvent.change(x, { target: { value: '7' } })
    expect(fireEvent.keyDown(x, { key: 'y', ctrlKey: true }), 'Ctrl+Y with a draft handled').toBe(false)
    expect(x.value, 'redo keeps the draft').toBe('7')
    expect(fireEvent.keyDown(x, { key: 'z', ctrlKey: true }), 'Ctrl+Z with a draft handled').toBe(false)
    expect(x.value).toBe('-2.00')
    expect(store().preset.base.controlPoints[0][0], 'the draft is dropped, the preset kept').toBe(-2)
    expect(history().past, 'dropping the draft undoes nothing').toHaveLength(2)
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

describe('Accordion', () => {
  function Harness({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    return (
      <Accordion label="Spheres (3)" open={open} onToggle={onToggle}>
        <p>body</p>
      </Accordion>
    )
  }

  test('closed: aria-expanded false, no region; the arrow is not part of the name', () => {
    let toggles = 0
    render(<Harness open={false} onToggle={() => toggles++} />)
    const header = screen.getByRole('button', { name: 'Spheres (3)' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.getAttribute('aria-controls')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
    fireEvent.click(header)
    expect(toggles).toBe(1)
  })

  test('open: aria-expanded true, aria-controls names the region, which the header labels', () => {
    render(<Harness open onToggle={() => {}} />)
    const header = screen.getByRole('button', { name: 'Spheres (3)' })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    const region = screen.getByRole('region', { name: 'Spheres (3)' })
    expect(region.id).toBe(header.getAttribute('aria-controls'))
    expect(region.textContent).toBe('body')
  })

  test('two accordions get distinct ids', () => {
    render(
      <>
        <Harness open onToggle={() => {}} />
        <Accordion label="Base" open onToggle={() => {}}>x</Accordion>
      </>,
    )
    const ids = screen.getAllByRole('region').map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('FlowCloudPanel', () => {
  test('Snap Back → Tail moves B to where an attached tail starts, as one undo step', () => {
    // The default tail attaches at the base's end (offset 1); its stored first setpoint stays at
    // the old end, (2.5, -0.8, 0), when the base's last point moves.
    store().updateBasePoint(3, [2.5, 0.5, 0])
    store().commit()
    render(<FlowCloudPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Snap Back → Tail' }))
    const [x, y, z] = store().preset.flowCloud.wireframe.backPoint
    expect(x).toBeCloseTo(2.5, 9)
    expect(y).toBeCloseTo(0.5, 9)
    expect(z).toBeCloseTo(0, 9)
    expect(history().past).toHaveLength(3)
  })

  test('Snap Back → Tail keeps B inside -50 to 50 where the base curve overshoots its control points (plan decision D11)', () => {
    const p = structuredClone(store().preset)
    // A hairpin at x = 50: the curve reaches x = 50.5 halfway, where the tail attaches.
    p.base.controlPoints = [[46, 0, 0], [50, 0, 0], [50, 0.2, 0], [46, 0.2, 0]]
    p.tail.attachToBase = 'end'
    p.tail.attachOffset = 0.5
    store().loadPreset(p)
    render(<FlowCloudPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Snap Back → Tail' }))
    expect(store().preset.flowCloud.wireframe.backPoint[0]).toBe(50)
  })

  test('the F and B anchors have number fields: a typed coordinate moves the anchor, as one undo step', () => {
    render(<FlowCloudPanel />)
    const fields = ['Front X', 'Front Y', 'Front Z', 'Back X', 'Back Y', 'Back Z'].map((name) =>
      screen.getByRole<HTMLInputElement>('spinbutton', { name }),
    )
    expect(fields.map((f) => f.value)).toEqual(['-2.00', '0.00', '0.00', '2.50', '0.00', '0.00'])
    fireEvent.change(fields[1], { target: { value: '0.5' } })
    fireEvent.keyDown(fields[1], { key: 'Enter' })
    fireEvent.change(fields[5], { target: { value: '-1' } })
    fireEvent.blur(fields[5])
    const { frontPoint, backPoint } = store().preset.flowCloud.wireframe
    expect([frontPoint, backPoint]).toEqual([[-2, 0.5, 0], [2.5, 0, -1]])
    expect(history().past, 'one step per field').toHaveLength(3)
  })
})
