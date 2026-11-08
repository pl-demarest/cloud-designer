// @vitest-environment happy-dom
import { StrictMode, useRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { useEditorEngine } from '../../src/engine/useEditorEngine'
import { useCloudStore } from '../../src/store/cloudStore'
import { installFakeWorker } from '../helpers/scene'
import { TEST_ENGINE_OPTIONS, installCanvas2dStub, liveWorkers, mountCanvas, rendererStubs } from '../helpers/engine'
import { trackListeners, trackResources, type ListenerTracker, type ResourceTracker } from '../helpers/resources'

/**
 * EditorEngine.dispose() releases everything the engine acquired, so a remount (React StrictMode
 * in development, or any other) returns to the single-mount numbers. Counted without WebGL:
 * geometries, materials and textures through tests/helpers/resources.ts, workers through the
 * worker factory (FakeWorker), listeners on the canvas, the window and the document.
 */

const NONE = { geometries: 0, materials: 0, textures: 0 }

let resources: ResourceTracker
let listeners: ListenerTracker
let canvas: HTMLCanvasElement

beforeAll(() => {
  installFakeWorker()
  installCanvas2dStub()
  // three creates some shared geometries on first use (ArrowHelper's line and cone, Sprite's
  // quad) and keeps them for the page's lifetime. One engine built and disposed before counting
  // makes them exist already, so they are not counted as this engine's.
  new EditorEngine(mountCanvas(), TEST_ENGINE_OPTIONS).dispose()
})

beforeEach(() => {
  useCloudStore.getState().resetToDefault()
  canvas = mountCanvas()
  resources = trackResources()
  listeners = trackListeners({ canvas, window, document })
  rendererStubs.length = 0
})

afterEach(() => {
  cleanup()
  resources.stop()
  listeners.stop()
})

function counts() {
  return { resources: resources.live(), workers: liveWorkers(), listeners: listeners.active() }
}

describe('EditorEngine.dispose', () => {
  test('releases every geometry, material, texture, worker and listener, and stops the loop', () => {
    const engine = new EditorEngine(canvas, TEST_ENGINE_OPTIONS)
    const mounted = counts()
    expect(mounted.workers).toBe(3)
    expect(mounted.resources.geometries).toBeGreaterThan(0)
    expect(mounted.resources.materials).toBeGreaterThan(0)
    expect(mounted.resources.textures).toBe(2) // the gizmo's F and B labels
    expect(mounted.listeners).toContain('canvas:pointerdown')
    expect(rendererStubs).toHaveLength(1)
    expect(rendererStubs[0].loop).not.toBeNull()

    engine.dispose()
    expect(counts()).toEqual({ resources: NONE, workers: 0, listeners: [] })
    expect(rendererStubs[0].loop, 'animation loop stopped').toBeNull()
    expect(rendererStubs[0].disposed).toBe(true)
    expect(engine.viewport.scene.children, 'scene emptied').toEqual([])

    // A disposed engine's views no longer follow the store.
    const created = resources.created()
    const store = useCloudStore.getState()
    store.addSphere()
    store.setBase({ crossSectionWidth: 0.9 })
    store.addSpiral()
    expect(resources.created()).toEqual(created)
  })

  test('leaves the WebGL unpack state at its defaults, for the renderer a remount makes on the canvas', () => {
    const engine = new EditorEngine(canvas, TEST_ENGINE_OPTIONS)
    // As after a frame: three uploads the gizmo's label textures with flipY.
    rendererStubs[0].unpack = { flipY: true, premultiplyAlpha: true }
    engine.dispose()
    expect(rendererStubs[0].unpack).toEqual({ flipY: false, premultiplyAlpha: false })
  })

  test('a second dispose() is a no-op', () => {
    const engine = new EditorEngine(canvas, TEST_ENGINE_OPTIONS)
    engine.dispose()
    const disposed = resources.disposed()
    engine.dispose()
    expect(resources.disposed()).toEqual(disposed)
  })

  test('mount, unmount and remount return to the single-mount numbers', () => {
    const first = new EditorEngine(canvas, TEST_ENGINE_OPTIONS)
    const single = counts()
    first.dispose()
    expect(counts()).toEqual({ resources: NONE, workers: 0, listeners: [] })

    const second = new EditorEngine(canvas, TEST_ENGINE_OPTIONS)
    expect(counts()).toEqual(single)
    second.dispose()
    expect(counts()).toEqual({ resources: NONE, workers: 0, listeners: [] })
  })
})

describe('useEditorEngine', () => {
  function Host() {
    const ref = useRef<HTMLCanvasElement>(null)
    useEditorEngine(ref, TEST_ENGINE_OPTIONS)
    return (
      <div>
        <canvas ref={ref} />
      </div>
    )
  }

  /** The counts while `ui` is mounted, without the canvas listeners (each render has its own canvas). */
  function mountedCounts(ui: React.ReactElement) {
    const view = render(ui)
    const mounted = { resources: resources.live(), workers: liveWorkers() }
    view.unmount()
    return { mounted, afterUnmount: { resources: resources.live(), workers: liveWorkers() } }
  }

  test('a StrictMode double mount leaves one engine, with the single-mount counts', () => {
    const single = mountedCounts(<Host />)
    expect(single.mounted.workers).toBe(3)
    expect(single.afterUnmount).toEqual({ resources: NONE, workers: 0 })
    expect(rendererStubs).toHaveLength(1)

    rendererStubs.length = 0
    const strict = mountedCounts(
      <StrictMode>
        <Host />
      </StrictMode>,
    )
    // StrictMode ran the effect, its cleanup and the effect again: two engines, the first disposed.
    expect(rendererStubs).toHaveLength(2)
    expect(rendererStubs[0].disposed).toBe(true)
    expect(strict.mounted).toEqual(single.mounted)
    expect(strict.afterUnmount).toEqual({ resources: NONE, workers: 0 })
    expect(rendererStubs[1].disposed).toBe(true)
    // react-dom listens for selectionchange on the document once per document and keeps it.
    const left = listeners.active().filter((l) => l !== 'document:selectionchange')
    expect(left, 'no window or document listener left').toEqual([])
  })
})
