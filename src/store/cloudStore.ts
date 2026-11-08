import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { CloudPreset, SphereDef, BaseDef, TailDef, SpiralDef, FlowCloudSettings } from '../model/types';
import { DEFAULT_PRESET, makeTailSetpoint } from '../model/defaults';
import { normalizePreset } from '../model/normalize';
import { sameValue } from '../engine/sameValue';
import { useHistoryStore } from './historyStore';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface CloudStore {
  preset: CloudPreset;

  // Sphere actions
  addSphere: () => void;
  updateSphere: (id: string, patch: Partial<SphereDef>) => void;
  removeSphere: (id: string) => void;
  /** Moves the sphere at `fromIdx` to `toIdx`; a no-op unless both are indices of the list. */
  reorderSpheres: (fromIdx: number, toIdx: number) => void;

  // Base actions
  setBase: (patch: Partial<BaseDef>) => void;
  addBasePoint: () => void;
  removeBasePoint: (idx: number) => void;
  updateBasePoint: (idx: number, pos: [number, number, number]) => void;

  // Tail actions
  setTail: (patch: Partial<TailDef>) => void;
  /** Inserts a setpoint after `afterIdx` (clamped to the list; default the last), or the first
   *  setpoint of an empty tail. */
  addTailSetpoint: (afterIdx?: number) => void;
  removeTailSetpoint: (id: string) => void;
  updateTailSetpoint: (id: string, patch: { position?: [number, number, number]; width?: number }) => void;

  // Spiral actions
  addSpiral: () => void;
  updateSpiral: (id: string, patch: Partial<SpiralDef>) => void;
  removeSpiral: (id: string) => void;

  // Flow cloud actions
  setFlowCloud: (patch: Partial<FlowCloudSettings>) => void;

  // Surface mesh
  setSurfaceMeshResolution: (resolution: number) => void;

  // Preset actions
  /** Replaces the preset with normalizePreset(preset): current version, every field set. */
  loadPreset: (preset: unknown) => void;
  resetToDefault: () => void;
  setPresetName: (name: string) => void;

  // History (the snapshots live in historyStore)
  /** A continuous edit (a slider or a viewport drag) is in progress: commit() waits for its end. */
  gestureActive: boolean;
  /**
   * Records the preset as it is now as one undo step. Skipped when it equals the newest step,
   * and deferred while a gesture is in progress (endGesture commits). Call it after an edit.
   */
  commit: () => void;
  /** Starts a continuous edit; the edits until endGesture() become one undo step. */
  beginGesture: () => void;
  /** Ends the continuous edit and commits it. */
  endGesture: () => void;
  /** Steps back: commits an edit not yet recorded (ending a gesture), then applies the previous step. */
  undo: () => void;
  /** Steps forward to the next step, if no new edit has been made since the undo. */
  redo: () => void;
}

export const useCloudStore = create<CloudStore>()(
  subscribeWithSelector((set, get) => ({
    preset: structuredClone(DEFAULT_PRESET),

    addSphere: () =>
      set((s) => {
        const last = s.preset.spheres[s.preset.spheres.length - 1];
        const pos: [number, number, number] = last
          ? [last.position[0] + 1.2, last.position[1], last.position[2]]
          : [0, 0, 0];
        const newSphere: SphereDef = {
          id: `sphere-${nanoid()}`,
          position: pos,
          radius: 1.0,
          falloff: 0.5,
          shape: 'sphere',
          scale: [1, 1, 1],
          rotation: [0, 0, 0],
          half: false,
        };
        return { preset: { ...s.preset, spheres: [...s.preset.spheres, newSphere] } };
      }),

    updateSphere: (id, patch) =>
      set((s) => ({
        preset: {
          ...s.preset,
          spheres: s.preset.spheres.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)),
        },
      })),

    removeSphere: (id) =>
      set((s) => ({
        preset: { ...s.preset, spheres: s.preset.spheres.filter((sp) => sp.id !== id) },
      })),

    reorderSpheres: (fromIdx, toIdx) =>
      set((s) => {
        const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < s.preset.spheres.length;
        if (!inRange(fromIdx) || !inRange(toIdx)) return s;
        const spheres = [...s.preset.spheres];
        const [item] = spheres.splice(fromIdx, 1);
        spheres.splice(toIdx, 0, item);
        return { preset: { ...s.preset, spheres } };
      }),

    setBase: (patch) =>
      set((s) => ({
        preset: { ...s.preset, base: { ...s.preset.base, ...patch } },
      })),

    addBasePoint: () =>
      set((s) => {
        const pts = s.preset.base.controlPoints;
        const last = pts[pts.length - 1] ?? [0, 0, 0];
        const newPt: [number, number, number] = [last[0] + 1, last[1], last[2]];
        return {
          preset: {
            ...s.preset,
            base: { ...s.preset.base, controlPoints: [...pts, newPt] },
          },
        };
      }),

    removeBasePoint: (idx) =>
      set((s) => {
        const pts = s.preset.base.controlPoints.filter((_, i) => i !== idx);
        return { preset: { ...s.preset, base: { ...s.preset.base, controlPoints: pts } } };
      }),

    updateBasePoint: (idx, pos) =>
      set((s) => {
        const pts = s.preset.base.controlPoints.map((p, i) => (i === idx ? pos : p));
        return { preset: { ...s.preset, base: { ...s.preset.base, controlPoints: pts } } };
      }),

    setTail: (patch) =>
      set((s) => ({
        preset: { ...s.preset, tail: { ...s.preset.tail, ...patch } },
      })),

    addTailSetpoint: (afterIdx) =>
      set((s) => {
        const pts = s.preset.tail.setpoints;
        if (pts.length === 0) {
          const first = makeTailSetpoint(`tail-${nanoid()}`);
          return { preset: { ...s.preset, tail: { ...s.preset.tail, setpoints: [first] } } };
        }
        const last = pts.length - 1;
        const idx =
          afterIdx === undefined || !Number.isFinite(afterIdx)
            ? last
            : Math.min(Math.max(Math.trunc(afterIdx), 0), last);
        const a = pts[idx];
        const b = pts[idx + 1];
        const newPt = b
          ? {
              id: `tail-${nanoid()}`,
              position: [
                (a.position[0] + b.position[0]) / 2,
                (a.position[1] + b.position[1]) / 2,
                (a.position[2] + b.position[2]) / 2,
              ] as [number, number, number],
              width: (a.width + b.width) / 2,
            }
          : {
              id: `tail-${nanoid()}`,
              position: [a.position[0] + 0.8, a.position[1] + 0.4, a.position[2]] as [number, number, number],
              width: a.width * 0.6,
            };
        const newPts = [...pts];
        newPts.splice(idx + 1, 0, newPt);
        return { preset: { ...s.preset, tail: { ...s.preset.tail, setpoints: newPts } } };
      }),

    removeTailSetpoint: (id) =>
      set((s) => {
        const pts = s.preset.tail.setpoints.filter((p) => p.id !== id);
        return { preset: { ...s.preset, tail: { ...s.preset.tail, setpoints: pts } } };
      }),

    updateTailSetpoint: (id, patch) =>
      set((s) => ({
        preset: {
          ...s.preset,
          tail: {
            ...s.preset.tail,
            setpoints: s.preset.tail.setpoints.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          },
        },
      })),

    addSpiral: () =>
      set((s) => {
        const existingCount = s.preset.spirals.length;
        const newSpiral: SpiralDef = {
          id: `spiral-${nanoid()}`,
          position: [existingCount * 0.5, 3, 0],
          rotation: [0, 0, 0],
          startRadius: 0.1,
          endRadius: 1.5,
          turns: 2,
          separation: 0.3,
          taperPower: 1,
          rungDensity: 8,
          spiralType: 'golden',
          thickness: 0.15,
          cornerRadius: 0.04,
        };
        return { preset: { ...s.preset, spirals: [...s.preset.spirals, newSpiral] } };
      }),

    updateSpiral: (id, patch) =>
      set((s) => ({
        preset: {
          ...s.preset,
          spirals: s.preset.spirals.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)),
        },
      })),

    removeSpiral: (id) =>
      set((s) => ({
        preset: { ...s.preset, spirals: s.preset.spirals.filter((sp) => sp.id !== id) },
      })),

    setFlowCloud: (patch) =>
      set((s) => ({
        preset: { ...s.preset, flowCloud: { ...s.preset.flowCloud, ...patch } },
      })),

    setSurfaceMeshResolution: (resolution) =>
      set((s) => ({
        preset: { ...s.preset, surfaceMeshResolution: resolution },
      })),

    loadPreset: (preset) => set({ preset: normalizePreset(preset) }),

    resetToDefault: () => set({ preset: structuredClone(DEFAULT_PRESET) }),

    setPresetName: (name) =>
      set((s) => ({ preset: { ...s.preset, name } })),

    gestureActive: false,

    commit: () => {
      if (get().gestureActive) return;
      const history = useHistoryStore.getState();
      const { preset } = get();
      const newest = history.past[history.past.length - 1];
      if (newest && sameValue(newest, preset)) return;
      history.push(preset);
    },

    beginGesture: () => set({ gestureActive: true }),

    endGesture: () => {
      if (get().gestureActive) set({ gestureActive: false });
      get().commit();
    },

    undo: () => {
      get().endGesture();
      const previous = useHistoryStore.getState().undo();
      if (previous) get().loadPreset(previous);
    },

    redo: () => {
      get().endGesture();
      const next = useHistoryStore.getState().redo();
      if (next) get().loadPreset(next);
    },
  }))
);
