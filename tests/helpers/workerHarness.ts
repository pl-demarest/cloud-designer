import { vi } from 'vitest'

/**
 * Runs a real worker module in-process.
 *
 * Each worker is a thin shell over a pure core (src/workers/core) and the
 * src/geometry modules; none of them touches anything but `self.onmessage`,
 * `self.postMessage(msg, { transfer })` and `console`. The harness swaps
 * `globalThis.self` for a stub, imports the shell fresh (so its module graph's
 * top-level code runs again, as it would in a new Worker), delivers one
 * structured-cloned message and returns whatever the worker posted.
 *
 * Console output is silenced. Calls whose first argument starts with
 * "[spiralSDF" (the surface-mesh worker's former DEBUG_SPIRAL block and load
 * marker, removed in Stage B) are counted: the golden pins 0, so a debug log
 * that comes back fails it.
 */

export type WorkerName = 'marchingCubes' | 'cutAndGlue' | 'surfaceMesh'

const loaders: Record<WorkerName, () => Promise<unknown>> = {
  marchingCubes: () => import('../../src/workers/marchingCubes.worker.ts'),
  cutAndGlue: () => import('../../src/workers/cutAndGlue.worker.ts'),
  surfaceMesh: () => import('../../src/workers/surfaceMesh.worker.ts'),
}

export interface WorkerRun<T = Record<string, unknown>> {
  /** The single message the worker posted. */
  message: T
  /** The transfer list passed with it (empty when none was given). */
  transfer: Transferable[]
  /** console.log calls tagged "[spiralSDF". */
  spiralDebugLogs: number
  /** All other console.log / info / warn / error calls. */
  otherConsoleCalls: number
}

interface SelfStub {
  onmessage: ((e: { data: unknown }) => void) | null
  postMessage: (msg: unknown, opts?: { transfer?: Transferable[] } | Transferable[]) => void
}

export async function runWorker<T = Record<string, unknown>>(name: WorkerName, data: unknown): Promise<WorkerRun<T>> {
  const posted: Array<{ msg: unknown; transfer: Transferable[] }> = []
  const stub: SelfStub = {
    onmessage: null,
    postMessage(msg, opts) {
      const transfer = Array.isArray(opts) ? opts : (opts?.transfer ?? [])
      posted.push({ msg, transfer })
    },
  }

  let spiralDebugLogs = 0
  let otherConsoleCalls = 0
  const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[spiralSDF')) spiralDebugLogs++
    else otherConsoleCalls++
  })
  const others = (['info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {
      otherConsoleCalls++
    }),
  )

  const original = Object.getOwnPropertyDescriptor(globalThis, 'self')
  Object.defineProperty(globalThis, 'self', { value: stub, configurable: true, writable: true })
  try {
    vi.resetModules()
    await loaders[name]()
    if (typeof stub.onmessage !== 'function') throw new Error(`${name} worker did not install self.onmessage`)
    // A real postMessage structured-clones its payload; do the same so fixtures stay untouched.
    stub.onmessage({ data: structuredClone(data) })
  } finally {
    if (original) Object.defineProperty(globalThis, 'self', original)
    else delete (globalThis as { self?: unknown }).self
    log.mockRestore()
    for (const s of others) s.mockRestore()
  }

  if (posted.length !== 1) throw new Error(`${name} worker posted ${posted.length} messages, expected 1`)
  const [{ msg, transfer }] = posted
  return { message: msg as T, transfer, spiralDebugLogs, otherConsoleCalls }
}
