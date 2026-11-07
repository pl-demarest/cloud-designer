import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { CloudPreset, SphereDef, BaseDef, TailDef, SpiralDef, FlowCloudSettings } from '../model/types';
import { DEFAULT_PRESET } from '../model/defaults';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface CloudStore {
  preset: CloudPreset;

  // Sphere actions
  addSphere: () => void;
  updateSphere: (id: string, patch: Partial<SphereDef>) => void;
  removeSphere: (id: string) => void;
  reorderSpheres: (fromIdx: number, toIdx: number) => void;

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

  // Spiral actions
  addSpiral: () => void;
  updateSpiral: (id: string, patch: Partial<SpiralDef>) => void;
  removeSpiral: (id: string) => void;

  // Flow cloud actions
  setFlowCloud: (patch: Partial<FlowCloudSettings>) => void;

  // Surface mesh
  setSurfaceMeshResolution: (resolution: number) => void;

  // Preset actions
  loadPreset: (preset: CloudPreset) => void;
  resetToDefault: () => void;
  setPresetName: (name: string) => void;
}

export const useCloudStore = create<CloudStore>()(
  subscribeWithSelector((set) => ({
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

    addSpiral: () =>
      set((s) => {
        const existingCount = (s.preset.spirals ?? []).length;
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
        return { preset: { ...s.preset, spirals: [...(s.preset.spirals ?? []), newSpiral] } };
      }),

    updateSpiral: (id, patch) =>
      set((s) => ({
        preset: {
          ...s.preset,
          spirals: (s.preset.spirals ?? []).map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)),
        },
      })),

    removeSpiral: (id) =>
      set((s) => ({
        preset: { ...s.preset, spirals: (s.preset.spirals ?? []).filter((sp) => sp.id !== id) },
      })),

    setFlowCloud: (patch) =>
      set((s) => ({
        preset: { ...s.preset, flowCloud: { ...s.preset.flowCloud, ...patch } },
      })),

    setSurfaceMeshResolution: (resolution) =>
      set((s) => ({
        preset: { ...s.preset, surfaceMeshResolution: resolution },
      })),

    // Normalize fields so old presets without them don't crash
    loadPreset: (preset) => {
      const cloned = structuredClone(preset);
      if (!cloned.spirals) cloned.spirals = [];
      if (!cloned.flowCloud.position) cloned.flowCloud.position = [0, 0, 0];
      if (cloned.flowCloud.wireframe.generateBands === undefined) {
        cloned.flowCloud.wireframe.generateBands = false;
      }
      cloned.base.ringSegments ??= 16;
      cloned.base.lengthSegments ??= 24;
      cloned.tail.radialSegments ??= 12;
      cloned.tail.lengthSegments ??= 32;
      cloned.surfaceMeshResolution ??= 64;
      for (const sp of cloned.spirals) {
        sp.thickness ??= 0;
        sp.cornerRadius ??= 0;
      }
      set({ preset: cloned });
    },

    resetToDefault: () => set({ preset: structuredClone(DEFAULT_PRESET) }),

    setPresetName: (name) =>
      set((s) => ({ preset: { ...s.preset, name } })),
  }))
);
