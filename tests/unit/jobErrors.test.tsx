// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { FlowCloudPanel } from '../../src/ui/panels/FlowCloudPanel'
import { useUiStore } from '../../src/store/uiStore'
import { useCloudStore } from '../../src/store/cloudStore'

/** A failed worker job (uiStore.jobs, set by EditorEngine's WorkerClients) is shown in its panel. */

const ui = () => useUiStore.getState()

beforeEach(() => {
  useCloudStore.getState().resetToDefault()
  useUiStore.setState(useUiStore.getInitialState())
})
afterEach(() => cleanup())

test('a failed Regenerate or Cut & Glue shows its error until the next run', () => {
  render(<FlowCloudPanel />)
  expect(screen.queryAllByRole('alert')).toEqual([])

  act(() => ui().setJob('flowCloud', { status: 'failed', requestId: 1, error: 'grid too large' }))
  expect(screen.getByRole('alert').textContent).toBe('Regenerate failed: grid too large')

  act(() => ui().setJob('surfaceMesh', { status: 'failed', requestId: 2, error: 'resolution must be at least 1' }))
  expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
    'Regenerate failed: grid too large',
    'Cut & Glue failed: resolution must be at least 1',
  ])

  act(() => {
    ui().setJob('flowCloud', { status: 'running', requestId: 3, error: null })
    ui().setJob('surfaceMesh', { status: 'done', requestId: 2, error: null })
  })
  expect(screen.queryAllByRole('alert')).toEqual([])
})
