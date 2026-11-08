// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExportPanel } from '../../src/ui/panels/ExportPanel'
import { EngineContext } from '../../src/ui/EngineContext'
import { useUiStore } from '../../src/store/uiStore'
import type { EditorEngine } from '../../src/engine/EditorEngine'

// GLTFExporter loads on first use; offline, or after a deploy that removed the chunk, the import
// fails. writeGlb then rejects, as here.
vi.mock('../../src/export/glb', () => ({
  writeGlb: vi.fn().mockRejectedValue(new TypeError('Failed to fetch dynamically imported module')),
}))

/** The parts of the engine ExportPanel reads: a Cut & Glue result and the scaffold groups. */
function engineRef() {
  const group = () => new THREE.Group()
  const engine = {
    cutGlue: { getEdges: () => new Float32Array([0, 0, 0, 1, 0, 0]) },
    scaffoldGroups: () => ({ spheres: group(), base: group(), tail: group(), spirals: group() }),
    viewport: { flowCloudGroup: group() },
  }
  return { current: engine as unknown as EditorEngine }
}

afterEach(() => {
  cleanup()
  useUiStore.setState(useUiStore.getInitialState())
})

describe('a GLB export that fails (cd:review CDR-09)', () => {
  test('tells the user why in the notice', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <EngineContext.Provider value={engineRef()}>
        <ExportPanel />
      </EngineContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export Cloud GLB' }))
    await waitFor(() => expect(useUiStore.getState().notice).not.toBeNull())
    expect(useUiStore.getState().notice).toEqual({
      tone: 'error',
      text: 'Could not export default-cloud-cloud.glb: Failed to fetch dynamically imported module',
    })
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
