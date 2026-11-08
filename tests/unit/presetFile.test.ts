import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PresetFileError, parsePresetJson, presetFromJson } from '../../src/model/presetFile'
import { normalizePreset } from '../../src/model/normalize'
import { DEFAULT_PRESET } from '../../src/model/defaults'

/** Reading a preset file: what imports, and the message for what does not. */

const exported = (file: string) => readFileSync(new URL(`../fixtures/exports/${file}`, import.meta.url), 'utf8')

function failure(text: string): string {
  try {
    parsePresetJson(text)
  } catch (err) {
    expect(err).toBeInstanceOf(PresetFileError)
    return (err as Error).message
  }
  throw new Error('expected a PresetFileError')
}

describe('parsePresetJson', () => {
  test('a current export reads back as the same preset', () => {
    expect(parsePresetJson(JSON.stringify(DEFAULT_PRESET, null, 2))).toEqual(DEFAULT_PRESET)
  })

  test('version-1 and first-commit exports read as normalizePreset reads them', () => {
    for (const file of ['v1-default.json', 'first-commit-default.json']) {
      const text = exported(file)
      expect(parsePresetJson(text), file).toEqual(normalizePreset(JSON.parse(text)))
    }
    expect(parsePresetJson(exported('first-commit-default.json')).spheres, 'swirls become spheres').toHaveLength(3)
  })

  test('refuses what is not a preset, saying why', () => {
    expect(failure('{ "spheres": [ }')).toBe('it is not valid JSON.')
    expect(failure('')).toBe('it is not valid JSON.')
    expect(failure('[1, 2]')).toMatch(/not an object/)
    expect(failure('"cloud"')).toMatch(/not an object/)
    expect(failure('null')).toMatch(/not an object/)
    expect(failure('{ "name": "x", "colour": "blue" }')).toMatch(/none of spheres, base, tail, spirals or flowCloud/)
  })

  test('refuses a base or tail with fewer than two points, which the panels cannot edit', () => {
    const base = structuredClone(DEFAULT_PRESET)
    base.base.controlPoints = [[0, 0, 0]]
    expect(failure(JSON.stringify(base))).toBe('its base has 1 control points; the editor needs at least 2.')
    const tail = structuredClone(DEFAULT_PRESET)
    tail.tail.setpoints = []
    expect(failure(JSON.stringify(tail))).toBe('its tail has 0 setpoints; the editor needs at least 2.')
  })

  test('presetFromJson takes parsed JSON (the autosave path) and returns a fresh object', () => {
    const raw = structuredClone(DEFAULT_PRESET)
    const preset = presetFromJson(raw)
    expect(preset).toEqual(DEFAULT_PRESET)
    expect(preset.spheres).not.toBe(raw.spheres)
  })
})
