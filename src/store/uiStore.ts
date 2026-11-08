import { create } from 'zustand';
import type { WorkerKind } from '../engine/workers';
import { IDLE_JOB, type JobState } from '../engine/WorkerClient';
import type { ViewFlags } from '../engine/visibility';

/** A message over the viewport, such as the outcome of an import. */
export interface Notice {
  tone: 'info' | 'error';
  text: string;
  /** A button beside the message. */
  action?: { label: string; run: () => void };
}

/**
 * Editor state outside the preset. The view flags (Edit/Preview and the toolbar and panel
 * toggles) are set by the components; the engine follows them (computeVisibility). The engine
 * publishes the rest for the panels: each worker job's state (that of its latest request, with
 * the failure message when it failed) and whether a Cut & Glue run has produced a surface mesh.
 */
interface UiStore extends ViewFlags {
  setMode: (mode: ViewFlags['mode']) => void;
  toggleAxes: () => void;
  toggleGrid: () => void;
  toggleFlowCloud: () => void;
  setSurfaceMeshVisible: (visible: boolean) => void;

  /** Regenerate shows "Working..." while jobs.flowCloud runs; Cut & Glue shows "Generating..."
   *  while jobs.cutAndGlue or jobs.surfaceMesh runs. */
  jobs: Record<WorkerKind, JobState>;
  /** A surface mesh exists, so the Surface Mesh checkbox can show it. */
  hasSurfaceMesh: boolean;

  setJob: (kind: WorkerKind, job: JobState) => void;
  setHasSurfaceMesh: (hasSurfaceMesh: boolean) => void;
  /** Back to the state of an editor with no engine: every job idle, no surface mesh. The view
   *  flags and the notice stay: a remounted engine shows what the toolbar says. */
  resetEngineState: () => void;

  /** The message the viewport shows, or null. A new notice replaces the one shown. */
  notice: Notice | null;
  showNotice: (notice: Notice) => void;
  dismissNotice: () => void;
}

const IDLE_JOBS: Record<WorkerKind, JobState> = { flowCloud: IDLE_JOB, cutAndGlue: IDLE_JOB, surfaceMesh: IDLE_JOB };

export const useUiStore = create<UiStore>()((set) => ({
  mode: 'edit',
  showAxes: true,
  showGrid: true,
  showFlowCloud: true,
  surfaceMeshVisible: false,

  setMode: (mode) => set({ mode }),
  toggleAxes: () => set((s) => ({ showAxes: !s.showAxes })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleFlowCloud: () => set((s) => ({ showFlowCloud: !s.showFlowCloud })),
  setSurfaceMeshVisible: (surfaceMeshVisible) => set({ surfaceMeshVisible }),

  jobs: IDLE_JOBS,
  hasSurfaceMesh: false,

  setJob: (kind, job) => set((s) => ({ jobs: { ...s.jobs, [kind]: job } })),
  setHasSurfaceMesh: (hasSurfaceMesh) => set({ hasSurfaceMesh }),
  resetEngineState: () => set({ jobs: IDLE_JOBS, hasSurfaceMesh: false }),

  notice: null,
  showNotice: (notice) => set({ notice }),
  dismissNotice: () => set({ notice: null }),
}));

/** The view flags in `state`. */
export function viewFlags(state: ViewFlags): ViewFlags {
  const { mode, showAxes, showGrid, showFlowCloud, surfaceMeshVisible } = state;
  return { mode, showAxes, showGrid, showFlowCloud, surfaceMeshVisible };
}
