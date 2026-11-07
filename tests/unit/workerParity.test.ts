// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, test } from 'vitest'
import { BaseMesh } from '../../src/three/BaseMesh'
import { TailMesh } from '../../src/three/TailMesh'
import { SphereMesh } from '../../src/three/SphereMesh'
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

// ── Tail rings and width profile ────────────────────────────────────────────

/** TailMesh's rings: each ring's vertices and their mean (its centre). Ring segments come first in getEdges. */
function drawnTailRings(preset: CloudPreset): { centre: V3; vertices: V3[] }[] {
  store().loadPreset(preset)
  const vp = createViewportStub()
  const base = new BaseMesh(vp)
  const tail = new TailMesh(vp)
  disposers.push(() => {
    tail.dispose()
    base.dispose()
  })
  const edges = tail.getEdges()
  const { radialSegments: radSegs, lengthSegments: lenSegs } = preset.tail
  const rings: { centre: V3; vertices: V3[] }[] = []
  for (let i = 0; i <= lenSegs; i++) {
    const vertices: V3[] = []
    for (let j = 0; j < radSegs; j++) {
      const o = (i * radSegs + j) * 6
      vertices.push([edges[o], edges[o + 1], edges[o + 2]])
    }
    rings.push({ centre: [0, 1, 2].map((k) => vertices.reduce((s, v) => s + v[k], 0) / radSegs) as V3, vertices })
  }
  return rings
}

/** The drawn tail curve through `preset`'s resolved setpoints, straight from three. */
function drawnTailCurve(preset: CloudPreset): { curve: THREE.CatmullRomCurve3; widths: number[] } {
  const handles = drawnTailHandles(preset)
  const curve = new THREE.CatmullRomCurve3(handles.map((q) => new THREE.Vector3(...q)), false, 'catmullrom', 0.5)
  return { curve, widths: preset.tail.setpoints.map((s) => s.width) }
}

/** Width at curve parameter t: linear between setpoint k at t = k / (n - 1) and setpoint k + 1. */
function widthAt(widths: number[], t: number): number {
  const s = t * (widths.length - 1)
  const k = Math.min(Math.floor(s), widths.length - 2)
  return widths[k] + (widths[k + 1] - widths[k]) * (s - k)
}

const TAILS: Array<[string, CloudPreset]> = [
  ['the default tail', fixture('default')],
  ['a non-uniform detached tail', fixture('tailNone')],
]

describe('tail: TailMesh samples centre, frame and width at the same arc-length position', () => {
  for (const [name, preset] of TAILS) {
    test(`${name}: ring i is centred at getPointAt(i / n), where its frame is taken`, () => {
      const { curve } = drawnTailCurve(preset)
      const n = preset.tail.lengthSegments
      let worst = 0
      drawnTailRings(preset).forEach(({ centre }, i) => {
        worst = Math.max(worst, curve.getPointAt(i / n).distanceTo(new THREE.Vector3(...centre)))
      })
      expect(worst).toBeLessThan(1e-6)
    })

    test(`${name}: ring i's radius is the width at the curve parameter of arc length i / n`, () => {
      const { curve, widths } = drawnTailCurve(preset)
      const n = preset.tail.lengthSegments
      let worst = 0
      drawnTailRings(preset).forEach(({ centre, vertices }, i) => {
        const expected = widthAt(widths, curve.getUtoTmapping(i / n, 0))
        for (const v of vertices) {
          worst = Math.max(worst, Math.abs(Math.hypot(v[0] - centre[0], v[1] - centre[1], v[2] - centre[2]) - expected))
        }
      })
      expect(worst).toBeLessThan(1e-6)
    })
  }
})

describe('tail: the workers share TailMesh’s spine and width profile', () => {
  /** Signed distance to the chain of capsules through `centres` with radii `radii`, the
   *  workers' tail model, written out independently of src/geometry. */
  function capsuleChainSDF(centres: V3[], radii: number[], q: V3): number {
    let d = Infinity
    for (let i = 0; i + 1 < centres.length; i++) {
      const a = centres[i], b = centres[i + 1]
      const ab = [0, 1, 2].map((k) => b[k] - a[k])
      const ab2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
      let s = ab2 > 1e-4 ? [0, 1, 2].reduce((acc, k) => acc + (q[k] - a[k]) * ab[k], 0) / ab2 : 0
      s = Math.max(0, Math.min(1, s))
      const dist = Math.hypot(...([0, 1, 2].map((k) => q[k] - a[k] - s * ab[k]) as V3))
      d = Math.min(d, dist - (radii[i] + (radii[i + 1] - radii[i]) * s))
    }
    return d
  }

  /** Base edges are clipped by the tail (and spheres, here none) but not by the base. */
  async function pointsOutsideTail(preset: CloudPreset, points: V3[]): Promise<number> {
    const empty = new Float32Array(0)
    const { message } = await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', {
      spheres: [],
      base: preset.base,
      tail: preset.tail,
      sphereEdgeGroups: [],
      baseEdges: new Float32Array(points.flatMap((q) => [...q, ...q])),
      tailEdges: empty,
      spiralEdges: empty,
      flowCloudEdges: empty,
    })
    return message.clippedEdges.length / 6
  }

  // The capsules through the drawn rings are what the workers model. Where the width falls fast
  // they bulge past the drawn tube (up to 9% of the radius on the default tail, 13% on tailNone),
  // so points just outside a ring can be inside a neighbouring capsule; the test sorts the
  // points with the model and expects the worker to agree with it on every one.
  for (const [name, preset] of TAILS) {
    test(`${name}: the Cut & Glue tail is the chain of capsules through TailMesh's rings`, async () => {
      const rings = drawnTailRings(preset)
      const centres = rings.map((r) => r.centre)
      const radii = rings.map(({ centre, vertices }) => Math.hypot(...([0, 1, 2].map((k) => vertices[0][k] - centre[k]) as V3)))
      const points = rings.flatMap(({ centre, vertices }) =>
        [0.95, 1.05, 1.15].flatMap((f) => vertices.map((v) => [0, 1, 2].map((k) => centre[k] + f * (v[k] - centre[k])) as V3)),
      )
      const clear = points.filter((q) => Math.abs(capsuleChainSDF(centres, radii, q)) > 1e-4)
      const inside = clear.filter((q) => capsuleChainSDF(centres, radii, q) < 0)
      const outside = clear.filter((q) => capsuleChainSDF(centres, radii, q) > 0)
      expect(inside.length).toBeGreaterThan(0)
      expect(outside.length).toBeGreaterThan(0)
      expect(await pointsOutsideTail(preset, inside), `of ${inside.length} points inside the capsules`).toBe(0)
      expect(await pointsOutsideTail(preset, outside), `of ${outside.length} points outside them`).toBe(outside.length)
    })
  }
})

// ── Sphere local frame ──────────────────────────────────────────────────────

describe('sphere: the clip volume is the sphere SphereMesh draws, rotated', () => {
  /** One sphere far from a base moved out of the way, and no tail. */
  function sphereOnly(sphere: CloudPreset['spheres'][number]): CloudPreset {
    const p = fixture('default')
    p.spheres = [sphere]
    p.tail.setpoints = []
    p.base.controlPoints = [
      [0, -50, 0],
      [1, -50, 0],
    ]
    return p
  }

  /** SphereMesh's wire vertices (world space) for `preset`'s only sphere. */
  function drawnSphereVertices(preset: CloudPreset): V3[] {
    store().loadPreset(preset)
    const mesh = new SphereMesh(createViewportStub())
    disposers.push(() => mesh.dispose())
    const edges = mesh.getEdgesGrouped()[0].edges
    const out: V3[] = []
    for (let i = 0; i < edges.length; i += 3) out.push([edges[i], edges[i + 1], edges[i + 2]])
    return out
  }

  /** Tail edges are clipped by every sphere (and the base, here far away). */
  async function pointsOutsideSpheres(preset: CloudPreset, points: V3[]): Promise<number> {
    const empty = new Float32Array(0)
    const { message } = await runWorker<{ clippedEdges: Float32Array }>('cutAndGlue', {
      spheres: preset.spheres,
      base: preset.base,
      tail: preset.tail,
      sphereEdgeGroups: [],
      baseEdges: empty,
      tailEdges: new Float32Array(points.flatMap((q) => [...q, ...q])),
      spiralEdges: empty,
      flowCloudEdges: empty,
    })
    return message.clippedEdges.length / 6
  }

  const towards = (c: V3, v: V3, f: number) => [0, 1, 2].map((k) => c[k] + f * (v[k] - c[k])) as V3

  test('a rotated ellipsoid: points 5% inside its drawn wire are inside, 5% outside are outside', async () => {
    const p = sphereOnly({
      id: 'e', position: [0.5, 0.2, -0.3], radius: 1, falloff: 0.5, shape: 'ellipsoid',
      scale: [1.6, 0.6, 1], rotation: [0.4, -0.7, 1.1], half: false,
    })
    const c = p.spheres[0].position
    const wire = drawnSphereVertices(p)
    const inside = wire.map((v) => towards(c, v, 0.95))
    const outside = wire.map((v) => towards(c, v, 1.05))
    expect(await pointsOutsideSpheres(p, inside), `of ${inside.length} inner points`).toBe(0)
    expect(await pointsOutsideSpheres(p, outside), `of ${outside.length} outer points`).toBe(outside.length)
  })

  test('a rotated half sphere: its drawn dome is inside, the dome mirrored through its base is outside', async () => {
    const rotation: V3 = [0.9, 0.3, -0.5]
    const p = sphereOnly({
      id: 'h', position: [0, 0, 0], radius: 1, falloff: 0.5, shape: 'sphere', scale: [1, 1, 1], rotation, half: true,
    })
    const up = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...rotation, 'XYZ'))
    // Dome vertices clear of the rim, moved halfway to the centre, and their mirror images.
    const dome = drawnSphereVertices(p)
      .map((v) => new THREE.Vector3(...v))
      .filter((v) => v.dot(up) > 0.2)
      .map((v) => v.multiplyScalar(0.5))
    const mirrored = dome.map((v) => v.clone().addScaledVector(up, -2 * v.dot(up)))
    expect(await pointsOutsideSpheres(p, dome.map((v) => v.toArray() as V3)), `of ${dome.length} dome points`).toBe(0)
    expect(await pointsOutsideSpheres(p, mirrored.map((v) => v.toArray() as V3)), `of ${mirrored.length} mirrored points`).toBe(mirrored.length)
  })
})
