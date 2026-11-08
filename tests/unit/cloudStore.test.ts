import { beforeEach, describe, expect, test } from 'vitest'
import { useCloudStore } from '../../src/store/cloudStore'
import { DEFAULT_PRESET } from '../../src/model/defaults'
import type { BaseDef, CloudPreset, TailDef } from '../../src/model/types'

/**
 * Pins every cloudStore action as it behaves today. Defects are pinned separately,
 * as expected-to-fail tests, in knownBugs.store.test.ts.
 */

const store = () => useCloudStore.getState()
const preset = () => useCloudStore.getState().preset

beforeEach(() => {
  store().resetToDefault()
})

/** Every action replaces the preset immutably: the old object is never mutated. */
function expectImmutableUpdate(action: () => void): { before: CloudPreset; after: CloudPreset } {
  const before = preset()
  const snapshot = structuredClone(before)
  action()
  const after = preset()
  expect(after).not.toBe(before)
  expect(before).toEqual(snapshot)
  return { before, after }
}

describe('initial state and preset actions', () => {
  test('starts as a clone of DEFAULT_PRESET', () => {
    expect(preset()).toEqual(DEFAULT_PRESET)
    expect(preset()).not.toBe(DEFAULT_PRESET)
  })

  test('resetToDefault restores a fresh clone of DEFAULT_PRESET', () => {
    store().addSphere()
    store().setPresetName('changed')
    store().resetToDefault()
    expect(preset()).toEqual(DEFAULT_PRESET)
    expect(preset()).not.toBe(DEFAULT_PRESET)
    expect(preset().spheres).not.toBe(DEFAULT_PRESET.spheres)
  })

  test('setPresetName changes only the name', () => {
    const { before, after } = expectImmutableUpdate(() => store().setPresetName('Storm'))
    expect(after).toEqual({ ...before, name: 'Storm' })
  })

  test('loadPreset stores a clone, so later edits to the argument do not leak in', () => {
    const p = structuredClone(DEFAULT_PRESET)
    p.name = 'Loaded'
    store().loadPreset(p)
    p.spheres[0].radius = 99
    expect(preset().name).toBe('Loaded')
    expect(preset().spheres[0].radius).toBe(1.2)
  })

  test('loadPreset normalizes a preset missing the fields version 1 made optional', () => {
    const p = structuredClone(DEFAULT_PRESET)
    delete (p as Partial<CloudPreset>).spirals
    delete (p.flowCloud as Partial<CloudPreset['flowCloud']>).position
    delete (p.flowCloud.wireframe as Partial<CloudPreset['flowCloud']['wireframe']>).generateBands
    delete (p.base as Partial<BaseDef>).ringSegments
    delete (p.base as Partial<BaseDef>).lengthSegments
    delete (p.tail as Partial<TailDef>).radialSegments
    delete (p.tail as Partial<TailDef>).lengthSegments
    delete (p as Partial<CloudPreset>).surfaceMeshResolution
    store().loadPreset(p)
    const got = preset()
    expect(got.spirals).toEqual([])
    expect(got.flowCloud.position).toEqual([0, 0, 0])
    expect(got.flowCloud.wireframe.generateBands).toBe(false)
    expect(got.base.ringSegments).toBe(16)
    expect(got.base.lengthSegments).toBe(24)
    expect(got.tail.radialSegments).toBe(12)
    expect(got.tail.lengthSegments).toBe(32)
    expect(got.surfaceMeshResolution).toBe(64)
  })

  test('loadPreset fills spiral thickness and cornerRadius with 0 when absent', () => {
    const p = {
      ...structuredClone(DEFAULT_PRESET),
      spirals: [
        {
          id: 'legacy',
          position: [0, 3, 0],
          rotation: [0, 0, 0],
          startRadius: 0.1,
          endRadius: 1.5,
          turns: 2,
          separation: 0.3,
          taperPower: 1,
          rungDensity: 8,
          spiralType: 'golden',
        },
      ],
    }
    store().loadPreset(p)
    expect(preset().spirals[0].thickness).toBe(0)
    expect(preset().spirals[0].cornerRadius).toBe(0)
  })

  test('loadPreset keeps fields that are present, including falsy ones', () => {
    const p = structuredClone(DEFAULT_PRESET)
    p.flowCloud.position = [1, 2, 3]
    p.flowCloud.wireframe.generateBands = true
    p.base.ringSegments = 6 // the slider's minimum
    p.surfaceMeshResolution = 128
    p.flowCloud.tailStrength = 0.4
    store().loadPreset(p)
    expect(preset().flowCloud.position).toEqual([1, 2, 3])
    expect(preset().flowCloud.wireframe.generateBands).toBe(true)
    expect(preset().base.ringSegments).toBe(6)
    expect(preset().surfaceMeshResolution).toBe(128)
    expect(preset().flowCloud.tailStrength).toBe(0.4)
  })

  test('loadPreset writes the current version (2) and drops unknown fields', () => {
    store().loadPreset({ ...structuredClone(DEFAULT_PRESET), version: 1, extra: 'dropped' })
    expect(preset().version).toBe(2)
    expect(preset()).not.toHaveProperty('extra')
    expect(preset()).toEqual(DEFAULT_PRESET)
  })
})

describe('sphere actions', () => {
  test('addSphere appends a unit sphere 1.2 to the right of the last one', () => {
    const { before, after } = expectImmutableUpdate(() => store().addSphere())
    expect(after.spheres).toHaveLength(before.spheres.length + 1)
    expect(after.spheres.slice(0, -1)).toEqual(before.spheres)
    const added = after.spheres.at(-1)!
    expect(added.id).toMatch(/^sphere-[a-z0-9]{1,8}$/)
    expect({ ...added, id: 'x' }).toEqual({
      id: 'x',
      position: [-1.6 + 1.2, 0.2, 0],
      radius: 1.0,
      falloff: 0.5,
      shape: 'sphere',
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      half: false,
    })
  })

  test('addSphere into an empty list places the sphere at the origin', () => {
    store().loadPreset({ ...structuredClone(DEFAULT_PRESET), spheres: [] })
    store().addSphere()
    expect(preset().spheres[0].position).toEqual([0, 0, 0])
  })

  test('addSphere ids are distinct', () => {
    for (let i = 0; i < 20; i++) store().addSphere()
    const ids = preset().spheres.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('updateSphere merges the patch into the matching sphere only', () => {
    const { before, after } = expectImmutableUpdate(() =>
      store().updateSphere('sphere-1', { radius: 0.5, rotation: [0.1, 0.2, 0.3] }),
    )
    expect(after.spheres[1]).toEqual({ ...before.spheres[1], radius: 0.5, rotation: [0.1, 0.2, 0.3] })
    expect(after.spheres[0]).toBe(before.spheres[0])
    expect(after.spheres[2]).toBe(before.spheres[2])
  })

  test('updateSphere with an unknown id changes no values', () => {
    const { before, after } = expectImmutableUpdate(() => store().updateSphere('nope', { radius: 9 }))
    expect(after).toEqual(before)
  })

  test('removeSphere removes by id', () => {
    const { after } = expectImmutableUpdate(() => store().removeSphere('sphere-1'))
    expect(after.spheres.map((s) => s.id)).toEqual(['sphere-0', 'sphere-2'])
  })

  test('reorderSpheres with an index outside the list changes nothing', () => {
    const before = preset()
    store().reorderSpheres(0, 3)
    store().reorderSpheres(-1, 0)
    store().reorderSpheres(0.5, 1)
    expect(preset()).toBe(before)
  })

  test('reorderSpheres moves one sphere from one index to another', () => {
    const { after } = expectImmutableUpdate(() => store().reorderSpheres(0, 2))
    expect(after.spheres.map((s) => s.id)).toEqual(['sphere-1', 'sphere-2', 'sphere-0'])
    store().reorderSpheres(2, 0)
    expect(preset().spheres.map((s) => s.id)).toEqual(['sphere-0', 'sphere-1', 'sphere-2'])
  })
})

describe('base actions', () => {
  test('setBase merges a shallow patch', () => {
    const { before, after } = expectImmutableUpdate(() =>
      store().setBase({ crossSectionShape: 'rect', closed: true, crossSectionWidth: 2 }),
    )
    expect(after.base).toEqual({ ...before.base, crossSectionShape: 'rect', closed: true, crossSectionWidth: 2 })
  })

  test('addBasePoint appends the last point shifted by +1 in x', () => {
    const { after } = expectImmutableUpdate(() => store().addBasePoint())
    expect(after.base.controlPoints).toHaveLength(5)
    expect(after.base.controlPoints[4]).toEqual([3.5, -0.8, 0])
  })

  test('addBasePoint on an empty list starts from [0,0,0] + [1,0,0]', () => {
    store().setBase({ controlPoints: [] })
    store().addBasePoint()
    expect(preset().base.controlPoints).toEqual([[1, 0, 0]])
  })

  test('removeBasePoint removes by index', () => {
    const { before, after } = expectImmutableUpdate(() => store().removeBasePoint(1))
    expect(after.base.controlPoints).toEqual([before.base.controlPoints[0], ...before.base.controlPoints.slice(2)])
  })

  test('updateBasePoint replaces one point and leaves the tail object untouched', () => {
    const { before, after } = expectImmutableUpdate(() => store().updateBasePoint(2, [1, 2, 3]))
    expect(after.base.controlPoints[2]).toEqual([1, 2, 3])
    expect(after.base.controlPoints[0]).toBe(before.base.controlPoints[0])
    expect(after.tail).toBe(before.tail)
  })

  test('updateBasePoint stores whatever number it is given, NaN included', () => {
    store().updateBasePoint(0, [Number.NaN, 0, 0])
    expect(preset().base.controlPoints[0][0]).toBeNaN()
  })
})

describe('tail actions', () => {
  test('setTail merges a shallow patch', () => {
    const { before, after } = expectImmutableUpdate(() => store().setTail({ attachToBase: 'none', curlAmount: 1 }))
    expect(after.tail).toEqual({ ...before.tail, attachToBase: 'none', curlAmount: 1 })
  })

  test('addTailSetpoint() extends past the last setpoint by (+0.8, +0.4, 0) at 0.6 x width', () => {
    const { after } = expectImmutableUpdate(() => store().addTailSetpoint())
    const added = after.tail.setpoints[3]
    expect(added.id).toMatch(/^tail-[a-z0-9]{1,8}$/)
    expect(added.position[0]).toBeCloseTo(5.0, 12)
    expect(added.position[1]).toBeCloseTo(0.6, 12)
    expect(added.position[2]).toBe(0.8)
    expect(added.width).toBeCloseTo(0.06, 12)
  })

  test('addTailSetpoint(i) inserts the midpoint of setpoints i and i+1', () => {
    const { after } = expectImmutableUpdate(() => store().addTailSetpoint(0))
    expect(after.tail.setpoints.map((s) => s.id).filter((id) => !/^tail-\d$/.test(id))).toHaveLength(1)
    const mid = after.tail.setpoints[1]
    expect(mid.position).toEqual([3.0, -0.6000000000000001, 0.25])
    expect(mid.width).toBeCloseTo(0.6, 12)
    expect(after.tail.setpoints[2].id).toBe('tail-1')
  })

  test('addTailSetpoint clamps afterIdx to the list: past the end appends, below 0 inserts after the first', () => {
    store().addTailSetpoint(10)
    expect(preset().tail.setpoints).toHaveLength(4)
    expect(preset().tail.setpoints.slice(0, 3).map((s) => s.id)).toEqual(['tail-0', 'tail-1', 'tail-2'])
    expect(preset().tail.setpoints[3].position[0]).toBeCloseTo(5.0, 12)
    store().addTailSetpoint(-3)
    expect(preset().tail.setpoints[1].position).toEqual([3.0, -0.6000000000000001, 0.25])
  })

  test('addTailSetpoint on an empty tail adds one default setpoint', () => {
    store().setTail({ setpoints: [] })
    store().addTailSetpoint()
    const [only] = preset().tail.setpoints
    expect({ ...only, id: 'x' }).toEqual({ id: 'x', position: [0, 0, 0], width: 0.5 })
    expect(only.id).toMatch(/^tail-[a-z0-9]{1,8}$/)
  })

  test('removeTailSetpoint removes by id', () => {
    const { after } = expectImmutableUpdate(() => store().removeTailSetpoint('tail-1'))
    expect(after.tail.setpoints.map((s) => s.id)).toEqual(['tail-0', 'tail-2'])
  })

  test('updateTailSetpoint patches position and width independently', () => {
    expectImmutableUpdate(() => store().updateTailSetpoint('tail-1', { width: 0.25 }))
    expect(preset().tail.setpoints[1]).toEqual({ id: 'tail-1', position: [3.5, -0.4, 0.5], width: 0.25 })
    store().updateTailSetpoint('tail-1', { position: [1, 1, 1] })
    expect(preset().tail.setpoints[1]).toEqual({ id: 'tail-1', position: [1, 1, 1], width: 0.25 })
  })
})

describe('spiral actions', () => {
  test('addSpiral appends the default thick golden spiral, offset 0.5 in x per existing spiral', () => {
    store().addSpiral()
    const { after } = expectImmutableUpdate(() => store().addSpiral())
    expect(after.spirals).toHaveLength(2)
    for (const [i, sp] of after.spirals.entries()) {
      expect(sp.id).toMatch(/^spiral-[a-z0-9]{1,8}$/)
      expect({ ...sp, id: 'x' }).toEqual({
        id: 'x',
        position: [i * 0.5, 3, 0],
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
      })
    }
  })

  test('updateSpiral and removeSpiral act on the matching id', () => {
    store().addSpiral()
    store().addSpiral()
    const [a, b] = preset().spirals
    expectImmutableUpdate(() => store().updateSpiral(a.id, { turns: 3.5 }))
    expect(preset().spirals[0]).toEqual({ ...a, turns: 3.5 })
    expect(preset().spirals[1]).toBe(b)
    expectImmutableUpdate(() => store().removeSpiral(a.id))
    expect(preset().spirals.map((s) => s.id)).toEqual([b.id])
  })
})

describe('flow cloud and surface mesh actions', () => {
  test('setFlowCloud merges a shallow patch (a wireframe patch replaces the whole wireframe)', () => {
    const { before, after } = expectImmutableUpdate(() => store().setFlowCloud({ resolution: 48, threshold: 0.8 }))
    expect(after.flowCloud).toEqual({ ...before.flowCloud, resolution: 48, threshold: 0.8 })
    const wireframe = { ...before.flowCloud.wireframe, mode: 'edges' as const }
    store().setFlowCloud({ wireframe })
    expect(preset().flowCloud.wireframe).toBe(wireframe)
  })

  test('setSurfaceMeshResolution sets the field as given', () => {
    const { after } = expectImmutableUpdate(() => store().setSurfaceMeshResolution(96))
    expect(after.surfaceMeshResolution).toBe(96)
  })
})

describe('subscriptions', () => {
  test('slice selectors fire only for the slice an action replaces', () => {
    const fired: string[] = []
    const unsubs = (['spheres', 'base', 'tail', 'spirals', 'flowCloud'] as const).map((k) =>
      useCloudStore.subscribe(
        (s) => s.preset[k],
        () => fired.push(k),
      ),
    )
    store().updateBasePoint(0, [0, 0, 0])
    store().updateSphere('sphere-0', { radius: 2 })
    store().setTail({ curlAmount: 0 })
    store().addSpiral()
    store().setFlowCloud({ threshold: 0.5 })
    store().setPresetName('quiet')
    store().setSurfaceMeshResolution(32)
    for (const u of unsubs) u()
    expect(fired).toEqual(['base', 'spheres', 'tail', 'spirals', 'flowCloud'])
  })
})
