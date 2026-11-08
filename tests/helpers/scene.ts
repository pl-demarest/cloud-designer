import * as THREE from 'three'
import { vi } from 'vitest'
import type { Viewport } from '../../src/engine/Viewport'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { createEditorMaterials } from '../../src/engine/materials'
import type { SphereMesh } from '../../src/engine/views/SphereMesh'
import type { BaseMesh } from '../../src/engine/views/BaseMesh'
import type { TailMesh } from '../../src/engine/views/TailMesh'
import type { SpiralMesh } from '../../src/engine/views/SpiralMesh'
import type { FlowCloud } from '../../src/engine/views/FlowCloud'
import type { CutGlueResult } from '../../src/engine/views/CutGlueResult'
import { useCloudStore } from '../../src/store/cloudStore'
import type { CloudPreset } from '../../src/model/types'
import type { FlowCloudRequest, FlowCloudResult } from '../../src/workers/protocol'
import { digestArray } from './digest'
import { runWorker, type WorkerName } from './workerHarness'
import { createRendererStub, mountCanvas } from './engine'

/**
 * Editor-side test scaffolding. Requires the happy-dom environment
 * (`// @vitest-environment happy-dom` in the test file).
 */

// ── Viewport stub ────────────────────────────────────────────────────────────

/**
 * The parts of Viewport the views and the DragController touch: the eight groups
 * (with the same scene hierarchy as the real Viewport, so matrixWorld is identical),
 * the camera, the canvas, the shared materials and OrbitControls' `enabled` flag.
 * No WebGL.
 */
export function createViewportStub(): Viewport {
  const scene = new THREE.Scene()
  const named = (name: string) => Object.assign(new THREE.Group(), { name })
  const activeUnitGroup = named('activeUnitGroup')
  const groups = {
    sphereGroup: named('sphereGroup'),
    baseGroup: named('baseGroup'),
    tailGroup: named('tailGroup'),
    spiralGroup: named('spiralGroup'),
    flowCloudGroup: named('flowCloudGroup'),
    gizmoGroup: named('gizmoGroup'),
  }
  scene.add(activeUnitGroup)
  activeUnitGroup.add(...Object.values(groups))
  const cutGlueGroup = named('cutGlueGroup')
  cutGlueGroup.visible = false
  scene.add(cutGlueGroup)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
  camera.position.set(0, 4, 10)
  camera.lookAt(0, 0, 0)

  const stub = {
    scene,
    camera,
    activeUnitGroup,
    ...groups,
    cutGlueGroup,
    renderer: { domElement: document.createElement('canvas') },
    materials: createEditorMaterials(),
    controls: { enabled: true },
    onTick: () => {},
  }
  return stub as unknown as Viewport
}

// ── Fake Worker that runs the real worker module in-process ─────────────────

/**
 * Stands in for the browser Worker. `new Worker(new URL('../workers/x.worker.ts', ...))`
 * is mapped to the worker name; postMessage runs the real module through the
 * harness on a later task and delivers the result to `onmessage`. Runs of all
 * instances take turns: the harness swaps the global `self` for the duration of a
 * run, so two overlapping runs (the cut-and-glue and surface-mesh requests of one
 * Cut & Glue) would install their handlers on each other's stub.
 */
export class FakeWorker {
  static instances: FakeWorker[] = []
  private static turn: Promise<unknown> = Promise.resolve()
  readonly name: WorkerName
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  posted: unknown[] = []
  private inflight: Promise<void>[] = []

  constructor(url: URL | string) {
    const match = /\/(\w+)\.worker\.ts/.exec(String(url))
    if (!match) throw new Error(`FakeWorker: unrecognised worker URL ${String(url)}`)
    this.name = match[1] as WorkerName
    FakeWorker.instances.push(this)
  }

  postMessage(data: unknown): void {
    this.posted.push(data)
    const run = FakeWorker.turn
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
      .then(() => runWorker(this.name, data))
    FakeWorker.turn = run.catch(() => {})
    this.inflight.push(
      run.then((r) => {
        if (!this.terminated) this.onmessage?.({ data: r.message } as MessageEvent)
      }),
    )
  }

  /** Resolves when every message posted so far has been answered. */
  async settle(): Promise<void> {
    while (this.inflight.length > 0) await this.inflight.shift()
  }

  terminate(): void {
    this.terminated = true
  }
}

export function installFakeWorker(): void {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
}

// ── Scene serialization ──────────────────────────────────────────────────────

/** Handles, like the gizmo and the helpers, carry userData.editorOnly. */
export function isHandle(obj: THREE.Object3D): boolean {
  return obj.userData.editorOnly === true
}

/** -0 and 0 print alike in JSON; normalize so a sign flip on zero is not a golden change. */
function normalizeZero(v: number[]): number[] {
  return v.map((n) => (Object.is(n, -0) ? 0 : n))
}

function serializeMaterial(m: THREE.Material | THREE.Material[]) {
  const one = (x: THREE.Material) => ({
    type: x.type,
    color: 'color' in x && x.color instanceof THREE.Color ? x.color.getHexString() : null,
  })
  return Array.isArray(m) ? m.map(one) : one(m)
}

export interface SerializedObject {
  type: string
  name: string
  role: 'handle' | 'geometry' | 'container'
  visible: boolean
  userData: Record<string, unknown>
  position: number[]
  quaternion: number[]
  scale: number[]
  material?: unknown
  geometry?: { attributes: string[]; position: unknown; index: unknown }
  children: SerializedObject[]
}

/** A diff-readable description of an object subtree, with geometry digested. */
export function serializeObject(obj: THREE.Object3D): SerializedObject {
  const out: SerializedObject = {
    type: obj.type,
    name: obj.name,
    role: isHandle(obj) ? 'handle' : obj instanceof THREE.Mesh || obj instanceof THREE.Line ? 'geometry' : 'container',
    visible: obj.visible,
    userData: Object.fromEntries(Object.entries(obj.userData).sort(([a], [b]) => a.localeCompare(b))),
    position: normalizeZero(obj.position.toArray()),
    quaternion: normalizeZero(obj.quaternion.toArray()),
    scale: normalizeZero(obj.scale.toArray()),
    children: obj.children.map(serializeObject),
  }
  if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
    const geo = obj.geometry as THREE.BufferGeometry
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
    out.material = serializeMaterial(obj.material)
    out.geometry = {
      attributes: Object.keys(geo.attributes).sort(),
      position: pos ? digestArray(pos.array as Float32Array) : null,
      index: geo.index ? digestArray(geo.index.array as Uint32Array) : null,
    }
  }
  return out
}

/** The children of a module's group (the group itself is the viewport's). */
export function serializeGroup(group: THREE.Group): SerializedObject[] {
  return group.children.map(serializeObject)
}

// ── Editor scene ─────────────────────────────────────────────────────────────

export interface EditorScene {
  engine: EditorEngine
  vp: Viewport
  sphere: SphereMesh
  base: BaseMesh
  tail: TailMesh
  spiral: SpiralMesh
  flowCloud: FlowCloud
  cutGlue: CutGlueResult
  dispose: () => void
}

/**
 * Loads `preset` into the store, then builds the editor as the app does: an EditorEngine on a
 * canvas, with the renderer stub (tests/helpers/engine.ts) and FakeWorkers. installFakeWorker()
 * and installCanvas2dStub() must have been called.
 */
export function buildEditorScene(preset: CloudPreset): EditorScene {
  useCloudStore.getState().loadPreset(preset)
  const canvas = mountCanvas()
  const engine = new EditorEngine(canvas, { createRenderer: createRendererStub })
  return {
    engine,
    vp: engine.viewport,
    sphere: engine.spheres,
    base: engine.base,
    tail: engine.tail,
    spiral: engine.spirals,
    flowCloud: engine.flowCloud,
    cutGlue: engine.cutGlue,
    dispose() {
      engine.dispose()
      canvas.parentElement?.remove()
    },
  }
}

/** Runs the engine's Regenerate to completion (50 ms debounce, then the worker). */
export async function regenerateFlowCloud(scene: EditorScene): Promise<void> {
  const outcome = await scene.engine.regenerate()
  if (outcome.status !== 'done') throw new Error(`Regenerate ended ${outcome.status}`)
}

/**
 * Shows in `fc` what Regenerate would: the flow-cloud worker's reply to the request EditorEngine
 * builds from the store's preset. For a FlowCloud view built on its own.
 */
export async function showFlowCloud(fc: FlowCloud): Promise<void> {
  const { spheres, base, tail, flowCloud } = useCloudStore.getState().preset
  const request: FlowCloudRequest = { spheres, base, tail, flowCloud }
  const run = await runWorker<FlowCloudResult>('marchingCubes', request)
  fc.show(run.message)
}
