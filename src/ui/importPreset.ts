import { useCloudStore } from '../store/cloudStore';
import { useUiStore } from '../store/uiStore';
import { PresetFileError, parsePresetJson } from '../model/presetFile';
import { isEditableTarget } from './shortcuts';

/**
 * Loads the preset in a JSON file (the Import button, or a file dropped on the viewport) as one
 * undo step, as another cloud (replacePreset: what was generated from the one before is
 * dropped), and reports the outcome in the viewport's notice, with the number of values it
 * brought into the editor's ranges, if any. A file that is not a preset (parsePresetJson) changes
 * nothing; the notice says why.
 */
export async function importPresetFile(file: File): Promise<void> {
  // A dropped file takes no focus, so a number field or the name being typed in keeps its draft;
  // it records the draft now, as a click would, before the import replaces the preset under it.
  // Any other focus, such as the Import button's, stays where it is.
  const active = document.activeElement;
  if (active instanceof HTMLElement && isEditableTarget(active)) active.blur();
  const ui = useUiStore.getState();
  const report = { clamped: 0 };
  let preset;
  try {
    preset = parsePresetJson(await file.text(), report);
  } catch (err) {
    const reason = err instanceof PresetFileError ? err.message : 'it could not be read.';
    ui.showNotice({ tone: 'error', text: `Could not import ${file.name}: ${reason}` });
    return;
  }
  const store = useCloudStore.getState();
  store.commit(); // an edit not yet recorded stays its own step
  store.replacePreset(preset);
  store.commit();
  const n = report.clamped;
  const clamped = n === 0 ? '' : ` ${n} ${n === 1 ? 'value was' : 'values were'} outside the editor's ranges and clamped to them.`;
  ui.showNotice({ tone: 'info', text: `Imported ${file.name}.${clamped}` });
}
