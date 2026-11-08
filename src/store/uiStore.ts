import { create } from 'zustand';
import type { WorkerKind } from '../engine/workers';
import { IDLE_JOB, type JobState } from '../engine/WorkerClient';

/**
 * State the editor engine publishes for the panels: each worker job's state (that of its latest
 * request, with the failure message when it failed) and whether a Cut & Glue run has produced a
 * surface mesh. The engine writes it; components read it.
 */
interface UiStore {
  /** Regenerate shows "Working..." while jobs.flowCloud runs; Cut & Glue shows "Generating..."
   *  while jobs.cutAndGlue or jobs.surfaceMesh runs. */
  jobs: Record<WorkerKind, JobState>;
  /** A surface mesh exists, so the Surface Mesh checkbox can show it. */
  hasSurfaceMesh: boolean;

  setJob: (kind: WorkerKind, job: JobState) => void;
  setHasSurfaceMesh: (hasSurfaceMesh: boolean) => void;
  /** Back to the state of an editor with no engine: every job idle, no surface mesh. */
  resetEngineState: () => void;
}

const IDLE_JOBS: Record<WorkerKind, JobState> = { flowCloud: IDLE_JOB, cutAndGlue: IDLE_JOB, surfaceMesh: IDLE_JOB };

export const useUiStore = create<UiStore>()((set) => ({
  jobs: IDLE_JOBS,
  hasSurfaceMesh: false,

  setJob: (kind, job) => set((s) => ({ jobs: { ...s.jobs, [kind]: job } })),
  setHasSurfaceMesh: (hasSurfaceMesh) => set({ hasSurfaceMesh }),
  resetEngineState: () => set({ jobs: IDLE_JOBS, hasSurfaceMesh: false }),
}));
