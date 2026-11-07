import { beforeEach, describe, expect, test } from 'vitest'
import { useHistoryStore } from '../../src/store/historyStore'
import { DEFAULT_PRESET } from '../../src/types/cloud'
import type { CloudPreset } from '../../src/types/cloud'

/** Pins historyStore as it behaves today: past[-1] is the current state; undo needs two entries. */

const history = () => useHistoryStore.getState()

function named(name: string): CloudPreset {
  return { ...structuredClone(DEFAULT_PRESET), name }
}

const names = (list: CloudPreset[]) => list.map((p) => p.name)

beforeEach(() => {
  history().clear()
})

describe('historyStore', () => {
  test('starts empty, with nothing to undo or redo', () => {
    expect(history().past).toEqual([])
    expect(history().future).toEqual([])
    expect(history().canUndo()).toBe(false)
    expect(history().canRedo()).toBe(false)
    expect(history().undo()).toBeNull()
    expect(history().redo()).toBeNull()
  })

  test('push stores a deep clone', () => {
    const p = named('a')
    history().push(p)
    p.spheres[0].radius = 42
    expect(history().past[0]).not.toBe(p)
    expect(history().past[0].spheres[0].radius).toBe(1.2)
  })

  test('one entry is the current state: canUndo needs two', () => {
    history().push(named('a'))
    expect(history().canUndo()).toBe(false)
    expect(history().undo()).toBeNull()
    history().push(named('b'))
    expect(history().canUndo()).toBe(true)
  })

  test('undo returns a clone of the previous entry and moves the current one to future', () => {
    history().push(named('a'))
    history().push(named('b'))
    history().push(named('c'))
    const prev = history().undo()!
    expect(prev.name).toBe('b')
    expect(prev).not.toBe(history().past.at(-1))
    expect(names(history().past)).toEqual(['a', 'b'])
    expect(names(history().future)).toEqual(['c'])
    expect(history().canRedo()).toBe(true)
    history().undo()
    expect(names(history().past)).toEqual(['a'])
    expect(names(history().future)).toEqual(['b', 'c'])
    expect(history().undo()).toBeNull()
  })

  test('redo returns a clone of the next entry and moves it back to past', () => {
    for (const n of ['a', 'b', 'c']) history().push(named(n))
    history().undo()
    history().undo()
    const next = history().redo()!
    expect(next.name).toBe('b')
    expect(next).not.toBe(history().past.at(-1))
    expect(names(history().past)).toEqual(['a', 'b'])
    expect(names(history().future)).toEqual(['c'])
    expect(history().redo()!.name).toBe('c')
    expect(history().canRedo()).toBe(false)
    expect(history().redo()).toBeNull()
  })

  test('push clears the redo stack', () => {
    for (const n of ['a', 'b', 'c']) history().push(named(n))
    history().undo()
    history().push(named('d'))
    expect(names(history().past)).toEqual(['a', 'b', 'd'])
    expect(history().future).toEqual([])
    expect(history().canRedo()).toBe(false)
  })

  test('keeps at most MAX_HISTORY = 50 entries, dropping the oldest', () => {
    for (let i = 0; i < 60; i++) history().push(named(String(i)))
    expect(history().past).toHaveLength(50)
    expect(history().past[0].name).toBe('10')
    expect(history().past[49].name).toBe('59')
    let undos = 0
    while (history().undo()) undos++
    expect(undos).toBe(49)
  })

  test('clear empties both stacks', () => {
    for (const n of ['a', 'b', 'c']) history().push(named(n))
    history().undo()
    history().clear()
    expect(history().past).toEqual([])
    expect(history().future).toEqual([])
  })
})
