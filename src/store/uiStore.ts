import { create } from 'zustand';
import type { WorkerKind } from '../engine/workers';

/**
 * State the editor engine publishes for the panels: which worker jobs are running and whether a
 * Cut & Glue run has produced a surface mesh. The engine writes it; components read it.
 */
interface UiStore {
  /** Each worker's job is running: Regenerate shows "Working...", Cut & Glue "Generating...". */
  running: Record<WorkerKind, boolean>;
  /** A surface mesh exists, so the Surface Mesh checkbox can show it. */
  hasSurfaceMesh: boolean;

  setRunning: (kind: WorkerKind, running: boolean) => void;
  setHasSurfaceMesh: (hasSurfaceMesh: boolean) => void;
  /** Back to the state of an editor with no engine: nothing running, no surface mesh. */
  resetEngineState: () => void;
}

const IDLE: Record<WorkerKind, boolean> = { flowCloud: false, cutAndGlue: false, surfaceMesh: false };

export const useUiStore = create<UiStore>()((set) => ({
  running: IDLE,
  hasSurfaceMesh: false,

  setRunning: (kind, running) => set((s) => ({ running: { ...s.running, [kind]: running } })),
  setHasSurfaceMesh: (hasSurfaceMesh) => set({ hasSurfaceMesh }),
  resetEngineState: () => set({ running: IDLE, hasSurfaceMesh: false }),
}));
