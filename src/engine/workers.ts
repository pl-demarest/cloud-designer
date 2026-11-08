/**
 * The editor's three geometry workers and the factory that starts them. EditorEngine starts one
 * of each through a WorkerFactory; tests pass their own factory (or stub the global Worker).
 */

import type { WorkerKind } from '../workers/protocol';

export type WorkerFactory = (kind: WorkerKind) => Worker;

/** Starts a module worker. Vite bundles each worker from its literal `new Worker(new URL(...))`. */
export function createModuleWorker(kind: WorkerKind): Worker {
  switch (kind) {
    case 'flowCloud':
      return new Worker(new URL('../workers/marchingCubes.worker.ts', import.meta.url), { type: 'module' });
    case 'cutAndGlue':
      return new Worker(new URL('../workers/cutAndGlue.worker.ts', import.meta.url), { type: 'module' });
    case 'surfaceMesh':
      return new Worker(new URL('../workers/surfaceMesh.worker.ts', import.meta.url), { type: 'module' });
  }
}
