// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SpherePanel } from '../../src/ui/panels/SpherePanel'
import { BasePanel } from '../../src/ui/panels/BasePanel'
import { TailPanel } from '../../src/ui/panels/TailPanel'
import { SpiralPanel } from '../../src/ui/panels/SpiralPanel'
import { FlowCloudPanel } from '../../src/ui/panels/FlowCloudPanel'
import { useCloudStore } from '../../src/store/cloudStore'
import { RANGES, RESOLUTIONS, type NumberRange } from '../../src/model/ranges'
import { THICK_SPIRAL, fixture } from '../fixtures/presets'

/**
 * Every slider, number field and resolution list of the panels takes its range from the range
 * table (src/model/ranges.ts), which normalizePreset also clamps to. Each panel's sliders and
 * fields are listed here by accessible name with the table entry they must show, and a control
 * the list does not name fails the test, so a new control cannot bring a range of its own.
 */

beforeEach(() => {
  const p = fixture('default')
  p.spheres[0].shape = 'ellipsoid' // shows the Scale sliders
  p.spirals = [structuredClone(THICK_SPIRAL)] // thick: shows Corner Rnd
  p.flowCloud.wireframe.generateBands = true // shows the Bands slider
  useCloudStore.getState().loadPreset(p)
})
afterEach(() => cleanup())

/** The accessible name of a control: its aria-label, else the text of the label pointing at it. */
function nameOf(input: HTMLInputElement, container: HTMLElement): string {
  const aria = input.getAttribute('aria-label')
  if (aria) return aria
  return container.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent?.trim() ?? ''
}

/** min, max and step of every input of `type`, by accessible name. */
function rangesOf(container: HTMLElement, type: 'range' | 'number'): Map<string, { min: number; max: number; step: number }> {
  const out = new Map<string, { min: number; max: number; step: number }>()
  for (const input of container.querySelectorAll<HTMLInputElement>(`input[type=${type}]`)) {
    const at = (attr: string) => (input.hasAttribute(attr) ? Number(input.getAttribute(attr)) : NaN)
    out.set(nameOf(input, container), { min: at('min'), max: at('max'), step: at('step') })
  }
  return out
}

/** A slider's input counts in its range's unit (a degree, or π). */
const slider = (r: NumberRange) => ({ min: r.min / (r.unit ?? 1), max: r.max / (r.unit ?? 1), step: r.step / (r.unit ?? 1) })
const axes = (prefix: string, r: NumberRange | readonly NumberRange[]) =>
  Object.fromEntries(['X', 'Y', 'Z'].map((a, i) => [`${prefix} ${a}`, slider('min' in r ? r : r[i])]))

function expectRanges(container: HTMLElement, type: 'range' | 'number', want: Record<string, { min: number; max: number; step: number }>) {
  const got = Object.fromEntries(rangesOf(container, type))
  expect(got).toEqual(want)
}

/** A coordinate number field: the table's min, max and step. */
const coordinateField = (r: NumberRange) => ({ min: r.min, max: r.max, step: r.step })

describe('the panels take every range from the range table', () => {
  test('SpherePanel', () => {
    const { container } = render(<SpherePanel />)
    fireEvent.click(container.querySelector('.swirl-item-header')!)
    const R = RANGES.sphere
    expectRanges(container, 'range', {
      ...axes('Pos', R.position),
      Radius: slider(R.radius),
      Falloff: slider(R.falloff),
      ...axes('Rotate', R.rotation),
      ...axes('Scale', R.scale),
    })
  })

  test('BasePanel', () => {
    const { container } = render(<BasePanel />)
    const R = RANGES.base
    expectRanges(container, 'range', {
      Width: slider(R.crossSectionWidth),
      Height: slider(R.crossSectionHeight),
      'Ring Density': slider(R.ringSegments),
      'Length Density': slider(R.lengthSegments),
    })
    const points = fixture('default').base.controlPoints.flatMap((_, i) => Object.entries(axes(`P${i}`, R.controlPoint)))
    expectRanges(container, 'number', Object.fromEntries(points.map(([name]) => [name, coordinateField(R.controlPoint)])))
  })

  test('TailPanel', () => {
    const { container } = render(<TailPanel />)
    const R = RANGES.tail
    expectRanges(container, 'range', {
      'Start radius': slider(R.width),
      'End radius': slider(R.width),
      Curl: slider(R.curlAmount),
      'Radial Density': slider(R.radialSegments),
      'Length Density': slider(R.lengthSegments),
      'Attach Offset': slider(R.attachOffset),
    })
    const want: Record<string, { min: number; max: number; step: number }> = {}
    fixture('default').tail.setpoints.forEach((_, i) => {
      for (const name of Object.keys(axes(`SP ${i}`, R.setpointPosition))) want[name] = coordinateField(R.setpointPosition)
      want[`SP ${i} width`] = { min: R.width.min, max: R.width.max, step: R.width.fieldStep! }
    })
    expectRanges(container, 'number', want)
  })

  test('SpiralPanel', () => {
    const { container } = render(<SpiralPanel />)
    fireEvent.click(container.querySelector('.swirl-item-header')!)
    const R = RANGES.spiral
    expectRanges(container, 'range', {
      'Inner Radius': slider(R.startRadius),
      'Outer Radius': slider(R.endRadius),
      Turns: slider(R.turns),
      Separation: slider(R.separation),
      'Taper Power': slider(R.taperPower),
      'Rung Density': slider(R.rungDensity),
      Thickness: slider(R.thickness),
      'Corner Rnd': slider(R.cornerRadius),
      ...axes('Pos', R.position),
      ...axes('Rotate', R.rotation),
    })
  })

  test('FlowCloudPanel, with its two resolution lists', () => {
    const { container } = render(<FlowCloudPanel />)
    const R = RANGES.flowCloud
    expectRanges(container, 'range', {
      ...axes('Position', R.position),
      Threshold: slider(R.threshold),
      Bands: slider(R.numBands),
      'Flow Lines': slider(R.numFlowLines),
      'Spiral Twist': slider(R.spiralTwist),
    })
    expectRanges(container, 'number', {
      ...Object.fromEntries(Object.keys(axes('Front', R.anchor)).map((n) => [n, coordinateField(R.anchor)])),
      ...Object.fromEntries(Object.keys(axes('Back', R.anchor)).map((n) => [n, coordinateField(R.anchor)])),
    })
    const options = (label: string) => {
      const select = container.querySelector<HTMLSelectElement>(
        `#${CSS.escape(Array.from(container.querySelectorAll('label')).find((l) => l.textContent === label)!.htmlFor)}`,
      )!
      return Array.from(select.options).map((o) => Number(o.value))
    }
    expect(options('Resolution')).toEqual(RESOLUTIONS.flowCloud)
    expect(options('Mesh Density')).toEqual(RESOLUTIONS.surfaceMesh)
  })
})
