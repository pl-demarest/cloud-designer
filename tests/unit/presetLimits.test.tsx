// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { BasePanel } from '../../src/ui/panels/BasePanel'
import { TailPanel } from '../../src/ui/panels/TailPanel'
import { SpiralPanel } from '../../src/ui/panels/SpiralPanel'
import { FlowCloudPanel } from '../../src/ui/panels/FlowCloudPanel'
import { useCloudStore } from '../../src/store/cloudStore'
import { COUNT_RANGES, FLOW_CLOUD_RESOLUTIONS, SURFACE_MESH_RESOLUTIONS, type CountRange } from '../../src/model/normalize'
import { THICK_SPIRAL, fixture } from '../fixtures/presets'

/**
 * normalizePreset clamps the whole-number fields to the ranges of their sliders and the grid
 * resolutions to the values of their selects (src/model/normalize.ts). The ranges are written
 * twice, there and in the panels; this test reads the panels and holds the two together.
 */

beforeEach(() => {
  const p = fixture('default')
  p.spirals = [structuredClone(THICK_SPIRAL)]
  p.flowCloud.wireframe.generateBands = true // shows the Bands slider
  useCloudStore.getState().loadPreset(p)
})
afterEach(() => cleanup())

/** The control in the row labelled `label` (SliderRow's .slider-row, a select's .field-row). */
function control<T extends Element>(container: HTMLElement, label: string, selector: string): T {
  const rows = Array.from(container.querySelectorAll('.slider-row, .field-row')).filter(
    (row) => row.querySelector('label')?.textContent?.trim() === label,
  )
  expect(rows, label).toHaveLength(1)
  return rows[0].querySelector<T>(selector)!
}

/** A slider's range, and its step, which a whole-number field needs to be 1. */
function sliderRange(container: HTMLElement, label: string): CountRange & { step: number } {
  const input = control<HTMLInputElement>(container, label, 'input[type=range]')
  return { min: Number(input.min), max: Number(input.max), step: Number(input.step) }
}

function selectValues(container: HTMLElement, label: string): number[] {
  return Array.from(control<HTMLSelectElement>(container, label, 'select').options).map((o) => Number(o.value))
}

describe("normalizePreset's ranges are those of the editor's controls", () => {
  test('BasePanel: Ring Density and Length Density', () => {
    const { container } = render(<BasePanel />)
    expect(sliderRange(container, 'Ring Density')).toEqual({ ...COUNT_RANGES.ringSegments, step: 1 })
    expect(sliderRange(container, 'Length Density')).toEqual({ ...COUNT_RANGES.baseLengthSegments, step: 1 })
  })

  test('TailPanel: Radial Density and Length Density', () => {
    const { container } = render(<TailPanel />)
    expect(sliderRange(container, 'Radial Density')).toEqual({ ...COUNT_RANGES.radialSegments, step: 1 })
    expect(sliderRange(container, 'Length Density')).toEqual({ ...COUNT_RANGES.tailLengthSegments, step: 1 })
  })

  test('SpiralPanel: Rung Density', () => {
    const { container } = render(<SpiralPanel />)
    fireEvent.click(container.querySelector('.swirl-item-header')!)
    expect(sliderRange(container, 'Rung Density')).toEqual({ ...COUNT_RANGES.rungDensity, step: 1 })
  })

  test('FlowCloudPanel: Bands, Flow Lines, Resolution and Mesh Density', () => {
    const { container } = render(<FlowCloudPanel hasSurfaceMesh />)
    expect(sliderRange(container, 'Bands')).toEqual({ ...COUNT_RANGES.numBands, step: 1 })
    expect(sliderRange(container, 'Flow Lines')).toEqual({ ...COUNT_RANGES.numFlowLines, step: 1 })
    expect(selectValues(container, 'Resolution')).toEqual(FLOW_CLOUD_RESOLUTIONS)
    expect(selectValues(container, 'Mesh Density')).toEqual(SURFACE_MESH_RESOLUTIONS)
  })
})
