import { describe, expect, test } from 'vitest'
import { computeVisibility, type VisibilityInputs } from '../../src/engine/visibility'

/** computeVisibility's whole truth table: 2 modes x Show/Hide x Surface Mesh x flat spirals. */

const BOOLS = [false, true] as const

function inputs(): VisibilityInputs[] {
  const out: VisibilityInputs[] = []
  for (const mode of ['edit', 'preview'] as const)
    for (const showFlowCloud of BOOLS)
      for (const surfaceMeshVisible of BOOLS)
        for (const hasFlatSpirals of BOOLS)
          out.push({ mode, showAxes: true, showGrid: true, showFlowCloud, surfaceMeshVisible, hasFlatSpirals })
  return out
}

describe('computeVisibility', () => {
  test('Edit: the scaffold with its handles and the gizmo; the flow cloud as Show/Hide says; no Cut & Glue result', () => {
    for (const v of inputs().filter((i) => i.mode === 'edit')) {
      expect(computeVisibility(v), JSON.stringify(v)).toEqual({
        axes: true,
        grid: true,
        spheres: true,
        base: true,
        tail: true,
        spirals: true,
        spiralHandles: true,
        gizmo: true,
        flowCloud: v.showFlowCloud,
        flowCloudHandle: true,
        cutGlue: false,
        cutGlueSurfaceMesh: v.surfaceMeshVisible,
      })
    }
  })

  test('Preview: the Cut & Glue result, with the flat spirals beside the surface mesh; no scaffold, handles or flow cloud', () => {
    for (const v of inputs().filter((i) => i.mode === 'preview')) {
      expect(computeVisibility(v), JSON.stringify(v)).toEqual({
        axes: true,
        grid: true,
        spheres: false,
        base: false,
        tail: false,
        spirals: v.surfaceMeshVisible && v.hasFlatSpirals,
        spiralHandles: false,
        gizmo: false,
        flowCloud: false,
        flowCloudHandle: false,
        cutGlue: true,
        cutGlueSurfaceMesh: v.surfaceMeshVisible,
      })
    }
  })

  test('the axes and grid follow their toggles in either mode', () => {
    for (const mode of ['edit', 'preview'] as const)
      for (const showAxes of BOOLS)
        for (const showGrid of BOOLS) {
          const v = computeVisibility({ mode, showAxes, showGrid, showFlowCloud: true, surfaceMeshVisible: false, hasFlatSpirals: false })
          expect([v.axes, v.grid]).toEqual([showAxes, showGrid])
        }
  })

  test('visibility-desync: Hide holds in Edit whatever the mode was, and Show does not reveal the flow cloud in Preview', () => {
    const flags = { showAxes: true, showGrid: true, surfaceMeshVisible: false, hasFlatSpirals: false }
    expect(computeVisibility({ ...flags, mode: 'edit', showFlowCloud: false }).flowCloud).toBe(false)
    expect(computeVisibility({ ...flags, mode: 'preview', showFlowCloud: true }).flowCloud).toBe(false)
  })
})
