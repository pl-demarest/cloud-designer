// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_KEY,
  readAutosave,
  restoreAutosave,
  startAutosave,
  writeAutosave,
} from '../../src/store/autosave'
import { useCloudStore } from '../../src/store/cloudStore'
import { useHistoryStore } from '../../src/store/historyStore'
import { useUiStore } from '../../src/store/uiStore'
import { DEFAULT_PRESET } from '../../src/model/defaults'

/** The localStorage autosave: debounced writes under a versioned key, restore with a notice. */

const store = () => useCloudStore.getState()

/** A Storage in memory that counts writes. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  writes = 0
  get length() { return this.items.size }
  clear() { this.items.clear() }
  getItem(key: string) { return this.items.get(key) ?? null }
  key(i: number) { return [...this.items.keys()][i] ?? null }
  removeItem(key: string) { this.items.delete(key) }
  setItem(key: string, value: string) { this.writes++; this.items.set(key, value) }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  store().resetToDefault()
  useHistoryStore.getState().clear()
  useUiStore.setState(useUiStore.getInitialState())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function edited() {
  const p = structuredClone(DEFAULT_PRESET)
  p.name = 'Saved'
  p.spheres = p.spheres.slice(0, 2)
  return p
}

describe('writeAutosave and readAutosave', () => {
  test('round trip under the versioned key, with the time of the save', () => {
    writeAutosave(storage, edited(), new Date('2026-11-07T12:00:00Z'))
    expect(JSON.parse(storage.getItem(AUTOSAVE_KEY)!).savedAt).toBe('2026-11-07T12:00:00.000Z')
    const saved = readAutosave(storage)!
    expect(saved.preset).toEqual(edited())
    expect(saved.savedAt.toISOString()).toBe('2026-11-07T12:00:00.000Z')
    expect(AUTOSAVE_KEY).toBe('cloud-designer/autosave/v1')
  })

  test('the default preset is not saved: it removes the save', () => {
    writeAutosave(storage, edited())
    writeAutosave(storage, structuredClone(DEFAULT_PRESET))
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull()
  })

  test('a save that does not read as a preset is removed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const text of ['not json', '5', '{"savedAt":"x"}', JSON.stringify({ preset: { base: { controlPoints: [[0, 0, 0]] } } })]) {
      storage.setItem(AUTOSAVE_KEY, text)
      expect(readAutosave(storage), text).toBeNull()
      expect(storage.getItem(AUTOSAVE_KEY)).toBeNull()
    }
  })

  test('a failed write (quota) does not throw and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    writeAutosave(storage, edited())
    writeAutosave(storage, edited())
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

describe('startAutosave', () => {
  test('one write a moment after the last of several edits; none after stop()', () => {
    vi.useFakeTimers()
    const stop = startAutosave(storage)
    for (const radius of [1.3, 1.4, 1.5]) {
      store().updateSphere('sphere-0', { radius })
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS / 2)
    }
    expect(storage.writes, 'debounced').toBe(0)
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(storage.writes).toBe(1)
    expect(readAutosave(storage)!.preset.spheres[0].radius).toBe(1.5)

    stop()
    store().updateSphere('sphere-0', { radius: 2 })
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2)
    expect(storage.writes).toBe(1)
  })

  test('pagehide saves a pending change at once', () => {
    vi.useFakeTimers()
    const stop = startAutosave(storage)
    store().setPresetName('Leaving')
    window.dispatchEvent(new Event('pagehide'))
    expect(readAutosave(storage)!.preset.name).toBe('Leaving')
    stop()
  })
})

describe('restoreAutosave', () => {
  test('nothing saved: nothing restored, no notice', () => {
    expect(restoreAutosave(storage)).toBe(false)
    expect(store().preset).toEqual(DEFAULT_PRESET)
    expect(useUiStore.getState().notice).toBeNull()
  })

  test('loads the saved preset and offers to discard it; Discard goes back to the default as one undo step', () => {
    writeAutosave(storage, edited(), new Date('2026-11-07T12:00:00Z'))
    expect(restoreAutosave(storage)).toBe(true)
    expect(store().preset).toEqual(edited())
    const notice = useUiStore.getState().notice!
    expect(notice.text).toMatch(/^Restored the cloud from autosave \(saved .+\)\.$/)
    expect(notice.action?.label).toBe('Discard')

    store().commit() // App's opening entry
    notice.action!.run()
    expect(store().preset).toEqual(DEFAULT_PRESET)
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull()
    expect(useUiStore.getState().notice).toBeNull()
    store().undo()
    expect(store().preset).toEqual(edited())
  })
})
