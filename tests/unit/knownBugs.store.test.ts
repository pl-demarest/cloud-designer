import { beforeEach, describe, expect, it } from 'vitest'
import { useCloudStore } from '../../src/store/cloudStore'
import { DEFAULT_PRESET } from '../../src/types/cloud'
import type { CloudPreset } from '../../src/types/cloud'

/** Known store defects as expected-to-fail tests asserting the correct behaviour (see knownBugs.workers.test.ts). */

const store = () => useCloudStore.getState()

beforeEach(() => {
  store().resetToDefault()
})

describe('known store defects (expected to fail until fixed)', () => {
  it.fails('addTailSetpoint-empty: addTailSetpoint on an empty setpoints array does not throw', () => {
    store().setTail({ setpoints: [] })
    expect(() => store().addTailSetpoint()).not.toThrow()
    expect(store().preset.tail.setpoints).toHaveLength(1)
  })

  it.fails('addTailSetpoint-empty: an out-of-range afterIdx does not throw', () => {
    expect(() => store().addTailSetpoint(10)).not.toThrow()
  })

  it.fails('tailstrength-default-mismatch: loadPreset of a preset without tailStrength yields tailStrength 0', () => {
    const p = structuredClone(DEFAULT_PRESET) as CloudPreset
    delete (p.flowCloud as Partial<CloudPreset['flowCloud']>).tailStrength
    store().loadPreset(p)
    expect(store().preset.flowCloud.tailStrength).toBe(0)
  })

  it.fails('reorderSpheres-dead-unsafe: an out-of-range fromIdx leaves the spheres unchanged', () => {
    const before = store().preset.spheres
    store().reorderSpheres(7, 0)
    expect(store().preset.spheres).toEqual(before)
  })
})
