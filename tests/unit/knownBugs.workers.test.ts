import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { triTable as THREE_TRI_TABLE } from 'three/examples/jsm/objects/MarchingCubes.js'
import { runWorker } from '../helpers/workerHarness'
import { fixture, marchingCubesMessage, surfaceMeshMessage } from '../fixtures/presets'
import { TRI_TABLE } from '../../src/geometry/marchingCubes/tables'
import type { CloudPreset } from '../../src/model/types'

/**
 * Known worker defects, written as expected-to-fail tests that assert the CORRECT
 * behaviour. Each is named after its audit finding id (audit.json) or, where the
 * lead found it in a spot check, after the refactor-plan decision that fixes it.
 * When Stage B fixes a defect its test starts passing, it.fails reports that, and
 * the fix commit flips it.fails to it.
 */

const WORKERS_DIR = resolve(import.meta.dirname, '../../src/workers')

/** Every TypeScript source under src/workers, the shells and anything they keep beside them. */
function workerSources(): string[] {
  return readdirSync(WORKERS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => resolve(WORKERS_DIR, f))
}

/**
 * three.js stores its table flat (an Int32Array of 256 x 16 entries, -1 terminated);
 * @types/three declares it as Int32Array[], so read it through ArrayLike<number>.
 */
const THREE_FLAT = THREE_TRI_TABLE as unknown as ArrayLike<number>

function threeRow(i: number): number[] {
  const row = Array.from({ length: 16 }, (_, k) => THREE_FLAT[i * 16 + k])
  return row.slice(0, row.indexOf(-1) + 1)
}

/**
 * Classic (Bourke) edge numbering, as in EDGE_PAIRS in src/geometry/marchingCubes/tables.ts.
 * Kept as an independent copy so the crossed-edges check does not trust the code it tests.
 */
const EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
]

/** Cases whose row does not use exactly the edges that cross the iso level. */
function rowsWithWrongEdges(table: number[][]): number[] {
  const bad: number[] = []
  table.forEach((row, c) => {
    const crossed = EDGE_PAIRS.flatMap(([a, b], e) => (((c >> a) & 1) !== ((c >> b) & 1) ? [e] : []))
    const used = [...new Set(row.filter((e) => e >= 0))].sort((x, y) => x - y)
    if (used.join() !== crossed.join()) bad.push(c)
  })
  return bad
}

function uniquePositionCount(positions: Float32Array, tolerance = 1e-5): number {
  const keys = new Set<string>()
  for (let i = 0; i < positions.length; i += 3) {
    keys.add(
      `${Math.round(positions[i] / tolerance)},${Math.round(positions[i + 1] / tolerance)},${Math.round(positions[i + 2] / tolerance)}`,
    )
  }
  return keys.size
}

function maxY(positions: Float32Array): number {
  let m = -Infinity
  for (let i = 1; i < positions.length; i += 3) m = Math.max(m, positions[i])
  return m
}

/** One ellipsoid, 3 long on its local X, rotated 90 degrees about Z so it stands along world Y. */
function standingEllipsoid(): CloudPreset {
  const p = fixture('default')
  p.spheres = [
    {
      id: 'standing',
      position: [0, 0, 0],
      radius: 1,
      falloff: 0.5,
      shape: 'ellipsoid',
      scale: [3, 0.3, 0.3],
      rotation: [0, 0, Math.PI / 2],
      half: false,
    },
  ]
  // A vanishing base and tail at the origin keep the grid on the ellipsoid.
  p.base.controlPoints = [
    [0, -0.2, 0],
    [0.01, -0.2, 0],
  ]
  p.base.crossSectionWidth = 0.01
  p.base.crossSectionHeight = 0.01
  p.tail.setpoints = [
    { id: 't0', position: [0, 0, 0], width: 0.01 },
    { id: 't1', position: [0.01, 0, 0], width: 0.01 },
  ]
  p.tail.attachToBase = 'none'
  p.flowCloud.resolution = 32
  p.surfaceMeshResolution = 32
  return p
}

describe('known worker defects (expected to fail until Stage B)', () => {
  // Both workers import the one table in src/geometry/marchingCubes/tables.ts, so the former
  // per-worker table checks are one check each; this guard keeps a worker from growing its own copy.
  it('sanity: the shared TRI_TABLE has 256 rows and no worker source declares its own', () => {
    expect(TRI_TABLE).toHaveLength(256)
    const sources = workerSources()
    expect(sources.length).toBeGreaterThanOrEqual(3)
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/TRI_TABLE\s*(:[^=]*)?=/)
  })

  // Lead spot check, plan decision D6: row 203 crosses edge 3 (both corners inside) and drops edge 1.
  it('tri-table-row-203 (D6): the shared TRI_TABLE equals three.js triTable', () => {
    TRI_TABLE.forEach((row, i) => expect(row, `row ${i}`).toEqual(threeRow(i)))
  })

  // The same defect stated as a table property: each row may use only the edges its case crosses.
  // Today exactly one case breaks it (203); a passing test proves the fix without depending on three.js.
  it('tri-table-row-203 (D6): every shared TRI_TABLE row uses exactly its crossed edges', () => {
    expect(rowsWithWrongEdges(TRI_TABLE)).toEqual([])
  })

  it('sanity: three.js triTable itself passes the crossed-edges property', () => {
    expect(rowsWithWrongEdges(Array.from({ length: 256 }, (_, i) => threeRow(i)))).toEqual([])
  })

  it('mc-no-cross-cell-welding: the surface mesh shares vertices between adjacent cells', async () => {
    const p = fixture('default')
    p.surfaceMeshResolution = 24
    const { message } = await runWorker<{ positions: Float32Array }>('surfaceMesh', surfaceMeshMessage(p))
    expect(message.positions.length).toBeGreaterThan(0)
    expect(uniquePositionCount(message.positions)).toBe(message.positions.length / 3)
  })

  it('mc-edge-cache-per-cube: the flow-cloud mesh shares vertices between adjacent cells', async () => {
    const p = fixture('default')
    p.flowCloud.resolution = 24
    const { message } = await runWorker<{ vertices: Float32Array }>('marchingCubes', marchingCubesMessage(p))
    expect(message.vertices.length).toBeGreaterThan(0)
    expect(uniquePositionCount(message.vertices)).toBe(message.vertices.length / 3)
  })

  it('nan-on-degenerate-dims: a zero-height base yields no NaN surface-mesh positions', async () => {
    const { message } = await runWorker<{ positions: Float32Array }>(
      'surfaceMesh',
      surfaceMeshMessage(fixture('degenerateBase')),
    )
    // A NaN base distance now makes the whole union NaN, and a NaN node is never inside, so the
    // mesh comes back empty rather than with NaN vertices: an empty mesh fails too.
    expect(message.positions.length).toBeGreaterThan(0)
    expect(message.positions.some(Number.isNaN)).toBe(false)
  })

  it('sphere-rotation-ignored (surfaceMesh.worker): a rotated ellipsoid is meshed rotated', async () => {
    const { message } = await runWorker<{ positions: Float32Array }>(
      'surfaceMesh',
      surfaceMeshMessage(standingEllipsoid()),
    )
    // Rotated, the ellipsoid reaches y = 3; unrotated it stops near y = 0.3.
    expect(maxY(message.positions)).toBeGreaterThan(2)
  })

  it('mc-rotation-ignored: the metaball field honours sphere rotation', async () => {
    const { message } = await runWorker<{ vertices: Float32Array }>(
      'marchingCubes',
      marchingCubesMessage(standingEllipsoid()),
    )
    // Iso level 1 at falloff 0.5 sits at 0.71 of the scaled radius: y = 2.1 rotated, 0.21 unrotated.
    expect(maxY(message.vertices)).toBeGreaterThan(1.5)
  })

  it('sphere-rotation-ignored (cutAndGlue.worker): edges inside a rotated ellipsoid are clipped', async () => {
    const p = standingEllipsoid()
    const inside = [0, 1.8, 0, 0, 2.2, 0] // inside the standing ellipsoid only when rotation is honoured
    const control = [20, 20, 20, 20, 21, 20] // far from everything: always survives
    const { message } = await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', {
      spheres: p.spheres,
      base: p.base,
      tail: p.tail,
      sphereEdgeGroups: [],
      baseEdges: new Float32Array(0),
      tailEdges: new Float32Array([...inside, ...control]),
      spiralEdges: new Float32Array(0),
      flowCloudEdges: new Float32Array(0),
    })
    expect(Array.from(message.clippedEdges)).toEqual(control)
  })
})
