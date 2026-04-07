import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { CloudPreset, SwirlDef, BaseDef, TailDef, MergeSettings } from '../types/cloud';
import { DEFAULT_PRESET } from '../types/cloud';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface CloudStore {
  preset: CloudPreset;

  // Swirl actions
  addSwirl: () => void;
  updateSwirl: (id: string, patch: Partial<SwirlDef>) => void;
  removeSwirl: (id: string) => void;
  reorderSwirls: (fromIdx: number, toIdx: number) => void;

  // Base actions
  setBase: (patch: Partial<BaseDef>) => void;
  addBasePoint: () => void;
  removeBasePoint: (idx: number) => void;
  updateBasePoint: (idx: number, pos: [number, number, number]) => void;

  // Tail actions
  setTail: (patch: Partial<TailDef>) => void;
  addTailSetpoint: (afterIdx?: number) => void;
  removeTailSetpoint: (id: string) => void;
  updateTailSetpoint: (id: string, patch: { position?: [number, number, number]; width?: number }) => void;

  // Merge / wireframe actions
  setMerge: (patch: Partial<MergeSettings>) => void;

  // Preset actions
  loadPreset: (preset: CloudPreset) => void;
  resetToDefault: () => void;
  setPresetName: (name: string) => void;
}

export const useCloudStore = create<CloudStore>()(
  subscribeWithSelector((set, get) => ({
    preset: structuredClone(DEFAULT_PRESET),

    addSwirl: () =>
      set((s) => {
        const last = s.preset.swirls[s.preset.swirls.length - 1];
        const pos: [number, number, number] = last
          ? [last.position[0] + 1.2, last.position[1], last.position[2]]
          : [0, 0, 0];
        const newSwirl: SwirlDef = {
          id: `swirl-${nanoid()}`,
          position: pos,
          radius: 1.0,
          falloff: 2.0,
          shape: 'sphere',
          scale: [1, 1, 1],
        };
        return { preset: { ...s.preset, swirls: [...s.preset.swirls, newSwirl] } };
      }),

    updateSwirl: (id, patch) =>
      set((s) => ({
        preset: {
          ...s.preset,
          swirls: s.preset.swirls.map((sw) => (sw.id === id ? { ...sw, ...patch } : sw)),
        },
      })),

    removeSwirl: (id) =>
      set((s) => ({
        preset: { ...s.preset, swirls: s.preset.swirls.filter((sw) => sw.id !== id) },
      })),

    reorderSwirls: (fromIdx, toIdx) =>
      set((s) => {
        const swirls = [...s.preset.swirls];
        const [item] = swirls.splice(fromIdx, 1);
        swirls.splice(toIdx, 0, item);
        return { preset: { ...s.preset, swirls } };
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
        const idx = afterIdx !== undefined ? afterIdx : pts.length - 1;
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

    setMerge: (patch) =>
      set((s) => ({
        preset: { ...s.preset, merge: { ...s.preset.merge, ...patch } },
      })),

    loadPreset: (preset) => set({ preset: structuredClone(preset) }),

    resetToDefault: () => set({ preset: structuredClone(DEFAULT_PRESET) }),

    setPresetName: (name) =>
      set((s) => ({ preset: { ...s.preset, name } })),
  }))
);
