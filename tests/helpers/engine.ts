import type * as THREE from 'three'
import { vi } from 'vitest'
import type { EditorEngineOptions } from '../../src/engine/EditorEngine'
import { FakeWorker } from './scene'

/**
 * A stand-in for THREE.WebGLRenderer with the members Viewport uses and no WebGL: it records the
 * animation loop it is given, counts render calls and whether it was disposed.
 */
export interface RendererStub {
  domElement: HTMLCanvasElement
  loop: ((time: number) => void) | null
  renders: number
  disposed: boolean
}

/** Every renderer stub created so far, oldest first; reset with `rendererStubs.length = 0`. */
export const rendererStubs: RendererStub[] = []

export function createRendererStub(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    loop: null as ((time: number) => void) | null,
    renders: 0,
    disposed: false,
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    setAnimationLoop(cb: ((time: number) => void) | null) {
      stub.loop = cb
    },
    render() {
      stub.renders++
    },
    dispose() {
      stub.disposed = true
    },
  }
  rendererStubs.push(stub)
  return stub as unknown as THREE.WebGLRenderer
}

/**
 * Engine options for tests: the renderer stub, and the default worker factory, which builds
 * FakeWorkers once installFakeWorker() has stubbed the global Worker. A module constant, so
 * useEditorEngine sees the same options on every render.
 */
export const TEST_ENGINE_OPTIONS: EditorEngineOptions = { createRenderer: createRendererStub }

/** Workers constructed and not yet terminated. */
export function liveWorkers(): number {
  return FakeWorker.instances.filter((w) => !w.terminated).length
}

/** A canvas inside a sized-by-CSS parent in the document, as ViewportCanvas renders it. */
export function mountCanvas(): HTMLCanvasElement {
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  parent.appendChild(canvas)
  document.body.appendChild(parent)
  return canvas
}

/**
 * happy-dom's canvas has no 2D context (getContext('2d') returns null); the axis gizmo draws its
 * F and B labels on one. This gives '2d' a context that accepts the drawing calls and draws nothing.
 */
export function installCanvas2dStub(): void {
  const getContext = HTMLCanvasElement.prototype.getContext
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ) {
    if (contextId === '2d') return { fillText() {} } as unknown as CanvasRenderingContext2D
    return (getContext as (id: string, o?: unknown) => RenderingContext | null).call(this, contextId, options)
  } as typeof HTMLCanvasElement.prototype.getContext)
}
