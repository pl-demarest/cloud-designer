import { useCloudStore } from './cloudStore';
import { useUiStore } from './uiStore';
import { DEFAULT_PRESET } from '../model/defaults';
import { PresetFileError, presetFromJson } from '../model/presetFile';
import { sameValue } from '../engine/sameValue';
import type { CloudPreset } from '../model/types';

/**
 * The preset survives a reload: it is saved to localStorage a moment after each change, and a
 * saved preset is restored when the editor opens, with a notice that offers to discard it.
 */

/** The storage key. Its version is that of the stored record ({ savedAt, preset }); the preset
 *  inside carries its own (PRESET_VERSION) and is read through presetFromJson. */
export const AUTOSAVE_KEY = 'cloud-designer/autosave/v1';

/** A save waits this long after the last change of the preset. */
export const AUTOSAVE_DELAY_MS = 1000;

interface AutosaveRecord {
  savedAt: string;
  preset: CloudPreset;
}

/** localStorage, or null where it cannot be used (blocked storage, some private windows). */
export function autosaveStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    storage.getItem(AUTOSAVE_KEY);
    return storage;
  } catch {
    return null;
  }
}

/**
 * The saved preset and the time it was saved, or null. A save that does not read as a preset
 * (corrupt JSON, a refused preset) is removed.
 */
export function readAutosave(storage: Storage): { preset: CloudPreset; savedAt: Date } | null {
  const text = storage.getItem(AUTOSAVE_KEY);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    const record: Partial<Record<keyof AutosaveRecord, unknown>> = typeof parsed === 'object' && parsed !== null ? parsed : {};
    const preset = presetFromJson(record.preset);
    const savedAt = new Date(typeof record.savedAt === 'string' ? record.savedAt : NaN);
    return { preset, savedAt };
  } catch (err) {
    if (!(err instanceof SyntaxError || err instanceof PresetFileError)) throw err;
    console.warn('Autosave: the saved preset could not be read and was removed.', err);
    storage.removeItem(AUTOSAVE_KEY);
    return null;
  }
}

let warnedWrite = false;

/** Saves `preset` now. The default preset is not saved: its save is removed instead, so opening
 *  the editor on the default shows no restore notice. A failed write (quota) is reported once. */
export function writeAutosave(storage: Storage, preset: CloudPreset, now = new Date()): void {
  try {
    if (sameValue(preset, DEFAULT_PRESET)) {
      storage.removeItem(AUTOSAVE_KEY);
      return;
    }
    const record: AutosaveRecord = { savedAt: now.toISOString(), preset };
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(record));
  } catch (err) {
    if (!warnedWrite) console.warn('Autosave: the preset could not be saved.', err);
    warnedWrite = true;
  }
}

/**
 * Saves the preset AUTOSAVE_DELAY_MS after each change, and at once when the page is hidden or
 * left (pagehide, so a reload right after an edit keeps it). Returns a function that stops it.
 */
export function startAutosave(storage: Storage): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    writeAutosave(storage, useCloudStore.getState().preset);
  };
  const flush = () => {
    if (timer) save();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const unsubscribe = useCloudStore.subscribe(
    (s) => s.preset,
    () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, AUTOSAVE_DELAY_MS);
    },
  );
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** The editor's default preset, as one undo step and another cloud, and no saved preset. */
function discardAutosave(storage: Storage): void {
  const store = useCloudStore.getState();
  store.resetToDefault();
  store.commit();
  storage.removeItem(AUTOSAVE_KEY);
  useUiStore.getState().dismissNotice();
}

/**
 * Loads a saved preset into the store, before the editor mounts (the history then opens on it),
 * and shows a notice with a Discard button that goes back to the default preset. Returns whether
 * a preset was restored.
 */
export function restoreAutosave(storage: Storage): boolean {
  const saved = readAutosave(storage);
  if (!saved) return false;
  useCloudStore.getState().replacePreset(saved.preset);
  const when = Number.isNaN(saved.savedAt.getTime())
    ? ''
    : ` (saved ${saved.savedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})`;
  useUiStore.getState().showNotice({
    tone: 'info',
    text: `Restored the cloud from autosave${when}.`,
    action: { label: 'Discard', run: () => discardAutosave(storage) },
  });
  return true;
}
