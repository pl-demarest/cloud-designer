import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkerClient, type JobState } from '../../src/engine/WorkerClient'

/** A worker whose replies the test delivers by hand. */
class ScriptedWorker {
  posted: unknown[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(data: unknown): void {
    this.posted.push(data)
  }
  reply(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }
  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
  terminate(): void {
    this.terminated = true
  }
}

interface Req {
  n: number
}
interface Res {
  doubled: number
}

function client() {
  const worker = new ScriptedWorker()
  const results: Array<[Res, Req, number]> = []
  const states: JobState[] = []
  const c = new WorkerClient<Req, Res>(worker as unknown as Worker, {
    name: 'test',
    onResult: (res, req, id) => results.push([res, req, id]),
    onState: (s) => states.push(s),
  })
  return { c, worker, results, states }
}

afterEach(() => vi.restoreAllMocks())

describe('WorkerClient', () => {
  test('posts a request, numbers it, and hands its reply to onResult', async () => {
    const { c, worker, results, states } = client()
    expect(c.state).toEqual({ status: 'idle', requestId: 0, error: null })
    const outcome = c.request({ n: 2 })
    expect(worker.posted).toEqual([{ n: 2 }])
    expect(c.state).toEqual({ status: 'running', requestId: 1, error: null })
    worker.reply({ doubled: 4 })
    expect(await outcome).toEqual({ status: 'done', result: { doubled: 4 } })
    expect(results).toEqual([[{ doubled: 4 }, { n: 2 }, 1]])
    expect(states.map((s) => s.status)).toEqual(['running', 'done'])
    expect(c.state).toEqual({ status: 'done', requestId: 1, error: null })
  })

  test('a request made while one is in flight waits for its reply, then runs; the stale reply is dropped', async () => {
    const { c, worker, results } = client()
    const first = c.request({ n: 1 })
    const second = c.request({ n: 2 })
    expect(worker.posted, 'one request in flight at a time').toEqual([{ n: 1 }])
    expect(c.state).toEqual({ status: 'running', requestId: 2, error: null })

    worker.reply({ doubled: 2 })
    expect(await first).toEqual({ status: 'superseded' })
    expect(results, 'the reply to the superseded request is not used').toEqual([])
    expect(worker.posted).toEqual([{ n: 1 }, { n: 2 }])
    expect(c.state.status, 'still running: the latest request has no reply yet').toBe('running')

    worker.reply({ doubled: 4 })
    expect(await second).toEqual({ status: 'done', result: { doubled: 4 } })
    expect(results).toEqual([[{ doubled: 4 }, { n: 2 }, 2]])
    expect(c.state).toEqual({ status: 'done', requestId: 2, error: null })
  })

  test('of several requests made while one is in flight, only the latest runs', async () => {
    const { c, worker, results } = client()
    const outcomes = [c.request({ n: 1 }), c.request({ n: 2 }), c.request({ n: 3 }), c.request({ n: 4 })]
    worker.reply({ doubled: 2 })
    worker.reply({ doubled: 8 })
    expect(worker.posted).toEqual([{ n: 1 }, { n: 4 }])
    expect((await Promise.all(outcomes)).map((o) => o.status)).toEqual(['superseded', 'superseded', 'superseded', 'done'])
    expect(results).toEqual([[{ doubled: 8 }, { n: 4 }, 4]])
  })

  test('an { error } reply fails the job and the state carries the message', async () => {
    const { c, worker, results } = client()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const outcome = c.request({ n: 1 })
    worker.reply({ error: 'TypeError: boom' })
    expect(await outcome).toEqual({ status: 'failed', error: 'TypeError: boom' })
    expect(c.state).toEqual({ status: 'failed', requestId: 1, error: 'TypeError: boom' })
    expect(results).toEqual([])
    expect(error).toHaveBeenCalledWith('test worker error:', 'TypeError: boom')

    // The next request clears the failure.
    c.request({ n: 2 })
    expect(c.state).toEqual({ status: 'running', requestId: 2, error: null })
  })

  test("the worker's error event fails the in-flight request and lets a waiting one run", async () => {
    const { c, worker } = client()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = c.request({ n: 1 })
    worker.fail('Uncaught SyntaxError')
    expect(await first).toEqual({ status: 'failed', error: 'Uncaught SyntaxError' })
    expect(c.state.error).toBe('Uncaught SyntaxError')

    const second = c.request({ n: 2 })
    const third = c.request({ n: 3 })
    worker.fail('Uncaught SyntaxError')
    expect(await second, 'superseded: its failure is not reported').toEqual({ status: 'superseded' })
    expect(c.state).toEqual({ status: 'running', requestId: 3, error: null })
    expect(worker.posted).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    worker.reply({ doubled: 6 })
    expect(await third).toEqual({ status: 'done', result: { doubled: 6 } })
  })

  test('dispose() terminates the worker, detaches from it and ends open requests as superseded', async () => {
    const { c, worker, results } = client()
    const first = c.request({ n: 1 })
    const second = c.request({ n: 2 })
    c.dispose()
    expect(worker.terminated).toBe(true)
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    expect(await first).toEqual({ status: 'superseded' })
    expect(await second).toEqual({ status: 'superseded' })
    expect(results).toEqual([])
  })
})
