// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { EditorEngine } from '../../src/engine/EditorEngine'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { useUiStore } from '../../src/store/uiStore'
import { AUTOSAVE_KEY, restoreAutosave, writeAutosave } from '../../src/store/autosave'
import { importPresetFile } from '../../src/ui/importPreset'
import { confirmAndResetPreset } from '../../src/ui/resetPreset'
import { DEFAULT_PRESET } from '../../src/model/defaults'
import { fullScene, wireframeScene, type ExportSources } from '../../src/export/scenes'
import type { SurfaceMeshRequest } from '../../src/workers/protocol'
import type { WorkerKind } from '../../src/workers/protocol'
import { createRendererStub, installCanvas2dStub, manualWorkers, mountCanvas, type ManualWorker } from '../helpers/engine'

/**
 * Replacing the whole preset (Reset, Import, Discard, the autosave restore) drops what was
 * generated from the cloud before: the flow cloud, the inputs the surface mesh would union, the
 * clipped wireframe and the surface mesh (refactor plan D15). Single edits, undo and redo keep
 * them until the next Regenerate or Cut & Glue.
 */

const store = () => useCloudStore.getState()

/** Past Regenerate's 50 ms debounce. */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 70))

let engine: EditorEngine
let workers: Record<WorkerKind, ManualWorker>

beforeAll(() => installCanvas2dStub())

beforeEach(async () => {
  store().resetToDefault()
  useHistoryStore.getState().clear()
  store().commit()
  useUiStore.setState(useUiStore.getInitialState())
  window.localStorage.clear()
  const manual = manualWorkers()
  workers = manual.workers
  engine = new EditorEngine(mountCanvas(), { createRenderer: createRendererStub, createWorker: manual.createWorker })
  // Generate everything: a Regenerate, then a Cut & Glue with its surface mesh.
  void engine.regenerate()
  await pastDebounce()
  await workers.flowCloud.answer()
  void engine.cutAndGlue()
  await workers.cutAndGlue.answer()
  await workers.surfaceMesh.answer()
  expect(generated(), 'everything generated').toEqual({ flowCloud: true, clipped: true, surfaceMesh: true, wireframeExport: true, fullHasWireframe: true })
})

afterEach(() => {
  engine.dispose()
  Reflect.deleteProperty(window, 'confirm')
})

/** Answers Reset's question; happy-dom has no window.confirm. */
function answerConfirm(answer: boolean): void {
  Object.assign(window, { confirm: vi.fn().mockReturnValue(answer) })
}

function sources(): ExportSources {
  return { ...engine.scaffoldGroups(), flowCloud: engine.viewport.flowCloudGroup }
}

/** What is generated, as the viewport and the exports see it. */
function generated() {
  const flowCloudObjects = engine.viewport.flowCloudGroup.children.filter((c) => !c.userData.editorOnly)
  return {
    flowCloud: flowCloudObjects.length > 0,
    clipped: engine.cutGlue.getEdges().length > 0,
    surfaceMesh: engine.cutGlue.hasSurfaceMesh() && useUiStore.getState().hasSurfaceMesh,
    wireframeExport: wireframeScene(sources()) !== null,
    fullHasWireframe: fullScene(sources())?.getObjectByName('wireframe') !== undefined,
  }
}

const NOTHING = { flowCloud: false, clipped: false, surfaceMesh: false, wireframeExport: false, fullHasWireframe: false }
const EVERYTHING = { flowCloud: true, clipped: true, surfaceMesh: true, wireframeExport: true, fullHasWireframe: true }

/** The surface-mesh request of a Cut & Glue run now. */
async function nextSurfaceMeshRequest(): Promise<SurfaceMeshRequest> {
  void engine.cutAndGlue()
  const request = workers.surfaceMesh.posted.at(-1) as SurfaceMeshRequest
  await workers.cutAndGlue.answer()
  await workers.surfaceMesh.answer()
  return request
}

function presetFile(): File {
  const p = structuredClone(DEFAULT_PRESET)
  p.name = 'One sphere'
  p.spheres = [p.spheres[0]]
  return new File([JSON.stringify(p)], 'one.json', { type: 'application/json' })
}

describe('a replacement of the whole preset drops what was generated', () => {
  test('Reset (confirmed)', async () => {
    answerConfirm(true)
    store().updateSphere('sphere-1', { radius: 2 })
    confirmAndResetPreset()
    expect(generated()).toEqual(NOTHING)
    const request = await nextSurfaceMeshRequest()
    expect(request.includeFlowCloud, 'the surface mesh no longer unions the old flow cloud').toBe(false)
    expect(request.flowCloudInput).toBeNull()
  })

  test('Reset that is not confirmed keeps them', () => {
    answerConfirm(false)
    confirmAndResetPreset()
    expect(generated()).toEqual(EVERYTHING)
  })

  test('Import', async () => {
    await importPresetFile(presetFile())
    expect(store().preset.spheres).toHaveLength(1)
    expect(generated()).toEqual(NOTHING)
    expect((await nextSurfaceMeshRequest()).flowCloudInput).toBeNull()
  })

  test('an Import that is refused keeps them', async () => {
    await importPresetFile(new File(['not json'], 'bad.json'))
    expect(generated()).toEqual(EVERYTHING)
  })

  test('Discard (autosave)', async () => {
    const saved = structuredClone(DEFAULT_PRESET)
    saved.name = 'Saved'
    writeAutosave(window.localStorage, saved)
    expect(restoreAutosave(window.localStorage)).toBe(true)
    // Generate again on the restored cloud, then Discard it.
    void engine.regenerate()
    await pastDebounce()
    await workers.flowCloud.answer()
    void engine.cutAndGlue()
    await workers.cutAndGlue.answer()
    await workers.surfaceMesh.answer()
    expect(generated()).toEqual(EVERYTHING)
    useUiStore.getState().notice!.action!.run()
    expect(store().preset.name).toBe(DEFAULT_PRESET.name)
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull()
    expect(generated()).toEqual(NOTHING)
  })

  test('the autosave restore', () => {
    const saved = structuredClone(DEFAULT_PRESET)
    saved.name = 'Saved'
    writeAutosave(window.localStorage, saved)
    restoreAutosave(window.localStorage)
    expect(store().preset.name).toBe('Saved')
    expect(generated()).toEqual(NOTHING)
  })
})

describe('single edits, undo and redo keep what was generated', () => {
  test('a single edit', () => {
    store().updateSphere('sphere-1', { radius: 2 })
    store().commit()
    expect(generated()).toEqual(EVERYTHING)
  })

  test('undo and redo, also of an Import', async () => {
    store().updateSphere('sphere-1', { radius: 2 })
    store().commit()
    store().undo()
    expect(generated()).toEqual(EVERYTHING)
    store().redo()
    expect(generated()).toEqual(EVERYTHING)

    await importPresetFile(presetFile())
    void engine.regenerate()
    await pastDebounce()
    await workers.flowCloud.answer()
    store().undo() // back to the cloud before the Import
    expect(store().preset.spheres).toHaveLength(3)
    expect(generated().flowCloud, 'undo keeps the flow cloud generated after the Import').toBe(true)
    store().redo()
    expect(generated().flowCloud).toBe(true)
  })
})

describe('a job started before a replacement shows nothing after it', () => {
  test('a Regenerate in flight when an Import replaces the preset: its reply is dropped', async () => {
    void engine.regenerate()
    await pastDebounce() // posted, not answered
    expect(workers.flowCloud.unanswered).toBe(1)
    await importPresetFile(presetFile())
    expect(generated()).toEqual(NOTHING)
    await workers.flowCloud.answer() // the three-sphere cloud of the preset before
    expect(generated().flowCloud, 'the old flow cloud is not shown over the imported preset').toBe(false)
    expect(useUiStore.getState().jobs.flowCloud.status).not.toBe('running')
    // The next Regenerate runs and shows the imported cloud.
    void engine.regenerate()
    await pastDebounce()
    await workers.flowCloud.answer()
    expect(generated().flowCloud).toBe(true)
    expect(workers.flowCloud.posted.at(-1)).toMatchObject({ spheres: [{ id: 'sphere-0' }] })
  })

  test('a Cut & Glue in flight when Reset replaces the preset: neither reply is shown', async () => {
    answerConfirm(true)
    void engine.cutAndGlue()
    confirmAndResetPreset()
    await workers.cutAndGlue.answer()
    await workers.surfaceMesh.answer()
    expect(generated()).toEqual(NOTHING)
    const jobs = useUiStore.getState().jobs
    expect([jobs.cutAndGlue.status, jobs.surfaceMesh.status]).toEqual(['idle', 'idle'])
  })
})

describe('an autosave holding a huge base point (cd:explore CDX-01)', () => {
  test('restores clamped, and the editor mounts on it', () => {
    const hostile = structuredClone(DEFAULT_PRESET)
    hostile.base.controlPoints[1] = [1e200, -1, 0.3]
    window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), preset: hostile }))
    engine.dispose()
    expect(restoreAutosave(window.localStorage)).toBe(true)
    expect(store().preset.base.controlPoints[1][0]).toBe(50)
    // Before D11 the engine mount threw from the curve code, and every reload left the page blank.
    const manual = manualWorkers()
    workers = manual.workers
    engine = new EditorEngine(mountCanvas(), { createRenderer: createRendererStub, createWorker: manual.createWorker })
    expect(engine.base.getEdges().every(Number.isFinite)).toBe(true)
  })
})
