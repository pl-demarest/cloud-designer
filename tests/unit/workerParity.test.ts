// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, test } from 'vitest'
import { BaseMesh } from '../../src/three/BaseMesh'
import { TailMesh } from '../../src/three/TailMesh'
import { useCloudStore } from '../../src/store/cloudStore'
import { createViewportStub, isHandle } from '../helpers/scene'
import { runWorker } from '../helpers/workerHarness'
import { fixture, marchingCubesMessage, surfaceMeshMessage } from '../fixtures/presets'
import type { BaseDef, CloudPreset, TailDef } from '../../src/model/types'

/**
 * The workers model each primitive exactly as the editor draws it (refactor plan D4/D5):
 * points the editor draws inside a primitive are inside the workers' volume of it, and points
 * it draws outside are outside. The editor side is read from the real mesh modules.
 */

const store = () => useCloudStore.getState()
const disposers: Array<() => void> = []
afterEach(() => {
  while (disposers.length > 0) disposers.pop()!()
  store().resetToDefault()
})

type V3 = [number, number, number]

/** A preset holding only `base`: no spheres, no tail, no spirals. */
function baseOnly(base: BaseDef): CloudPreset {
  const p = fixture('default')
  p.spheres = []
  p.tail.setpoints = []
  p.base = base
  p.surfaceMeshResolution = 32
  return p
}

/** The rings BaseMesh draws: each ring's vertices and their mean (its centre, for 16 vertices). */
function drawnRings(base: BaseDef): { centre: V3; vertices: V3[] }[] {
  store().loadPreset(baseOnly(base))
  const mesh = new BaseMesh(createViewportStub())
  disposers.push(() => mesh.dispose())
  const edges = mesh.getEdges()
  const ringSegs = base.ringSegments
  const rings: { centre: V3; vertices: V3[] }[] = []
  for (let i = 0; i <= base.lengthSegments; i++) {
    const vertices: V3[] = []
    for (let j = 0; j < ringSegs; j++) {
      const o = (i * ringSegs + j) * 6 // ring segments come first, one per vertex
      vertices.push([edges[o], edges[o + 1], edges[o + 2]])
    }
    const centre = [0, 1, 2].map((k) => vertices.reduce((s, v) => s + v[k], 0) / ringSegs) as V3
    rings.push({ centre, vertices })
  }
  return rings
}

/** Each ring vertex moved towards (f < 1) or away from (f > 1) its ring's centre. */
function scaledRingPoints(base: BaseDef, f: number, skipEndRings: boolean): V3[] {
  const rings = drawnRings(base)
  const used = skipEndRings ? rings.slice(1, -1) : rings
  return used.flatMap(({ centre, vertices }) =>
    vertices.map((v) => [0, 1, 2].map((k) => centre[k] + f * (v[k] - centre[k])) as V3),
  )
}

/** Cut & Glue clips zero-length segments (one per point) against the base volume alone and
 *  returns how many points survive, that is, lie outside it. */
async function pointsOutsideBase(base: BaseDef, points: V3[]): Promise<number> {
  const p = baseOnly(base)
  const empty = new Float32Array(0)
  const { message } = await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', {
    spheres: p.spheres,
    base: p.base,
    tail: p.tail,
    sphereEdgeGroups: [],
    baseEdges: empty,
    tailEdges: empty,
    spiralEdges: new Float32Array(points.flatMap((q) => [...q, ...q])),
    flowCloudEdges: empty,
  })
  return message.clippedEdges.length / 6
}

const STRAIGHT_BASE: BaseDef = {
  ...fixture('default').base,
  controlPoints: [
    [-2.5, -1, 0],
    [-1, -1, 0],
    [1, -1, 0],
    [2.5, -1, 0],
  ],
}

/** A closed rectangular loop around the origin, radius 2.2 in the plane y = -1. */
const RECT_LOOP: BaseDef = {
  ...fixture('default').base,
  crossSectionShape: 'rect',
  closed: true,
  controlPoints: [0, 1, 2, 3, 4, 5].map((k) => {
    const a = (k / 6) * Math.PI * 2
    return [2.2 * Math.cos(a), -1, 2.2 * Math.sin(a)] as V3
  }),
}

// [name, base, open (its end rings lie on the volume's caps, so they are skipped)]
const BASES: Array<[string, BaseDef, boolean]> = [
  ['the default base', fixture('default').base, true],
  // three's first Frenet normal is (0, 0, -1) here: the drawn 0.4 height runs along z.
  ['a straight base along x', STRAIGHT_BASE, true],
  ['the default base with a rectangular section', { ...fixture('default').base, crossSectionShape: 'rect' }, true],
  ['a closed rectangular loop', RECT_LOOP, false],
]

describe('base: the clip volume is the base BaseMesh draws', () => {
  for (const [name, base, open] of BASES) {
    test(`${name}: points 5% inside the drawn rings are inside, 5% outside are outside`, async () => {
      const inside = scaledRingPoints(base, 0.95, open)
      const outside = scaledRingPoints(base, 1.05, open)
      expect(await pointsOutsideBase(base, inside), `of ${inside.length} inner points`).toBe(0)
      expect(await pointsOutsideBase(base, outside), `of ${outside.length} outer points`).toBe(outside.length)
    })
  }

  // This fixture's closing segment runs back through its forward pass and its ends turn in
  // hairpins narrower than the section, so the drawn tube overlaps itself and points just
  // outside one ring lie inside another part of the base. Only the inner points are checked.
  test('the rectClosedBase fixture: points 5% inside the drawn rings are inside', async () => {
    const base = fixture('rectClosedBase').base
    const inside = scaledRingPoints(base, 0.95, false)
    expect(await pointsOutsideBase(base, inside), `of ${inside.length} inner points`).toBe(0)
  })
})

describe('base: the surface mesh is the drawn base, closed by flat caps in its end rings', () => {
  /** Per axis, the largest |coordinate - centre| over the surface-mesh vertices. */
  async function straightBaseExtents(): Promise<{ x: number; y: number; z: number }> {
    const { message } = await runWorker<{ positions: Float32Array }>('surfaceMesh', surfaceMeshMessage(baseOnly(STRAIGHT_BASE)))
    const pos = message.positions
    expect(pos.length).toBeGreaterThan(0)
    const out = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < pos.length; i += 3) {
      out.x = Math.max(out.x, Math.abs(pos[i]))
      out.y = Math.max(out.y, Math.abs(pos[i + 1] + 1))
      out.z = Math.max(out.z, Math.abs(pos[i + 2]))
    }
    return out
  }

  test('a straight base ends at x = +-2.5, the planes of its end rings', async () => {
    expect((await straightBaseExtents()).x).toBeCloseTo(2.5, 4)
  })

  test('a straight base is 1.2 wide along y and 0.4 high along z, as drawn', async () => {
    // Grid cells are 0.1 across here; marching cubes stays inside the cross-section.
    const { y, z } = await straightBaseExtents()
    expect(y).toBeGreaterThan(0.5)
    expect(y).toBeLessThanOrEqual(0.6 + 1e-6)
    expect(z).toBeGreaterThan(0.1)
    expect(z).toBeLessThanOrEqual(0.2 + 1e-6)
  })
})

// ── Tail attachment ──────────────────────────────────────────────────────────

/** The drawn base curve (BaseMesh's 'catmullrom' curve), straight from three. */
function drawnBasePoint(base: BaseDef, t: number): V3 {
  const curve = new THREE.CatmullRomCurve3(base.controlPoints.map((q) => new THREE.Vector3(...q)), base.closed, 'catmullrom', 0.5)
  return curve.getPointAt(t).toArray() as V3
}

/** The default preset with its stored first tail setpoint moved off the base, to (6, 3, 0). */
function detachedFirstSetpoint(attachToBase: TailDef['attachToBase'], attachOffset: number): CloudPreset {
  const p = fixture('default')
  p.tail.setpoints[0].position = [6, 3, 0]
  p.tail.attachToBase = attachToBase
  p.tail.attachOffset = attachOffset
  return p
}

/** TailMesh's handles for `preset`: the first one sits where the drawn tail starts. */
function drawnTailHandles(preset: CloudPreset): V3[] {
  store().loadPreset(preset)
  const vp = createViewportStub()
  const base = new BaseMesh(vp)
  const tail = new TailMesh(vp)
  disposers.push(() => {
    tail.dispose()
    base.dispose()
  })
  return vp.tailGroup.children.filter(isHandle).map((h) => h.position.toArray() as V3)
}

function maxX(positions: Float32Array): number {
  let m = -Infinity
  for (let i = 0; i < positions.length; i += 3) m = Math.max(m, positions[i])
  return m
}

describe('tail: the workers attach the tail where TailMesh draws it', () => {
  test("TailMesh starts an 'end' tail at the drawn base's point attachOffset of the way along", () => {
    const p = detachedFirstSetpoint('end', 0.6)
    const first = new THREE.Vector3(...drawnTailHandles(p)[0])
    expect(first.distanceTo(new THREE.Vector3(...drawnBasePoint(p.base, 0.6)))).toBeLessThan(1e-9)
  })

  test("Cut & Glue: the tail volume holds the drawn tail's start, not the stored first setpoint", async () => {
    const p = detachedFirstSetpoint('end', 0.6)
    const start = drawnTailHandles(p)[0]
    // Base edges are clipped by the tail (and spheres, here none) but never by the base itself.
    const near = [start, [start[0] + 0.2, start[1], start[2]], [start[0], start[1] + 0.2, start[2]]] as V3[]
    const segs = (pts: V3[]) => new Float32Array(pts.flatMap((q) => [...q, ...q]))
    const empty = new Float32Array(0)
    const run = async (pts: V3[]) =>
      (
        await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', {
          spheres: [],
          base: p.base,
          tail: p.tail,
          sphereEdgeGroups: [],
          baseEdges: segs(pts),
          tailEdges: empty,
          spiralEdges: empty,
          flowCloudEdges: empty,
        })
      ).message.clippedEdges.length / 6
    expect(await run(near), 'points at the drawn start that survive').toBe(0)
    expect(await run([[6, 3, 0]]), 'the stored first setpoint survives').toBe(1)
  })

  test('surface mesh: nothing reaches the stored first setpoint at x = 6', async () => {
    const { message } = await runWorker<{ positions: Float32Array }>('surfaceMesh', surfaceMeshMessage(detachedFirstSetpoint('end', 1)))
    expect(maxX(message.positions)).toBeLessThan(5)
  })

  test('flow cloud with tailStrength 1: the tail lobe runs from the base, not from x = 6', async () => {
    const p = detachedFirstSetpoint('end', 1)
    p.flowCloud.tailStrength = 1
    p.flowCloud.resolution = 32
    const { message } = await runWorker<{ vertices: Float32Array }>('marchingCubes', marchingCubesMessage(p))
    expect(maxX(message.vertices)).toBeLessThan(5)
  })
})
