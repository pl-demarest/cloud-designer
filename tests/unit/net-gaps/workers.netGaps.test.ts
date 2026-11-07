import { describe, expect, test } from 'vitest'
import { digestArray, digestArrayList } from '../../helpers/digest'
import { runWorker } from '../../helpers/workerHarness'
import { THICK_SPIRAL, fixture, marchingCubesMessage, surfaceMeshMessage } from '../../fixtures/presets'
import { normalizePreset } from '../../../src/model/normalize'
import type { CloudPreset } from '../../../src/model/types'

/**
 * Worker branches the golden fixture set does not reach, found by mutation testing
 * (Stage A net check, 2026-11-07). Each case pins today's output, so Stage B's kernel
 * extraction must reproduce it or change the snapshot in a commit that names the
 * intended behaviour change (ground rule 3).
 *
 * Snapshots live in __snapshots__/ next to this file. Vitest writes a missing
 * snapshot outside CI and fails on it in CI; update one deliberately with
 * `npx vitest run tests/unit/net-gaps -u`.
 */

type McOut = { vertices: Float32Array; indices: Uint32Array; bands: Float32Array[]; flowLines: Float32Array[] }
type SmOut = { positions: Float32Array; indices: Uint32Array }

async function marchingCubesDigest(p: CloudPreset) {
  const { message: m } = await runWorker<McOut>('marchingCubes', marchingCubesMessage(p))
  return {
    vertices: digestArray(m.vertices),
    indices: digestArray(m.indices),
    bands: digestArrayList(m.bands),
    flowLines: digestArrayList(m.flowLines),
  }
}

async function surfaceMeshDigest(p: CloudPreset) {
  const { message: m } = await runWorker<SmOut>('surfaceMesh', surfaceMeshMessage(p))
  return { positions: digestArray(m.positions), indices: digestArray(m.indices) }
}

/** A preset saved before flowCloud.tailStrength existed. */
function withoutTailStrength(): CloudPreset {
  const p = fixture('tailStart')
  delete (p.flowCloud as Partial<CloudPreset['flowCloud']>).tailStrength
  return p
}

describe('marchingCubes worker: branches outside the fixture set', () => {
  // Until normalizePreset the worker read a missing tailStrength as 1.0 and the surface-mesh
  // worker as 0. normalizePreset fills 0, DEFAULT_PRESET's value, and both workers get that.
  test('a preset without flowCloud.tailStrength is normalized to 0 and meshes no tail', async () => {
    expect(normalizePreset(withoutTailStrength()).flowCloud.tailStrength).toBe(0)
    const missing = await marchingCubesDigest(withoutTailStrength())
    const noTail = fixture('tailStart')
    noTail.flowCloud.tailStrength = 0
    expect(missing).toEqual(await marchingCubesDigest(noTail))
    const withTail = fixture('tailStart')
    withTail.flowCloud.tailStrength = 1
    expect(missing).not.toEqual(await marchingCubesDigest(withTail))
    expect(missing).toMatchSnapshot()
  })

  test('with no tail setpoints the flow-line u range spans the front-to-back axis length', async () => {
    const p = fixture('tailNone')
    p.tail.setpoints = []
    const out = await marchingCubesDigest(p)
    expect(out.flowLines.count).toBeGreaterThan(0)
    expect(out).toMatchSnapshot()
  })

  test('bands include the u = 1 contour when the isosurface reaches past the first tail setpoint', async () => {
    const p = fixture('bands')
    // The first tail setpoint sets u = 1; inside the cloud, vertices beyond it clamp to u = 1.
    // With it at x = 2.5 (the fixture) the surface never reaches u = 1 and 5 of the 7 targets
    // (u = 0, 1/6, ..., 1) have segments; here 6 do. The u = 0 contour is always empty.
    p.tail.setpoints[0].position = [0.5, -0.8, 0]
    const out = await marchingCubesDigest(p)
    expect(out.bands.count).toBe(p.flowCloud.wireframe.numBands)
    expect(out).toMatchSnapshot()
  })
})

describe('surfaceMesh worker: thick spiral variants outside the fixture set', () => {
  function withSpiral(edit: Partial<typeof THICK_SPIRAL>): CloudPreset {
    const p = fixture('thickSpiral')
    p.spirals = [{ ...structuredClone(THICK_SPIRAL), ...edit }]
    return p
  }

  test('thick archimedean spiral', async () => {
    expect(await surfaceMeshDigest(withSpiral({ spiralType: 'archimedean' }))).toMatchSnapshot()
  })

  test('thick spiral with taperPower 0 (uniform ribbon)', async () => {
    expect(await surfaceMeshDigest(withSpiral({ taperPower: 0 }))).toMatchSnapshot()
  })

  test('a preset without flowCloud.tailStrength meshes no tail field (normalized to 0)', async () => {
    const missing = await surfaceMeshDigest(withoutTailStrength())
    const explicit = fixture('tailStart')
    explicit.flowCloud.tailStrength = 0
    expect(missing).toEqual(await surfaceMeshDigest(explicit))
  })
})

describe('cutAndGlue worker: vertical base', () => {
  /**
   * A straight vertical base. The clip volume uses BaseMesh's Frenet frame (until Stage B the
   * worker used a world-up frame, which fell back to N = +x here): for the tangent +y three picks
   * the normal (0, 0, -1) and the binormal (-1, 0, 0).
   */
  function verticalBase(): CloudPreset {
    const p = fixture('default')
    p.spheres = []
    p.tail.setpoints = []
    p.base.controlPoints = [
      [0, -1, 0],
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
    ]
    p.base.crossSectionWidth = 1.2 // binormal half-extent 0.6
    p.base.crossSectionHeight = 0.4 // normal half-extent 0.2
    return p
  }

  /** Clips one segment against the base volume and returns the surviving pieces as [start, end] x-or-z ranges. */
  async function clipAcross(axis: 0 | 2): Promise<number[][]> {
    const p = verticalBase()
    const seg = new Float32Array(6)
    seg[axis] = -1
    seg[3 + axis] = 1
    seg[1] = seg[4] = 0.5
    const empty = new Float32Array(0)
    const { message } = await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', {
      spheres: p.spheres,
      base: p.base,
      tail: p.tail,
      sphereEdgeGroups: [],
      baseEdges: empty,
      tailEdges: empty,
      spiralEdges: seg,
      flowCloudEdges: empty,
    })
    const out = Array.from(message.clippedEdges)
    const pieces: number[][] = []
    for (let i = 0; i < out.length; i += 6) pieces.push([out[i + axis], out[i + 3 + axis]])
    return pieces
  }

  test('the cross-section height runs along z and the width along x, as BaseMesh draws them', async () => {
    const alongX = await clipAcross(0)
    const alongZ = await clipAcross(2)
    expect(alongX).toHaveLength(2)
    expect(alongZ).toHaveLength(2)
    // Bisection tolerance is 0.001 of a 0.25-long sample interval.
    expect(alongX[0][0]).toBeCloseTo(-1, 6)
    expect(alongX[0][1]).toBeCloseTo(-0.6, 2)
    expect(alongX[1][0]).toBeCloseTo(0.6, 2)
    expect(alongZ[0][1]).toBeCloseTo(-0.2, 2)
    expect(alongZ[1][0]).toBeCloseTo(0.2, 2)
    expect(alongZ[1][1]).toBeCloseTo(1, 6)
  })
})
