/**
 * Reading a preset from JSON a person supplies: an imported file or the autosave. normalizePreset
 * accepts any object and fills in defaults; this also refuses what is not a preset at all, and
 * what the editor's panels cannot edit, with a message that says why.
 */

import { normalizePreset } from './normalize';
import type { CloudPreset } from './types';

/** Why JSON could not be read as a preset. The message is written for the person importing. */
export class PresetFileError extends Error {
  override name = 'PresetFileError';
}

/** Fields of which a preset has at least one, including the first commit's names. */
const PRESET_FIELDS = ['spheres', 'swirls', 'base', 'tail', 'spirals', 'flowCloud', 'merge'];

/** The panels keep at least this many base control points and tail setpoints. */
export const MIN_PATH_POINTS = 2;

/**
 * The preset in parsed JSON, normalized (normalizePreset: any version, defaults filled in).
 * Throws a PresetFileError when `raw` is not an object, has none of the preset fields, or has a
 * base with fewer than two control points or a tail with fewer than two setpoints.
 */
export function presetFromJson(raw: unknown): CloudPreset {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PresetFileError('it holds no cloud preset (the JSON is not an object).');
  }
  if (!PRESET_FIELDS.some((field) => field in raw)) {
    throw new PresetFileError('it holds no cloud preset (none of spheres, base, tail, spirals or flowCloud).');
  }
  const preset = normalizePreset(raw);
  if (preset.base.controlPoints.length < MIN_PATH_POINTS) {
    throw new PresetFileError(`its base has ${preset.base.controlPoints.length} control points; the editor needs at least ${MIN_PATH_POINTS}.`);
  }
  if (preset.tail.setpoints.length < MIN_PATH_POINTS) {
    throw new PresetFileError(`its tail has ${preset.tail.setpoints.length} setpoints; the editor needs at least ${MIN_PATH_POINTS}.`);
  }
  return preset;
}

/** presetFromJson of `text`; a PresetFileError also when the text is not JSON. */
export function parsePresetJson(text: string): CloudPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PresetFileError('it is not valid JSON.');
  }
  return presetFromJson(raw);
}
