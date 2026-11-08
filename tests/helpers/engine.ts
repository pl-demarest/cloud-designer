import type * as THREE from 'three'
import { vi } from 'vitest'
import type { EditorEngineOptions } from '../../src/engine/EditorEngine'
import type { WorkerFactory, WorkerKind } from '../../src/engine/workers'
import { FakeWorker } from './scene'
import { runWorker, type WorkerName } from './workerHarness'

/**
 * A stand-in for THREE.WebGLRenderer with the members Viewport uses and no WebGL: it records the
 * animation loop it is given, counts render calls and whether it was disposed, and keeps the two
 * unpack flags its context's pixelStorei sets.
 */
export interface RendererStub {
  domElement: HTMLCanvasElement
  loop: ((time: number) => void) | null
  renders: number
  disposed: boolean
  unpack: { flipY: boolean; premultiplyAlpha: boolean }
}

const UNPACK_FLIP_Y_WEBGL = 0x9240
const UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241

/** Every renderer stub created so far, oldest first; reset with `rendererStubs.length = 0`. */
export const rendererStubs: RendererStub[] = []

export function createRendererStub(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    loop: null as ((time: number) => void) | null,
    renders: 0,
    disposed: false,
    unpack: { flipY: false, premultiplyAlpha: false },
    getContext() {
      return {
        UNPACK_FLIP_Y_WEBGL,
        UNPACK_PREMULTIPLY_ALPHA_WEBGL,
        pixelStorei(name: number, value: boolean) {
          if (name === UNPACK_FLIP_Y_WEBGL) stub.unpack.flipY = value
          if (name === UNPACK_PREMULTIPLY_ALPHA_WEBGL) stub.unpack.premultiplyAlpha = value
        },
      }
    },
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

const WORKER_NAMES: Record<WorkerKind, WorkerName> = {
  flowCloud: 'marchingCubes',
  cutAndGlue: 'cutAndGlue',
  surfaceMesh: 'surfaceMesh',
}

/**
 * A worker that answers only when the test says so: answer() runs the real worker module
 * (workerHarness) on the oldest unanswered request and delivers its reply.
 */
export class ManualWorker {
  readonly name: WorkerName
  /** Every request posted, structured-cloned as postMessage would. */
  readonly posted: unknown[] = []
  /** Every reply delivered, in order. */
  readonly replies: unknown[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  private answered = 0

  constructor(name: WorkerName) {
    this.name = name
  }

  postMessage(data: unknown): void {
    this.posted.push(structuredClone(data))
  }

  /** Requests posted and not answered yet. */
  get unanswered(): number {
    return this.posted.length - this.answered
  }

  async answer(): Promise<void> {
    if (this.unanswered === 0) throw new Error(`${this.name}: no request to answer`)
    const run = await runWorker(this.name, this.posted[this.answered++])
    this.replies.push(run.message)
    if (!this.terminated) this.onmessage?.({ data: run.message } as MessageEvent)
  }

  /** Replies with `data` instead of running the worker. */
  reply(data: unknown): void {
    if (this.unanswered === 0) throw new Error(`${this.name}: no request to answer`)
    this.answered++
    this.replies.push(data)
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent)
  }

  terminate(): void {
    this.terminated = true
  }
}

/** A worker factory that hands out ManualWorkers, kept by kind. */
export function manualWorkers(): { workers: Record<WorkerKind, ManualWorker>; createWorker: WorkerFactory } {
  const workers = {} as Record<WorkerKind, ManualWorker>
  const createWorker: WorkerFactory = (kind) => {
    workers[kind] = new ManualWorker(WORKER_NAMES[kind])
    return workers[kind] as unknown as Worker
  }
  return { workers, createWorker }
}
