import { create } from 'zustand';
import type { CloudPreset } from '../model/types';

const MAX_HISTORY = 50;

interface HistoryStore {
  past: CloudPreset[];
  future: CloudPreset[];
  push: (snapshot: CloudPreset) => void;
  undo: () => CloudPreset | null;
  redo: () => CloudPreset | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],

  push: (snapshot) =>
    set((s) => ({
      past: [...s.past.slice(-(MAX_HISTORY - 1)), structuredClone(snapshot)],
      future: [],
    })),

  undo: () => {
    const { past, future } = get();
    if (past.length < 2) return null;
    const current = past[past.length - 1];
    const previous = past[past.length - 2];
    set({ past: past.slice(0, -1), future: [current, ...future] });
    return structuredClone(previous);
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return null;
    const next = future[0];
    set({ past: [...past, next], future: future.slice(1) });
    return structuredClone(next);
  },

  canUndo: () => get().past.length >= 2,
  canRedo: () => get().future.length > 0,
  clear: () => set({ past: [], future: [] }),
}));
