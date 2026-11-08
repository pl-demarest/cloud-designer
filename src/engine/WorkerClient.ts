import { IDLE_JOB, type JobState, type WorkerError } from '../workers/protocol';

/** How a request ended. 'superseded': a newer request replaced it before its reply was used. */
export type JobOutcome<Res> =
  | { status: 'done'; result: Res }
  | { status: 'failed'; error: string }
  | { status: 'superseded' };

export interface WorkerClientOptions<Req, Res> {
  /** Names the worker in error messages. */
  name: string;
  /** Receives the result of each request that is still the latest when its reply arrives. */
  onResult: (result: Res, request: Req, requestId: number) => void;
  /** Called on every change of the job state. */
  onState?: (state: JobState) => void;
}

interface Pending<Req, Res> {
  id: number;
  request: Req;
  settle: (outcome: JobOutcome<Res>) => void;
  /** cancel() ended it: its reply, when it comes, is dropped. */
  cancelled?: boolean;
}

/**
 * A typed client for a worker that answers each message with one reply, in order (the three
 * geometry workers do: a result, or { error } when the computation throws).
 *
 * Every request gets an id (1, 2, ...). The client keeps at most one request in flight, so the
 * worker's next reply belongs to it. A request made while one is in flight waits and is posted
 * when that one's reply arrives; a newer request replaces a waiting one, so the latest wins. A
 * reply to a request that a newer one has superseded is dropped. An { error } reply, or the
 * worker's error event once it has answered, fails the job with its message. An error event
 * before the worker's first answer means it failed to start (its script did not load; requests
 * posted while it loaded wait for it), and one with no request in flight means it died between
 * jobs: either way it will answer nothing, so the open requests and every request from then on
 * fail at once with that message. request() resolves with the outcome.
 * cancel() ends every open request at once (the editor's preset was replaced): the reply of the
 * one in flight is dropped when it comes, and a request made after waits for it.
 */
export class WorkerClient<Req, Res extends object> {
  private readonly worker: Worker;
  private readonly options: WorkerClientOptions<Req, Res>;
  private nextId = 1;
  private inFlight: Pending<Req, Res> | null = null;
  private waiting: Pending<Req, Res> | null = null;
  private current: JobState = IDLE_JOB;
  /** Why the worker cannot answer: it failed to start, or died between jobs. */
  private broken: string | null = null;
  /** The worker has answered once, so its script loaded and runs. */
  private started = false;

  constructor(worker: Worker, options: WorkerClientOptions<Req, Res>) {
    this.worker = worker;
    this.options = options;
    worker.onmessage = (e: MessageEvent<Res | WorkerError>) => {
      this.started = true;
      this.onReply(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      const error = e.message || `${options.name} worker failed`;
      if (this.inFlight && this.started) {
        // The job of a running worker failed; the worker takes the next one.
        this.onReply({ error });
        return;
      }
      // The worker failed to start, with or without requests waiting for it, or died between
      // jobs: it will answer nothing more.
      console.error(`${options.name} worker failed to start:`, error);
      this.broken = error;
      this.failOpenRequests(error);
    };
  }

  /** The latest request's state. */
  get state(): JobState {
    return this.current;
  }

  /** Sends `request`, or queues it behind the one in flight; returns how it ended. */
  request(request: Req): Promise<JobOutcome<Res>> {
    const id = this.nextId++;
    if (this.broken !== null) {
      const error = this.broken;
      this.setState({ status: 'failed', requestId: id, error });
      return Promise.resolve({ status: 'failed', error });
    }
    return new Promise((settle) => {
      const pending: Pending<Req, Res> = { id, request, settle };
      if (this.inFlight) {
        this.waiting?.settle({ status: 'superseded' });
        this.waiting = pending;
      } else {
        this.post(pending);
      }
      this.setState({ status: 'running', requestId: id, error: null });
    });
  }

  /**
   * Ends every request not yet answered as superseded, and drops the reply of the one in flight
   * when it comes (the worker cannot be stopped mid-computation; a later request waits for that
   * reply as usual). The job goes back to idle.
   */
  cancel(): void {
    this.waiting?.settle({ status: 'superseded' });
    this.waiting = null;
    if (this.inFlight) {
      this.inFlight.cancelled = true;
      this.inFlight.settle({ status: 'superseded' });
    }
    this.setState({ status: 'idle', requestId: this.current.requestId, error: null });
  }

  /** Detaches from the worker and terminates it; requests not yet answered end superseded. */
  dispose(): void {
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.inFlight?.settle({ status: 'superseded' });
    this.waiting?.settle({ status: 'superseded' });
    this.inFlight = null;
    this.waiting = null;
  }

  /**
   * Ends the requests a broken worker will not answer: the latest (the one waiting, else the one
   * in flight) fails with `error`, unless cancel() already ended it, and the one in flight before
   * a waiting one is superseded, as a newer request supersedes it.
   */
  private failOpenRequests(error: string): void {
    const { inFlight, waiting } = this;
    this.inFlight = null;
    this.waiting = null;
    if (waiting) inFlight?.settle({ status: 'superseded' });
    const latest = waiting ?? inFlight;
    if (!latest || latest.cancelled) return;
    this.setState({ status: 'failed', requestId: latest.id, error });
    latest.settle({ status: 'failed', error });
  }

  private post(pending: Pending<Req, Res>): void {
    this.inFlight = pending;
    this.worker.postMessage(pending.request);
  }

  private onReply(reply: Res | WorkerError): void {
    const answered = this.inFlight;
    if (!answered) return;
    this.inFlight = null;

    const next = this.waiting;
    if (next) {
      // A newer request is waiting: this reply is stale.
      this.waiting = null;
      answered.settle({ status: 'superseded' });
      this.post(next);
      return;
    }
    if (answered.cancelled) return;

    if ('error' in reply) {
      console.error(`${this.options.name} worker error:`, reply.error);
      this.setState({ status: 'failed', requestId: answered.id, error: reply.error });
      answered.settle({ status: 'failed', error: reply.error });
      return;
    }

    try {
      this.options.onResult(reply, answered.request, answered.id);
    } catch (err) {
      // A result the view cannot show fails the job rather than leaving it running.
      this.setState({ status: 'failed', requestId: answered.id, error: String(err) });
      answered.settle({ status: 'failed', error: String(err) });
      throw err;
    }
    this.setState({ status: 'done', requestId: answered.id, error: null });
    answered.settle({ status: 'done', result: reply });
  }

  private setState(state: JobState): void {
    this.current = state;
    this.options.onState?.(state);
  }
}
