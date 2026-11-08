import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { CatmullRomCurve } from '../../src/geometry/catmullRom'
import { computeFrenetFrames } from '../../src/geometry/frames'
import { eulerXYZ } from '../../src/geometry/mat3'
import { sphereFrame, sphereSDF } from '../../src/geometry/primitives/sphere'
import { sampleSpiral } from '../../src/geometry/primitives/spiral'
import { basePointAt, buildBaseVolume, sampleBasePath } from '../../src/geometry/primitives/base'
import { attachedTail, sampleTailPath, tailWidthAt } from '../../src/geometry/primitives/tail'
import type { PathSamples } from '../../src/geometry/path'
import { generateFlowCloud } from '../../src/workers/core/flowCloud'
import { generateSurfaceMesh } from '../../src/workers/core/surfaceMesh'
import { cutAndGlue } from '../../src/workers/core/cutAndGlue'
import { normalizePreset } from '../../src/model/normalize'
import { DEFAULT_PRESET, makeSphere } from '../../src/model/defaults'
import type { BaseDef, CloudPreset, SphereDef, TailSetpoint } from '../../src/model/types'
import { FIXTURE_NAMES, THICK_SPIRAL, fixture, marchingCubesMessage, surfaceMeshMessage } from '../fixtures/presets'
import { edgeUse, signedVolume } from '../helpers/mesh'

/**
 * Properties of the geometry kernel and the preset model on seeded random inputs, checked
 * against references that do not share its code: three.js for the Euler rotation, the
 * Catmull-Rom curves and their Frenet frames (bit for bit), mesh invariants for marching cubes
 * and the flow lines, and old exports for normalizePreset. First run by the Stage B review
 * (B4) as a scratch file.
 */

/** A pseudo-random sequence, so every input is the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

type V3 = [number, number, number]

/** Equal to the bit, signed zeros included. */
function sameVector(a: { x: number; y: number; z: number }, b: THREE.Vector3): boolean {
  return Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z)
}

// ── Euler XYZ rotation ───────────────────────────────────────────────────────

describe('Euler XYZ rotation against three', () => {
  test('transpose(eulerXYZ) is the inverse of Matrix4.makeRotationFromEuler, on 10,000 random angle triples', () => {
    const rnd = lcg(11)
    let maxDiff = 0
    let maxOrtho = 0
    for (let n = 0; n < 10000; n++) {
      const [x, y, z] = [0, 1, 2].map(() => (rnd() * 2 - 1) * 4 * Math.PI)
      const m = eulerXYZ(x, y, z) // row-major
      const inv = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')).invert().elements // column-major
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          maxDiff = Math.max(maxDiff, Math.abs(m[3 * c + r] - inv[4 * c + r]))
          let dot = 0
          for (let k = 0; k < 3; k++) dot += m[3 * r + k] * m[3 * c + k]
          maxOrtho = Math.max(maxOrtho, Math.abs(dot - (r === c ? 1 : 0)))
        }
      }
    }
    expect(maxDiff).toBeLessThan(1e-14)
    expect(maxOrtho).toBeLessThan(1e-14)
  })

  test("sphereSDF measures in three's inverse of the drawn sphere's transform, half spheres too", () => {
    const rnd = lcg(12)
    let maxDiff = 0
    let maxHalfDiff = 0
    for (let n = 0; n < 500; n++) {
      const def: SphereDef = makeSphere('s', {
        position: [rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3],
        radius: 0.3 + rnd() * 2,
        shape: 'ellipsoid',
        scale: [0.2 + rnd() * 2.8, 0.2 + rnd() * 2.8, 0.2 + rnd() * 2.8],
        rotation: [(rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI],
      })
      // SphereMesh's wire: unit-sphere geometry scaled, rotated and moved by its Object3D.
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation, 'XYZ'))
      const position = new THREE.Vector3(...def.position)
      const toLocal = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(...def.scale)).invert()
      const toUnscaled = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1)).invert()
      const f = sphereFrame(def)
      const fh = sphereFrame({ ...def, half: true })
      for (let k = 0; k < 20; k++) {
        const p = new THREE.Vector3(rnd() * 10 - 5, rnd() * 10 - 5, rnd() * 10 - 5)
        const expected = p.clone().applyMatrix4(toLocal).length() - def.radius
        maxDiff = Math.max(maxDiff, Math.abs(sphereSDF(p.x, p.y, p.z, f) - expected) / Math.max(1, Math.abs(expected)))
        const expectedHalf = Math.max(expected, -p.clone().applyMatrix4(toUnscaled).y)
        maxHalfDiff = Math.max(maxHalfDiff, Math.abs(sphereSDF(p.x, p.y, p.z, fh) - expectedHalf) / Math.max(1, Math.abs(expectedHalf)))
      }
    }
    expect(maxDiff).toBeLessThan(1e-12)
    expect(maxHalfDiff).toBeLessThan(1e-12)
  })

  // SpiralMesh draws a spiral in its local frame under the same Euler XYZ rotation as a sphere.
  test("sampleSpiral rotates its samples by three's Matrix4.makeRotationFromEuler, bit for bit", () => {
    const rnd = lcg(13)
    for (let n = 0; n < 200; n++) {
      const rotation: V3 = [(rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI]
      const position: V3 = [rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 4 - 2]
      const def = { ...THICK_SPIRAL, rotation, position }
      const local = sampleSpiral({ ...def, rotation: [0, 0, 0], position: [0, 0, 0] }, 16)
      const world = sampleSpiral(def, 16)
      const te = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation, 'XYZ')).elements // column-major
      expect(world).toHaveLength(local.length)
      local.forEach((l, i) => {
        const w = world[i]
        for (let r = 0; r < 3; r++) {
          const centre = te[r] * l.cx + te[4 + r] * l.cy + te[8 + r] * l.cz + position[r]
          const radial = te[r] * l.rx + te[4 + r] * l.ry + te[8 + r] * l.rz
          expect(Object.is([w.cx, w.cy, w.cz][r], centre), `rotation ${rotation}, sample ${i}, centre ${r}`).toBe(true)
          expect(Object.is([w.rx, w.ry, w.rz][r], radial), `rotation ${rotation}, sample ${i}, radial ${r}`).toBe(true)
        }
      })
    }
  })
})

// ── Catmull-Rom curves and Frenet frames ─────────────────────────────────────

/** 2 to 6 control points running roughly along +x; open or (3 points or more) closed. */
function randomBase(rnd: () => number): BaseDef {
  const n = 2 + Math.floor(rnd() * 5)
  const pts: V3[] = []
  let x = -3
  for (let i = 0; i < n; i++) {
    x += 0.3 + rnd() * 2
    pts.push([x, rnd() * 2 - 1.5, rnd() * 2 - 1])
  }
  return {
    ...fixture('default').base,
    controlPoints: pts,
    closed: n >= 3 && rnd() < 0.4,
    crossSectionShape: rnd() < 0.5 ? 'oval' : 'rect',
    lengthSegments: 8 + Math.floor(rnd() * 40),
  }
}

/** 2 to 6 setpoints running roughly along +x, widths 0.05 to 1.05. */
function randomSetpoints(rnd: () => number): TailSetpoint[] {
  const n = 2 + Math.floor(rnd() * 5)
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    position: [i * (0.3 + rnd()), rnd() * 2 - 1, rnd() * 2 - 1] as V3,
    width: 0.05 + rnd(),
  }))
}

/** The curve BaseMesh and TailMesh draw, built by three itself. */
function threeCurve(points: readonly V3[], closed: boolean): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5)
}

describe('Catmull-Rom paths and Frenet frames against three', () => {
  const rnd = lcg(21)
  const bases: Array<[string, BaseDef]> = [
    ['default', fixture('default').base],
    ['rectClosedBase', fixture('rectClosedBase').base],
    ...Array.from({ length: 40 }, (_, i) => [`random base ${i}`, randomBase(rnd)] as [string, BaseDef]),
  ]
  const tails: Array<[string, TailSetpoint[]]> = [
    ['default', fixture('default').tail.setpoints],
    ['tailNone', fixture('tailNone').tail.setpoints],
    ...Array.from({ length: 30 }, (_, i) => [`random tail ${i}`, randomSetpoints(rnd)] as [string, TailSetpoint[]]),
  ]
  const tailSegments = tails.map(() => 8 + Math.floor(rnd() * 40))

  // three's CatmullRomCurve3 keeps both phantom ends of a two-point curve in one vector, so both
  // are 2 P1 - P0 and its curve first runs backwards from P0. The kernel's are 2 P0 - P1 and
  // 2 P1 - P0: a straight segment. With three points or more the curves are the same.
  const threeOrMore = (n: number) => n >= 3

  test('three or more points: sampleBasePath, basePointAt and buildBaseVolume equal a fresh CatmullRomCurve3, bit for bit', () => {
    const checked = bases.filter(([, base]) => threeOrMore(base.controlPoints.length))
    expect(checked.length).toBeGreaterThan(30)
    for (const [name, base] of checked) {
      const n = base.lengthSegments
      const ref = threeCurve(base.controlPoints, base.closed)
      const frames = ref.computeFrenetFrames(n, base.closed)
      const got = sampleBasePath(base, n)
      const vol = buildBaseVolume(base)
      expect(got.points, name).toHaveLength(n + 1)
      expect(vol.count, name).toBe(n + 1)
      for (let i = 0; i <= n; i++) {
        const p = ref.getPointAt(i / n)
        const expected: Array<[THREE.Vector3, { x: number; y: number; z: number }, Float64Array]> = [
          [p, got.points[i], vol.p],
          [frames.tangents[i], got.tangents[i], vol.t],
          [frames.normals[i], got.normals[i], vol.n],
          [frames.binormals[i], got.binormals[i], vol.b],
        ]
        for (const [want, sample, packed] of expected) {
          expect(sameVector(sample, want), `${name} sample ${i}`).toBe(true)
          expect(sameVector({ x: packed[3 * i], y: packed[3 * i + 1], z: packed[3 * i + 2] }, want), `${name} volume ${i}`).toBe(true)
        }
      }
      for (const t of [0, 0.13, 0.5, 0.77, 1]) {
        const p = basePointAt(base, t)
        expect(sameVector({ x: p[0], y: p[1], z: p[2] }, ref.getPointAt(t)), `${name} pointAt ${t}`).toBe(true)
      }
    }
  })

  // Branches the kernel's own curves rarely reach: the closed two-point curve (closed, it has no
  // phantom ends), coincident points (zero-length chords, equal entries in the arc-length table),
  // a curve of zero length (zero tangents) and signed zeros.
  const EDGE_CASES: Array<[string, V3[], boolean[]]> = [
    ['two points', [[0, 0, 0], [1, 0.5, -0.25]], [true]],
    ['coincident points', [[0, 0, 0], [0, 0, 0], [1, 1, 0], [1, 1, 0], [2, 0, 1]], [false, true]],
    ['zero length', [[1, 2, 3], [1, 2, 3], [1, 2, 3]], [false, true]],
    ['doubling back', [[0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], [false, true]],
    ['signed zeros', [[-0, 0, -0], [0, -1, -0], [-0, -2, 0], [0, -3, -0]], [false, true]],
  ]
  for (const [name, points, closings] of EDGE_CASES) {
    for (const closed of closings) {
      test(`CatmullRomCurve and computeFrenetFrames equal three on ${name}, ${closed ? 'closed' : 'open'}, bit for bit`, () => {
        const ref = threeCurve(points, closed)
        const curve = new CatmullRomCurve(points.map(([x, y, z]) => ({ x, y, z })), closed)
        for (let k = 0; k <= 64; k++) {
          const u = k / 64
          expect(sameVector(curve.getPoint(u), ref.getPoint(u)), `getPoint(${u})`).toBe(true)
          expect(Object.is(curve.getUtoTmapping(u), ref.getUtoTmapping(u, 0)), `getUtoTmapping(${u})`).toBe(true)
          expect(sameVector(curve.getPointAt(u), ref.getPointAt(u)), `getPointAt(${u})`).toBe(true)
          expect(sameVector(curve.getTangentAt(u), ref.getTangentAt(u)), `getTangentAt(${u})`).toBe(true)
        }
        const got = computeFrenetFrames(curve, 24, closed)
        const want = ref.computeFrenetFrames(24, closed)
        for (let i = 0; i <= 24; i++) {
          expect(sameVector(got.tangents[i], want.tangents[i]), `tangent ${i}`).toBe(true)
          expect(sameVector(got.normals[i], want.normals[i]), `normal ${i}`).toBe(true)
          expect(sameVector(got.binormals[i], want.binormals[i]), `binormal ${i}`).toBe(true)
        }
      })
    }
  }

  test('three or more setpoints: sampleTailPath equals a fresh open CatmullRomCurve3, bit for bit, with widths at its curve parameter', () => {
    const checked = tails.map((t, i) => [...t, tailSegments[i]] as const).filter(([, setpoints]) => threeOrMore(setpoints.length))
    expect(checked.length).toBeGreaterThan(20)
    for (const [name, setpoints, segs] of checked) {
      const ref = threeCurve(setpoints.map((s) => s.position), false)
      const frames = ref.computeFrenetFrames(segs, false)
      const got = sampleTailPath(setpoints, segs)
      expect(got.points, name).toHaveLength(segs + 1)
      for (let i = 0; i <= segs; i++) {
        expect(sameVector(got.points[i], ref.getPointAt(i / segs)), `${name} point ${i}`).toBe(true)
        expect(sameVector(got.tangents[i], frames.tangents[i]), `${name} tangent ${i}`).toBe(true)
        expect(sameVector(got.normals[i], frames.normals[i]), `${name} normal ${i}`).toBe(true)
        expect(sameVector(got.binormals[i], frames.binormals[i]), `${name} binormal ${i}`).toBe(true)
        // The width profile at three's arc-length-to-parameter mapping (a distance of 0 reads as
        // none), and linear in the parameter.
        const t = ref.getUtoTmapping(i / segs, 0)
        expect(Object.is(got.widths[i], tailWidthAt(setpoints, t)), `${name} width ${i}`).toBe(true)
        const s = t * (setpoints.length - 1)
        const k = Math.min(Math.floor(s), setpoints.length - 2)
        const linear = setpoints[k].width + (s - k) * (setpoints[k + 1].width - setpoints[k].width)
        expect(Math.abs(got.widths[i] - linear), `${name} width ${i}`).toBeLessThan(1e-12)
      }
    }
  })

  test('a two-point base or tail is the straight segment between its points: in order, evenly spaced, one tangent', () => {
    const { controlPoints } = fixture('default').base
    const endsBase: BaseDef = { ...fixture('default').base, controlPoints: [controlPoints[0], controlPoints[3]] }
    const { setpoints } = fixture('default').tail
    const endsTail = [setpoints[0], setpoints[2]]
    const cases: Array<[string, V3[], number, PathSamples]> = [
      ['the default base cut to its end points', endsBase.controlPoints, 24, sampleBasePath(endsBase, 24)],
      ['the default tail cut to its end setpoints', endsTail.map((s) => s.position), 32, sampleTailPath(endsTail, 32)],
    ]
    for (const [name, base] of bases) {
      if (base.controlPoints.length === 2) cases.push([name, base.controlPoints, base.lengthSegments, sampleBasePath(base, base.lengthSegments)])
    }
    tails.forEach(([name, sp], i) => {
      if (sp.length === 2) cases.push([name, sp.map((s) => s.position), tailSegments[i], sampleTailPath(sp, tailSegments[i])])
    })
    expect(cases.length).toBeGreaterThanOrEqual(10)

    for (const [name, [a, b], n, path] of cases) {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const len = Math.hypot(d[0], d[1], d[2])
      const dir = d.map((c) => c / len)
      let along = -Infinity
      for (let i = 0; i <= n; i++) {
        const p = path.points[i]
        const next = (p.x - a[0]) * dir[0] + (p.y - a[1]) * dir[1] + (p.z - a[2]) * dir[2]
        expect(next, `${name}: point ${i} lies past point ${i - 1}`).toBeGreaterThan(along)
        along = next
        const f = i / n
        expect(Math.hypot(p.x - a[0] - f * d[0], p.y - a[1] - f * d[1], p.z - a[2] - f * d[2]), `${name} point ${i}`).toBeLessThan(1e-9)
        const t = path.tangents[i]
        expect(Math.hypot(t.x - dir[0], t.y - dir[1], t.z - dir[2]), `${name} tangent ${i}`).toBeLessThan(1e-9)
      }
    }
  })
})

// ── Marching cubes: closed, outward meshes ───────────────────────────────────

/** The default preset with 1 to 5 random spheres (rotated, ellipsoids, halves), a random
 *  threshold and the tail in the field for about a third, on grids the editor offers: flow cloud
 *  32 or 64, surface mesh 32 (64 would take about 0.2 s per preset). */
function randomCloud(rnd: () => number, name: string): CloudPreset {
  const p = fixture('default')
  p.name = name
  const n = 1 + Math.floor(rnd() * 5)
  p.spheres = Array.from({ length: n }, (_, i) =>
    makeSphere(`s${i}`, {
      position: [rnd() * 5 - 2.5, rnd() * 3 - 1, rnd() * 3 - 1.5],
      radius: 0.3 + rnd() * 1.5,
      falloff: 0.5 + rnd() * 4.5,
      shape: rnd() < 0.5 ? 'sphere' : 'ellipsoid',
      scale: [0.2 + rnd() * 2.8, 0.2 + rnd() * 2.8, 0.2 + rnd() * 2.8],
      rotation: [(rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI],
      half: rnd() < 0.3,
    }),
  )
  p.flowCloud.threshold = 0.5 + rnd() * 2.5
  p.flowCloud.tailStrength = rnd() < 0.3 ? rnd() * 2 : 0
  p.flowCloud.resolution = rnd() < 0.5 ? 32 : 64
  p.surfaceMeshResolution = 32
  p.flowCloud.wireframe.generateBands = rnd() < 0.5
  return p
}

describe('marching cubes meshes are closed and face outward', () => {
  const rnd = lcg(31)
  const random = Array.from({ length: 60 }, (_, i) => randomCloud(rnd, `random cloud ${i}`))
  // Ten presets per test keep each test well inside the default timeout.
  const batches: Array<[string, CloudPreset[]]> = [['the default preset', [fixture('default')]]]
  for (let i = 0; i < random.length; i += 10) batches.push([`random clouds ${i} to ${i + 9}`, random.slice(i, i + 10)])

  for (const [name, batch] of batches) {
    test(`${name}: every edge in two triangles, in opposite directions, and a positive volume`, () => {
      expect(meshFailures(batch)).toEqual([])
    })
  }

  /** What breaks the property in each preset's flow-cloud and surface meshes. */
  function meshFailures(batch: CloudPreset[]): string[] {
    const failures: string[] = []
    for (const p of batch) {
      const fc = generateFlowCloud(marchingCubesMessage(p))
      const sm = generateSurfaceMesh(surfaceMeshMessage(p))
      for (const [kind, positions, indices] of [['flow cloud', fc.vertices, fc.indices], ['surface mesh', sm.positions, sm.indices]] as const) {
        if (indices.length === 0) continue
        const use = edgeUse(indices)
        const volume = signedVolume(positions, indices)
        const finite = positions.every(Number.isFinite)
        if (use.notShared.length > 0 || use.sameDirection > 0 || !(volume > 0) || !finite) {
          failures.push(`${p.name} ${kind}: ${use.notShared.length} open edges, ${use.sameDirection} flipped, volume ${volume}, finite ${finite}`)
        }
      }
    }
    return failures
  }
})

// ── Flow lines and bands ─────────────────────────────────────────────────────

/** The longest edge of an indexed triangle mesh. */
function longestEdge(vertices: Float32Array, indices: Uint32Array): number {
  let m = 0
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k] * 3
      const b = indices[t + ((k + 1) % 3)] * 3
      m = Math.max(m, Math.hypot(vertices[a] - vertices[b], vertices[a + 1] - vertices[b + 1], vertices[a + 2] - vertices[b + 2]))
    }
  }
  return m
}

describe('flow lines and bands', () => {
  const rnd = lcg(41)
  const presets: CloudPreset[] = [
    ...FIXTURE_NAMES.map((n) => fixture(n)),
    ...Array.from({ length: 40 }, (_, i) => randomCloud(rnd, `random cloud ${i}`)),
  ]

  // Consecutive points lie on two sides of one triangle, so no step is longer than the
  // triangle's longest side. A chord across the surface would be.
  test('every step joins two sides of one triangle: none is longer than the longest mesh edge, none is zero', () => {
    let lines = 0
    for (const p of presets) {
      if (p.flowCloud.wireframe.mode !== 'spiral') continue
      const { vertices, indices, flowLines, bands } = generateFlowCloud(marchingCubesMessage(p))
      // float32 points: a step equal to the longest edge can round up by an ulp.
      const limit = longestEdge(vertices, indices) * (1 + 1e-6)
      for (const line of flowLines) {
        lines++
        expect(line.length, p.name).toBeGreaterThanOrEqual(6)
        for (let i = 3; i < line.length; i += 3) {
          const step = Math.hypot(line[i] - line[i - 3], line[i + 1] - line[i - 2], line[i + 2] - line[i - 1])
          expect(step, `${p.name} flow line step`).toBeGreaterThan(0)
          expect(step, `${p.name} flow line step`).toBeLessThanOrEqual(limit)
        }
      }
      for (const band of bands) {
        for (let i = 0; i < band.length; i += 6) {
          const seg = Math.hypot(band[i + 3] - band[i], band[i + 4] - band[i + 1], band[i + 5] - band[i + 2])
          expect(seg, `${p.name} band segment`).toBeLessThanOrEqual(limit)
        }
      }
    }
    expect(lines).toBeGreaterThan(500)
  })
})

// ── normalizePreset ──────────────────────────────────────────────────────────

/** What the editor's Export JSON wrote (JSON.stringify(preset, null, 2)) for its default preset. */
function exported(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../fixtures/exports/${file}`, import.meta.url), 'utf8')) as Record<string, unknown>
}
/** Version 1, at 3a00166: the last commit before normalizePreset. */
const V1_EXPORT = exported('v1-default.json')
/** The first commit, ad14f08: `swirls` and `merge`, without the fields later versions added. */
const FIRST_COMMIT_EXPORT = exported('first-commit-default.json')

/** Wrong types, non-finite numbers, and numbers outside or between what the controls produce. */
const GARBAGE: unknown[] = [null, undefined, NaN, -1, 0, 1e9, -1e9, 0.4, 2.5, -0.5, 300, '', 'x', true, [], {}, [1, 2], { a: 1 }]

/** A copy of `v` with random fields deleted, replaced by garbage, or added. */
function mutate(v: unknown, rnd: () => number): unknown {
  if (Array.isArray(v)) return v.map((x) => mutate(x, rnd))
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      const r = rnd()
      if (r < 0.08) continue
      out[k] = r < 0.16 ? GARBAGE[Math.floor(rnd() * GARBAGE.length)] : mutate(x, rnd)
    }
    if (rnd() < 0.05) out.extra = GARBAGE[Math.floor(rnd() * GARBAGE.length)]
    return out
  }
  return rnd() < 0.05 ? GARBAGE[Math.floor(rnd() * GARBAGE.length)] : v
}

describe('normalizePreset', () => {
  test('is idempotent on the fixtures, two old exports and 3,000 mutated presets, JSON round trip included', () => {
    const rnd = lcg(51)
    const inputs: unknown[] = [...FIXTURE_NAMES.map((n) => fixture(n)), V1_EXPORT, FIRST_COMMIT_EXPORT]
    for (let i = 0; i < 1000; i++) {
      inputs.push(mutate(V1_EXPORT, rnd), mutate(FIRST_COMMIT_EXPORT, rnd), mutate(structuredClone(DEFAULT_PRESET), rnd))
    }
    for (const raw of inputs) {
      const once = normalizePreset(raw)
      const twice = normalizePreset(once)
      expect(twice).toEqual(once)
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
      expect(normalizePreset(JSON.parse(JSON.stringify(once)))).toEqual(once)
    }
  })

  // A segment count of 0 or below made the surface-mesh core throw in the curve code, and a
  // fractional resolution made both mesh cores throw allocating the grid. Each preset runs at a
  // resolution of 32: the resolution only sizes the grid, every value normalizePreset gives is
  // one the editor offers (normalizePreset.test.ts), and 256 would take seconds per preset.
  describe('no core throws on a normalized preset', () => {
    const rnd = lcg(53)
    const sources = [V1_EXPORT, FIRST_COMMIT_EXPORT, DEFAULT_PRESET]
    const presets = Array.from({ length: 120 }, (_, i) => {
      const p = normalizePreset(mutate(structuredClone(sources[i % 3]), rnd))
      p.flowCloud.resolution = 32
      p.surfaceMeshResolution = 32
      return p
    })
    for (let first = 0; first < presets.length; first += 30) {
      test(`mutated presets ${first} to ${first + 29}`, () => {
        for (const p of presets.slice(first, first + 30)) {
          const fc = generateFlowCloud(marchingCubesMessage(p))
          generateSurfaceMesh(surfaceMeshMessage(p))
          // Segments through every sphere, along the base and tail, and across the flow cloud.
          const segment = (a: readonly number[], b: readonly number[]) => [a[0], a[1], a[2], b[0], b[1], b[2]]
          const around = (c: readonly number[]) => segment([c[0] - 1, c[1], c[2]], [c[0] + 1, c[1], c[2]])
          cutAndGlue({
            spheres: p.spheres,
            base: p.base,
            tail: p.tail,
            sphereEdgeGroups: p.spheres.map((s) => ({ sphereId: s.id, edges: new Float32Array(around(s.position)) })),
            baseEdges: new Float32Array(p.base.controlPoints.flatMap(around)),
            tailEdges: new Float32Array(p.tail.setpoints.flatMap((sp) => around(sp.position))),
            spiralEdges: new Float32Array(segment([-3, -3, -3], [3, 3, 3])),
            flowCloudEdges: fc.vertices.slice(0, 600),
          })
        }
      })
    }
  })

  test('a version-1 export of the default preset becomes the version-2 DEFAULT_PRESET', () => {
    expect(V1_EXPORT.version).toBe(1)
    expect(V1_EXPORT).not.toHaveProperty('surfaceMeshResolution')
    expect(normalizePreset(V1_EXPORT)).toEqual(DEFAULT_PRESET)
    expect(JSON.stringify(normalizePreset(V1_EXPORT))).toBe(JSON.stringify(DEFAULT_PRESET))
  })

  test("a version-1 export with a 'start' tail, NaN fields (null in JSON) and missing fields", () => {
    const v1 = structuredClone(V1_EXPORT) as unknown as CloudPreset
    v1.spheres[0].radius = NaN
    v1.base.controlPoints[0][0] = NaN
    delete (v1.base as Partial<BaseDef>).ringSegments
    Object.assign(v1.tail, { attachToBase: 'start', attachOffset: 0.3 })
    delete (v1.tail as Partial<CloudPreset['tail']>).lengthSegments
    v1.spirals = [{ id: 'sp', position: [0, 2, 0], rotation: [0, 0, 0], startRadius: 0.1, endRadius: 1, turns: 2, separation: 0.3, taperPower: 1, rungDensity: 8, spiralType: 'golden' } as CloudPreset['spirals'][number]]
    const out = normalizePreset(JSON.parse(JSON.stringify(v1)))
    expect(out.spheres[0].radius).toBe(1)
    expect(out.base.controlPoints[0]).toEqual([0, -0.8, 0])
    expect(out.base.ringSegments).toBe(16)
    expect(out.tail).toMatchObject({ attachToBase: 'start', attachOffset: 0.7, lengthSegments: 32 })
    expect(out.spirals[0]).toMatchObject({ thickness: 0, cornerRadius: 0 })
    // Version 1 attached a 'start' tail attachOffset of the way from the base's start; it stays there.
    const v1Point = basePointAt(out.base, 0.3)
    const start = attachedTail(out.tail, out.base).setpoints[0].position
    expect(start.every((c, k) => Math.abs(c - v1Point[k]) < 1e-12)).toBe(true)
  })

  test("the first commit's export (swirls, merge; no rotation, half or segment counts) gets every later field", () => {
    const out = normalizePreset(FIRST_COMMIT_EXPORT)
    expect(out.spheres.map((s) => s.id)).toEqual(['swirl-0', 'swirl-1', 'swirl-2'])
    expect(out.spheres.every((s) => s.rotation.join() === '0,0,0' && s.half === false && s.falloff === 2)).toBe(true)
    expect(out.flowCloud).toMatchObject({ resolution: 64, threshold: 1, tailStrength: 0, position: [0, 0, 0] })
    expect(out.flowCloud.wireframe).toMatchObject({ numFlowLines: 8, generateBands: false, frontPoint: [0, 0, 2], backPoint: [0, 0, -2] })
    expect(out.base).toMatchObject({ ringSegments: 16, lengthSegments: 24 })
    expect(out.tail).toMatchObject({ radialSegments: 12, lengthSegments: 32, attachToBase: 'end', attachOffset: 1 })
    expect(out.spirals).toEqual([])
    expect(out.surfaceMeshResolution).toBe(64)
  })

  test('both old exports, normalized, give finite, closed meshes', () => {
    for (const raw of [V1_EXPORT, FIRST_COMMIT_EXPORT]) {
      const p = normalizePreset(raw)
      p.flowCloud.resolution = 32
      p.surfaceMeshResolution = 32
      const fc = generateFlowCloud(marchingCubesMessage(p))
      const sm = generateSurfaceMesh(surfaceMeshMessage(p))
      for (const [positions, indices] of [[fc.vertices, fc.indices], [sm.positions, sm.indices]] as const) {
        expect(indices.length).toBeGreaterThan(0)
        expect(positions.every(Number.isFinite)).toBe(true)
        expect(edgeUse(indices).notShared).toEqual([])
      }
      expect(fc.flowLines.length).toBeGreaterThan(0)
      expect(fc.flowLines.every((l) => l.every(Number.isFinite))).toBe(true)
    }
  })
})
