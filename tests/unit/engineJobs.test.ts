// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { FlowCloud } from '../../src/engine/views/FlowCloud'
import { useCloudStore } from '../../src/store/cloudStore'
import { useUiStore } from '../../src/store/uiStore'
import type { FlowCloudRequest, FlowCloudResult } from '../../src/workers/protocol'
import { createRendererStub, installCanvas2dStub, manualWorkers, mountCanvas, type ManualWorker } from '../helpers/engine'
import { createViewportStub } from '../helpers/scene'
import { digestArray } from '../helpers/digest'
import { runWorker } from '../helpers/workerHarness'
import type { WorkerKind } from '../../src/engine/workers'

/**
 * The engine's worker jobs (Regenerate, and Cut & Glue with its surface mesh), each through a
 * WorkerClient: a request made while one computes is not lost, a reply to a superseded request
 * is not shown, the uiStore's busy state follows the latest request, and a failure is kept with
 * its message. The workers here answer only when the test says so.
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
  view.show((await runWorker<FlowCloudResult>('marchingCubes', request)).message)
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
