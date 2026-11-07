import { describe, expect, test } from 'vitest'
import { digestArray, digestArrayList } from '../helpers/digest'
import { goldenSuite } from '../helpers/golden'
import { runWorker, type WorkerRun } from '../helpers/workerHarness'
import { FIXTURE_NAMES, fixture, marchingCubesMessage, surfaceMeshMessage } from '../fixtures/presets'

/**
 * Characterization goldens for the flow-cloud (marchingCubes) and surface-mesh
 * workers: every output array, the transfer list, and the surface-mesh worker's
 * debug log count, for every fixture. The cut-and-glue worker needs editor edge
 * buffers and is pinned in cutAndGlue.test.ts.
 */

/** Names each transferable by the output field whose buffer it is. */
function transferLabels(run: WorkerRun, fields: Record<string, ArrayBufferView | ArrayBufferView[]>): string[] {
  const byBuffer = new Map<unknown, string>()
  for (const [key, val] of Object.entries(fields)) {
    if (Array.isArray(val)) val.forEach((a, i) => byBuffer.set(a.buffer, `${key}[${i}]`))
    else byBuffer.set(val.buffer, key)
  }
  return run.transfer.map((t) => byBuffer.get(t) ?? 'unknown')
}

describe('marchingCubes worker', () => {
  const golden = goldenSuite('worker-marchingCubes')

  for (const name of FIXTURE_NAMES) {
    test(name, async () => {
      const run = await runWorker<{
        vertices: Float32Array
        indices: Uint32Array
        bands: Float32Array[]
        flowLines: Float32Array[]
      }>('marchingCubes', marchingCubesMessage(fixture(name)))
      const m = run.message
      golden.check(name, {
        keys: Object.keys(m),
        vertices: digestArray(m.vertices),
        indices: digestArray(m.indices),
        bands: digestArrayList(m.bands),
        flowLines: digestArrayList(m.flowLines),
        transfer: transferLabels(run, m),
        consoleCalls: run.otherConsoleCalls + run.spiralDebugLogs,
      })
    })
  }
})

describe('surfaceMesh worker', () => {
  const golden = goldenSuite('worker-surfaceMesh')

  for (const name of FIXTURE_NAMES) {
    test(name, async () => {
      const run = await runWorker<{ positions: Float32Array; indices: Uint32Array }>(
        'surfaceMesh',
        surfaceMeshMessage(fixture(name)),
      )
      const m = run.message
      golden.check(name, {
        keys: Object.keys(m),
        positions: digestArray(m.positions),
        indices: digestArray(m.indices),
        transfer: transferLabels(run, m),
        // Includes the module-load marker. Drops to 0 when DEBUG_SPIRAL is deleted.
        spiralDebugLogs: run.spiralDebugLogs,
        otherConsoleCalls: run.otherConsoleCalls,
      })
    })
  }
})

describe('worker error path', () => {
  const golden = goldenSuite('worker-errors')

  // Each worker catches its own exceptions and posts { error: String(err) }.
  test('marchingCubes posts an error message for a malformed request', async () => {
    const run = await runWorker('marchingCubes', { spheres: [], tail: { setpoints: [] }, flowCloud: null })
    golden.check('marchingCubes-null-flowCloud', { keys: Object.keys(run.message), transfer: run.transfer.length })
  })

  test('surfaceMesh posts an error message for a malformed request', async () => {
    const run = await runWorker('surfaceMesh', { spheres: null })
    golden.check('surfaceMesh-null-spheres', { keys: Object.keys(run.message), transfer: run.transfer.length })
  })

  // Until Stage B the cut-and-glue worker had no try/catch: the exception escaped onmessage, so
  // runWorker rejected and the app saw only Worker.onerror. Plain assertions, no baseline entry.
  test('cutAndGlue posts an error message for a malformed request', async () => {
    const run = await runWorker<{ error: string }>('cutAndGlue', { spheres: null })
    expect(Object.keys(run.message)).toEqual(['error'])
    expect(run.message.error).toMatch(/^TypeError: /)
    expect(run.transfer).toHaveLength(0)
  })
})
