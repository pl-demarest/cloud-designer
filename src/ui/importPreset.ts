import { useCloudStore } from '../store/cloudStore';
import { useUiStore } from '../store/uiStore';
import { PresetFileError, parsePresetJson } from '../model/presetFile';

/**
 * Loads the preset in a JSON file (the Import button, or a file dropped on the viewport) as one
 * undo step, as another cloud (replacePreset: what was generated from the one before is
 * dropped), and reports the outcome in the viewport's notice. A file that is not a preset
 * (parsePresetJson) changes nothing; the notice says why.
 */
export async function importPresetFile(file: File): Promise<void> {
  const ui = useUiStore.getState();
  let preset;
  try {
    preset = parsePresetJson(await file.text());
  } catch (err) {
    const reason = err instanceof PresetFileError ? err.message : 'it could not be read.';
    ui.showNotice({ tone: 'error', text: `Could not import ${file.name}: ${reason}` });
    return;
  }
  const store = useCloudStore.getState();
  store.commit(); // an edit not yet recorded stays its own step
  store.replacePreset(preset);
  store.commit();
  ui.showNotice({ tone: 'info', text: `Imported ${file.name}.` });
}
