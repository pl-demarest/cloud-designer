// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { SpherePanel } from '../../../src/ui/panels/SpherePanel'
import { BasePanel } from '../../../src/ui/panels/BasePanel'
import { TailPanel } from '../../../src/ui/panels/TailPanel'
import { SpiralPanel } from '../../../src/ui/panels/SpiralPanel'
import { FlowCloudPanel } from '../../../src/ui/panels/FlowCloudPanel'
import { useCloudStore } from '../../../src/store/cloudStore'
import { useHistoryStore } from '../../../src/store/historyStore'
import { THICK_SPIRAL, fixture } from '../../fixtures/presets'
import type { CloudPreset } from '../../../src/model/types'

/**
 * Every panel control's store mapping, found missing by mutation testing (Stage A net
 * check, 2026-11-07): the browser suite drives a handful of sliders, so a slider that
 * wrote the wrong field or the wrong vector component went unnoticed.
 *
 * For each input and select in an expanded panel the test applies one change and
 * records exactly which preset paths changed and to what. The preset gives every
 * vector component a distinct value, so a control that copies the wrong component
 * shows up as an extra changed path. Stage C replaces the panel controls; the
 * snapshot (in __snapshots__/) is the contract they must keep.
 */

const store = () => useCloudStore.getState()

/** Distinct, non-zero components everywhere a control writes a vector. */
function mappingPreset(): CloudPreset {
  const p = fixture('default')
  Object.assign(p.spheres[0], {
    shape: 'ellipsoid',
    position: [0.11, 0.22, 0.33],
    scale: [1.1, 0.9, 0.8],
    rotation: [0.1, 0.2, 0.3],
  })
  p.spirals = [structuredClone(THICK_SPIRAL)] // position [0.5, 2.2, -0.3], rotation [0.4, 0.2, 0.1]
  p.flowCloud.position = [0.1, 0.2, 0.3]
  p.flowCloud.wireframe.generateBands = true
  p.base.ringSegments = 16
  return p
}

type Change = [path: string, before: unknown, after: unknown]

function diff(a: unknown, b: unknown, path = ''): Change[] {
  if (Object.is(a, b)) return []
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    return keys.flatMap((k) =>
      diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k),
    )
  }
  return [[path, a, b]]
}

/** The label a control sits next to: a SliderRow or field-row label, else its row's first text. */
function describeControl(el: HTMLElement, index: number): string {
  const row = el.closest('.slider-row, .field-row, .control-point-row, .setpoint-row')
  const label =
    row?.querySelector('label')?.textContent ??
    row?.querySelector('.cp-label, .setpoint-header > span')?.textContent ??
    ''
  const kind = el instanceof HTMLSelectElement ? 'select' : (el as HTMLInputElement).type
  return `${String(index).padStart(2, '0')} ${kind} ${label.trim()}`
}

/** One deterministic change per control kind. */
function change(el: HTMLElement): void {
  if (el instanceof HTMLSelectElement) {
    const next = Array.from(el.options).find((o) => o.value !== el.value)!
    fireEvent.change(el, { target: { value: next.value } })
    return
  }
  const input = el as HTMLInputElement
  if (input.type === 'checkbox') {
    fireEvent.click(input)
  } else if (input.type === 'range') {
    const min = Number(input.min)
    const max = Number(input.max)
    fireEvent.change(input, { target: { value: String(min + (max - min) * 0.37) } })
  } else {
    fireEvent.change(input, { target: { value: String(Number(input.value) + 0.37) } })
  }
}

/** Applies each control once, from the same starting preset, and maps it to the paths it changed. */
function mapControls(ui: ReactElement): Record<string, Change[]> {
  const start = mappingPreset()
  store().loadPreset(start)
  const { container } = render(ui)
  for (const header of Array.from(container.querySelectorAll<HTMLElement>('.swirl-item-header')).slice(0, 1)) {
    fireEvent.click(header)
  }
  const controls = () =>
    Array.from(container.querySelectorAll<HTMLElement>('input, select')).filter(
      (el) => !(el as HTMLInputElement).disabled,
    )
  const count = controls().length
  const map: Record<string, Change[]> = {}
  for (let i = 0; i < count; i++) {
    // act() flushes the re-render, so each control's handler closes over the fresh preset.
    act(() => store().loadPreset(start))
    const el = controls()[i]
    const key = describeControl(el, i)
    const before = structuredClone(store().preset)
    change(el)
    map[key] = diff(before, store().preset)
  }
  expect(controls()).toHaveLength(count)
  return map
}

beforeEach(() => {
  store().resetToDefault()
  useHistoryStore.getState().clear()
})
afterEach(() => cleanup())

describe('panel controls map to one preset field each', () => {
  const panels: Array<[string, () => ReactElement]> = [
    ['SpherePanel', () => <SpherePanel />],
    ['BasePanel', () => <BasePanel />],
    ['TailPanel', () => <TailPanel />],
    ['SpiralPanel', () => <SpiralPanel />],
    ['FlowCloudPanel', () => <FlowCloudPanel hasSurfaceMesh />],
  ]

  for (const [name, ui] of panels) {
    test(name, () => {
      const map = mapControls(ui())
      // Every control that edits the preset changes exactly one leaf; the Surface Mesh
      // checkbox only calls its prop. Stage C may add history entries but not more fields.
      for (const [key, changes] of Object.entries(map)) {
        if (!(name === 'FlowCloudPanel' && key.endsWith('checkbox Surface Mesh'))) {
          expect(changes, key).toHaveLength(1)
        }
      }
      expect(map).toMatchSnapshot()
    })
  }
})
