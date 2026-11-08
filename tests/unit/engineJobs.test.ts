// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { FlowCloud } from '../../src/engine/views/FlowCloud'
import { useCloudStore } from '../../src/store/cloudStore'
import { useUiStore } from '../../src/store/uiStore'
import type { CutGlueRequest, FlowCloudRequest, FlowCloudResult, SurfaceMeshRequest, SurfaceMeshResult } from '../../src/workers/protocol'
import { createRendererStub, installCanvas2dStub, manualWorkers, mountCanvas, type ManualWorker } from '../helpers/engine'
import { createViewportStub } from '../helpers/scene'
import { fixture } from '../fixtures/presets'
import { digestArray } from '../helpers/digest'
import { runWorker } from '../helpers/workerHarness'
import type { WorkerKind } from '../../src/engine/workers'

/**
 * The engine's worker jobs (Regenerate, and Cut & Glue with its surface mesh), each through a
 * WorkerClient: a request made while one computes is not lost, a reply to a superseded request
 * is not shown, the uiStore's busy state follows the latest request, and a failure is kept with
 * its message. The surface mesh unions the flow cloud the viewport shows. The workers here answer
 * only when the test says so.
 */

const store = () => useCloudStore.getState()
const job = (kind: WorkerKind) => useUiStore.getState().jobs[kind]

/** Past Regenerate's 50 ms debounce. */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 70))

let engine: EditorEngine | null = null
let workers: Record<WorkerKind, ManualWorker>

beforeAll(() => installCanvas2dStub())

beforeEach(() => {
  store().resetToDefault()
  useUiStore.setState(useUiStore.getInitialState())
  const manual = manualWorkers()
  workers = manual.workers
  engine = new EditorEngine(mountCanvas(), { createRenderer: createRendererStub, createWorker: manual.createWorker })
})

afterEach(() => {
  engine?.dispose()
  engine = null
})

/** What a FlowCloud view shows for the flow-cloud worker's reply to `request`. */
async function edgesShownFor(request: FlowCloudRequest): Promise<ReturnType<typeof digestArray>> {
  const view = new FlowCloud(createViewportStub())
  view.show((await runWorker<FlowCloudResult>('marchingCubes', request)).message, request.flowCloud.wireframe.mode)
  const edges = digestArray(view.getEdges())
  view.dispose()
  return edges
}

describe('Regenerate', () => {
  test('fc-regen-dropped-while-pending: a Regenerate made while one computes runs when that one finishes', async () => {
    const e = engine!
    const fc = workers.flowCloud
    const first = e.regenerate()
    await pastDebounce()
    expect(fc.posted).toHaveLength(1)

    store().setFlowCloud({ threshold: 0.8 })
    const second = e.regenerate()
    await pastDebounce()
    await fc.answer() // the first request's reply
    const thresholds = fc.posted.map((r) => (r as FlowCloudRequest).flowCloud.threshold)
    expect(thresholds, 'the second Regenerate reaches the worker').toEqual([1, 0.8])
    expect(digestArray(e.flowCloud.getEdges()).length, "the superseded request's reply is not shown").toBe(0)
    expect(job('flowCloud').status, 'busy until the latest request is answered').toBe('running')

    await fc.answer()
    expect(job('flowCloud')).toEqual({ status: 'done', requestId: 2, error: null })
    expect(await first).toEqual({ status: 'superseded' })
    expect((await second).status).toBe('done')
    expect(digestArray(e.flowCloud.getEdges())).toEqual(await edgesShownFor(fc.posted[1] as FlowCloudRequest))
  })

  test('calls within 50 ms send one request, with the preset as it is then', async () => {
    const e = engine!
    const first = e.regenerate()
    store().setFlowCloud({ threshold: 0.9 })
    const second = e.regenerate()
    expect(await first).toEqual({ status: 'superseded' })
    await pastDebounce()
    expect(workers.flowCloud.posted).toHaveLength(1)
    expect((workers.flowCloud.posted[0] as FlowCloudRequest).flowCloud.threshold).toBe(0.9)
    await workers.flowCloud.answer()
    expect((await second).status).toBe('done')
  })

  test('an { error } reply fails the job; the uiStore keeps the message until the next request', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const e = engine!
    const outcome = e.regenerate()
    await pastDebounce()
    workers.flowCloud.reply({ error: 'TypeError: boom' })
    expect(await outcome).toEqual({ status: 'failed', error: 'TypeError: boom' })
    expect(job('flowCloud')).toEqual({ status: 'failed', requestId: 1, error: 'TypeError: boom' })
    expect(error).toHaveBeenCalledWith('flowCloud worker error:', 'TypeError: boom')

    void e.regenerate()
    await pastDebounce()
    expect(job('flowCloud')).toEqual({ status: 'running', requestId: 2, error: null })
    error.mockRestore()
  })
})

describe('Cut & Glue', () => {
  test('a run started while one computes: the stale replies are not shown and the busy state lasts until the latest is done', async () => {
    const e = engine!
    void e.cutAndGlue()
    store().addSphere()
    const latest = e.cutAndGlue()

    await workers.cutAndGlue.answer()
    await workers.surfaceMesh.answer()
    expect(e.cutGlue.getEdges().length, 'a superseded reply is not shown').toBe(0)
    expect(useUiStore.getState().hasSurfaceMesh).toBe(false)
    expect(job('cutAndGlue').status).toBe('running')
    expect(job('surfaceMesh').status).toBe('running')
    expect(workers.cutAndGlue.posted).toHaveLength(2)
    expect(workers.surfaceMesh.posted).toHaveLength(2)

    await workers.cutAndGlue.answer()
    await workers.surfaceMesh.answer()
    const [cut, surface] = await latest
    expect([cut.status, surface.status]).toEqual(['done', 'done'])
    expect(e.cutGlue.getEdges().length).toBeGreaterThan(0)
    expect(useUiStore.getState().hasSurfaceMesh).toBe(true)
    expect(job('cutAndGlue')).toEqual({ status: 'done', requestId: 2, error: null })
    expect(job('surfaceMesh')).toEqual({ status: 'done', requestId: 2, error: null })
    // The latest request carries the sphere added between the two runs.
    expect((workers.surfaceMesh.posted[1] as { spheres: unknown[] }).spheres).toHaveLength(4)
  })
})

describe('dispose during a job', () => {
  test('terminates the workers, ends open requests superseded and leaves every job idle', async () => {
    const e = engine!
    const pending = e.regenerate()
    const cut = e.cutAndGlue()
    expect(job('cutAndGlue').status).toBe('running')
    e.dispose()
    engine = null
    expect(await pending).toEqual({ status: 'superseded' })
    expect((await cut).map((o) => o.status)).toEqual(['superseded', 'superseded'])
    for (const kind of ['flowCloud', 'cutAndGlue', 'surfaceMesh'] as const) {
      expect(workers[kind].terminated, kind).toBe(true)
      expect(job(kind).status, kind).toBe('idle')
    }
    await pastDebounce()
    expect(workers.flowCloud.posted, 'the debounced request never went out').toHaveLength(0)
  })
})

describe("the surface mesh's flow cloud", () => {
  /** The default preset with the flow cloud moved 6 up, clear of every other primitive. */
  function liftedFlowCloud() {
    const p = fixture('default')
    p.flowCloud.position = [0, 6, 0]
    p.surfaceMeshResolution = 32
    return p
  }

  /** The vertices above `minY` (above y = 4 only the lifted flow cloud reaches): count and x range. */
  function above(positions: Float32Array, minY: number): { count: number; minX: number; maxX: number } {
    let count = 0
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 1] > minY) {
        count++
        minX = Math.min(minX, positions[i])
        maxX = Math.max(maxX, positions[i])
      }
    }
    return { count, minX, maxX }
  }
  const above4 = (positions: Float32Array) => above(positions, 4)

  async function surfaceMesh(): Promise<{ request: SurfaceMeshRequest; positions: Float32Array }> {
    void engine!.cutAndGlue()
    const sm = workers.surfaceMesh
    await sm.answer()
    return {
      request: sm.posted.at(-1) as SurfaceMeshRequest,
      positions: (sm.replies.at(-1) as SurfaceMeshResult).positions,
    }
  }

  async function regenerate(): Promise<FlowCloudResult> {
    void engine!.regenerate()
    await pastDebounce()
    await workers.flowCloud.answer()
    return workers.flowCloud.replies.at(-1) as FlowCloudResult
  }

  test('flowcloud-always-unioned-live: before any Regenerate the union has no flow cloud', async () => {
    store().loadPreset(liftedFlowCloud())
    const { request, positions } = await surfaceMesh()
    expect(above4(positions).count, 'no flow cloud above the scaffold').toBe(0)
    expect(positions.length).toBeGreaterThan(0)
    expect(request.includeFlowCloud).toBe(false)
    expect(request.flowCloudInput).toBeNull()
  })

  test('after Regenerate the union holds the flow cloud as generated, not as the live spheres would make it', async () => {
    store().loadPreset(liftedFlowCloud())
    const generated = await regenerate()
    const generatedSpheres = structuredClone(store().preset.spheres)
    store().updateSphere('sphere-0', { position: [3, 0, 0] }) // after the Regenerate
    const { request, positions } = await surfaceMesh()

    // The shown flow cloud's x range against that of the surface mesh's part above y = 4. Measured:
    // shown -2.307 to 2.375, union -2.318 to 2.410; from the live spheres the union reached 3.915.
    const shown = above(generated.vertices, -Infinity)
    const blob = above4(positions)
    expect(blob.count).toBeGreaterThan(100)
    expect(Math.abs(blob.minX - shown.minX), `min x ${blob.minX} against the shown ${shown.minX}`).toBeLessThan(0.15)
    expect(Math.abs(blob.maxX - shown.maxX), `max x ${blob.maxX} against the shown ${shown.maxX}`).toBeLessThan(0.15)
    expect(request.includeFlowCloud).toBe(true)
    expect(request.flowCloudInput?.spheres).toEqual(generatedSpheres)
    expect(request.spheres[0].position, 'the live spheres still mesh where they are').toEqual([3, 0, 0])
  })

  test('Show/Hide decides; the Edit/Preview mode does not', async () => {
    store().loadPreset(liftedFlowCloud())
    await regenerate()
    useUiStore.getState().toggleFlowCloud() // Hide
    const hidden = await surfaceMesh()
    expect(above4(hidden.positions).count, 'a hidden flow cloud is left out').toBe(0)
    expect(hidden.request.includeFlowCloud).toBe(false)

    useUiStore.getState().toggleFlowCloud() // Show
    useUiStore.getState().setMode('preview')
    const shown = await surfaceMesh()
    expect(above4(shown.positions).count).toBeGreaterThan(100)
    expect(shown.request.includeFlowCloud).toBe(true)
  })
})

describe('Cut & Glue and the flow cloud follow the toggles, not what the viewport shows', () => {
  async function regenerate(): Promise<void> {
    void engine!.regenerate()
    await pastDebounce()
    await workers.flowCloud.answer()
  }

  /** The flow-cloud edges of the Cut & Glue request the engine posts now. */
  async function cutGlueFlowCloudEdges(): Promise<Float32Array> {
    void engine!.cutAndGlue()
    const cg = workers.cutAndGlue
    const request = cg.posted.at(-1) as CutGlueRequest
    await cg.answer()
    await workers.surfaceMesh.answer()
    return request.flowCloudEdges
  }

  const wireframe = () => store().preset.flowCloud.wireframe
  const setWireframe = (patch: Partial<ReturnType<typeof wireframe>>) => store().setFlowCloud({ wireframe: { ...wireframe(), ...patch } })

  test('cut-glue-in-preview: Cut & Glue started in Preview gets the flow-cloud edges it gets in Edit', async () => {
    setWireframe({ generateBands: true })
    await regenerate()
    const edit = await cutGlueFlowCloudEdges()
    expect(edit.length, 'bands and flow lines').toBeGreaterThan(0)
    useUiStore.getState().setMode('preview')
    const preview = await cutGlueFlowCloudEdges()
    expect(digestArray(preview)).toEqual(digestArray(edit))
  })

  test('Show/Hide, Show Bands and Show Flow Lines decide which flow-cloud edges Cut & Glue gets, in either mode', async () => {
    setWireframe({ generateBands: true })
    await regenerate()
    const all = (await cutGlueFlowCloudEdges()).length
    setWireframe({ showFlowLines: false })
    const bands = (await cutGlueFlowCloudEdges()).length
    setWireframe({ showFlowLines: true, showBands: false })
    useUiStore.getState().setMode('preview')
    const lines = (await cutGlueFlowCloudEdges()).length
    expect(bands).toBeGreaterThan(0)
    expect(lines).toBeGreaterThan(0)
    expect(bands + lines).toBe(all)
    useUiStore.getState().toggleFlowCloud() // Hide
    expect((await cutGlueFlowCloudEdges()).length, 'a hidden flow cloud gives none').toBe(0)
  })

  test('mc-flowlines-gated-on-visibility: after a Regenerate with Show Flow Lines off, turning it on shows the flow lines', async () => {
    setWireframe({ showFlowLines: false })
    await regenerate()
    const result = workers.flowCloud.replies.at(-1) as FlowCloudResult
    expect(result.flowLines.length, 'the Regenerate computed them').toBeGreaterThan(0)
    const flowLines = engine!.viewport.flowCloudGroup.getObjectByName('flowLines')!
    expect(flowLines.visible).toBe(false)
    setWireframe({ showFlowLines: true })
    expect(flowLines.visible).toBe(true)
    expect(flowLines.children.length).toBe(result.flowLines.length)
    expect(workers.flowCloud.posted, 'no new Regenerate').toHaveLength(1)
  })

  test('Generate Bands stays a generation option: off, the Regenerate computes no bands', async () => {
    setWireframe({ generateBands: false })
    await regenerate()
    expect((workers.flowCloud.replies.at(-1) as FlowCloudResult).bands).toHaveLength(0)
  })
})

describe('a flow cloud is drawn in the mode its Regenerate computed it for (cd:explore CDX-09, cd:review CDR-03)', () => {
  async function regenerateThenSwitch(from: 'edges' | 'spiral', to: 'edges' | 'spiral'): Promise<void> {
    const wf = store().preset.flowCloud.wireframe
    // Resolution 32: at 64 the default cloud has no crease above 15 degrees (CDX-10).
    store().setFlowCloud({ resolution: 32, wireframe: { ...wf, mode: from } })
    void engine!.regenerate()
    await pastDebounce()
    store().setFlowCloud({ wireframe: { ...store().preset.flowCloud.wireframe, mode: to } }) // before the reply
    await workers.flowCloud.answer()
  }
  const drawn = () => {
    const objects = engine!.viewport.flowCloudGroup.children.filter((c) => !c.userData.editorOnly)
    return { objects: objects.map((o) => o.name || o.type), vertices: engine!.flowCloud.getEdges().length / 3 }
  }

  test('Regenerate in Edges, Mode switched to Spiral before the reply: the crease edges are drawn', async () => {
    await regenerateThenSwitch('edges', 'spiral')
    expect(drawn().objects).toEqual(['LineSegments'])
    expect(drawn().vertices).toBeGreaterThan(0)
  })

  test('Regenerate in Spiral, Mode switched to Edges before the reply: the flow lines are drawn', async () => {
    await regenerateThenSwitch('spiral', 'edges')
    expect(drawn().objects).toEqual(['spiralGroup'])
    const flowLines = engine!.viewport.flowCloudGroup.getObjectByName('flowLines')!
    expect(flowLines.children.length).toBe((workers.flowCloud.replies.at(-1) as FlowCloudResult).flowLines.length)
    expect(drawn().vertices).toBeGreaterThan(0)
  })
})

describe('the Surface Mesh box follows whether a surface mesh exists (cd:review CDR-08)', () => {
  test('a Cut & Glue whose surface mesh comes back empty unchecks the box, and Preview shows the clipped wireframe', async () => {
    void engine!.cutAndGlue()
    await workers.cutAndGlue.answer()
    await workers.surfaceMesh.answer()
    useUiStore.getState().setSurfaceMeshVisible(true)
    useUiStore.getState().setMode('preview')
    void engine!.cutAndGlue()
    await workers.cutAndGlue.answer()
    workers.surfaceMesh.reply({ positions: new Float32Array(0), indices: new Uint32Array(0) })
    const ui = useUiStore.getState()
    expect(ui.hasSurfaceMesh).toBe(false)
    expect(ui.surfaceMeshVisible, 'the box is not left checked and disabled').toBe(false)
    const shown = engine!.viewport.cutGlueGroup.children.filter((c) => c.visible)
    expect(shown, 'the clipped wireframe shows').toHaveLength(1)
  })

  test('the engine going away unchecks it too, and leaves no surface mesh behind', () => {
    useUiStore.getState().setHasSurfaceMesh(true)
    useUiStore.getState().setSurfaceMeshVisible(true)
    engine!.dispose()
    expect(useUiStore.getState().surfaceMeshVisible).toBe(false)
    expect(useUiStore.getState().hasSurfaceMesh, 'cd:review CDR-16').toBe(false)
    engine = null
  })
})
