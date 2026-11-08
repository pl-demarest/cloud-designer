// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, test } from 'vitest'
import { SpiralMesh } from '../../src/engine/views/SpiralMesh'
import { buildSpiralVolume, sampleSpiral, spiralSDF } from '../../src/geometry/primitives/spiral'
import { generateSurfaceMesh } from '../../src/workers/core/surfaceMesh'
import { useCloudStore } from '../../src/store/cloudStore'
import type { SpiralDef } from '../../src/model/types'
import { createViewportStub } from '../helpers/scene'
import { FLAT_SPIRAL, THICK_SPIRAL, fixture, surfaceMeshMessage } from '../fixtures/presets'

/**
 * Spirals (refactor plan D18): what SpiralMesh draws and what the surface mesh models, over
 * several rotations, flat and thick.
 *
 * 1. Bit for bit: the wire SpiralMesh draws equals the wire built as SpiralMesh built it before
 *    D18, with three.js's Matrix4.makeRotationFromEuler and Vector3.applyMatrix4 (reference
 *    below). The kernel computes the same float64 operations in the same order, and both round
 *    once to float32, so nothing looser than equality is needed.
 * 2. Within a tolerance: points 5% inside a thick spiral's drawn cross-section rings are inside
 *    the surface mesh's spiral volume (sampleSpiral, buildSpiralVolume, spiralSDF, as
 *    src/workers/core/surfaceMesh.ts builds it), and points 5% outside are outside. The volume
 *    sweeps its section along the smoothed tangent, at right angles to it, while a drawn ring
 *    lies in the plane of the radial direction and the spiral's axis, which a golden spiral's
 *    path crosses at a constant angle (9.5 degrees for the fixture): the ring is a slanted cut
 *    of the sweep. The two agree only off the surface, by a margin, and only where the path
 *    bends gently against the section: rings closer to the spiral's centre than its thickness
 *    are left out. The gap grows with the thickness: the drawn ring vertices lie within 0.0030
 *    of the volume's surface for the fixture (thickness 0.15, as + Add makes), 0.024 for a
 *    thickness of 0.3 and 0.054 for 0.6, so the check keeps the editor's default proportions.
 */

const store = () => useCloudStore.getState()
const disposers: Array<() => void> = []
afterEach(() => {
  while (disposers.length > 0) disposers.pop()!()
  store().resetToDefault()
})

type V3 = [number, number, number]

/** A pseudo-random sequence, so the rotations are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

// ── The reference: SpiralMesh's geometry code before D18, on three.js's math ──

const SAMPLES_PER_TURN = 64

function referenceWire(def: SpiralDef): Float32Array | null {
  const maxTheta = def.turns * Math.PI * 2
  if (maxTheta < 0.001 || def.endRadius <= 0) return null
  const N = Math.max(2, Math.round(def.turns * SAMPLES_PER_TURN))
  const startR = Math.max(def.startRadius, 0.001)
  const endR = Math.max(def.endRadius, startR + 0.001)
  const getRadius = (theta: number) =>
    def.spiralType === 'golden'
      ? startR * Math.exp((Math.log(endR / startR) / maxTheta) * theta)
      : startR + (endR - startR) * (theta / maxTheta)
  const rotMat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2]))
  const offset = new THREE.Vector3(...def.position)
  const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(rotMat).add(offset)
  const verts: number[] = []
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => verts.push(a.x, a.y, a.z, b.x, b.y, b.z)

  if (!(def.thickness > 0)) {
    const P1: THREE.Vector3[] = []
    const P2: THREE.Vector3[] = []
    for (let i = 0; i <= N; i++) {
      const theta = (i / N) * maxTheta
      const r = getRadius(theta)
      const x = r * Math.cos(theta)
      const y = r * Math.sin(theta)
      const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower)
      P1.push(world(x, y, 0))
      P2.push(world(x, y, def.separation * taper))
    }
    for (let i = 0; i < N; i++) seg(P1[i], P1[i + 1])
    for (let i = 0; i < N; i++) seg(P2[i], P2[i + 1])
    const totalRungs = Math.max(1, Math.round(def.turns * def.rungDensity))
    for (let j = 0; j <= totalRungs; j++) {
      const idx = Math.min(Math.round((j / totalRungs) * N), N)
      seg(P1[idx], P2[idx])
    }
    return new Float32Array(verts)
  }

  const halfThick = def.thickness / 2
  const PA: THREE.Vector3[] = [], PB: THREE.Vector3[] = [], PC: THREE.Vector3[] = [], PD: THREE.Vector3[] = []
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * maxTheta
    const r = getRadius(theta)
    const cosT = Math.cos(theta), sinT = Math.sin(theta)
    const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower)
    const sep = def.separation * taper
    const cx = r * cosT, cy = r * sinT
    PA.push(world(cx - halfThick * cosT, cy - halfThick * sinT, 0))
    PB.push(world(cx + halfThick * cosT, cy + halfThick * sinT, 0))
    PC.push(world(cx + halfThick * cosT, cy + halfThick * sinT, sep))
    PD.push(world(cx - halfThick * cosT, cy - halfThick * sinT, sep))
  }
  for (const curve of [PA, PB, PC, PD]) for (let i = 0; i < N; i++) seg(curve[i], curve[i + 1])
  const totalRings = Math.max(1, Math.round(def.turns * def.rungDensity))
  const cornerR = def.cornerRadius
  const ARC_SEGS = 4
  for (let j = 0; j <= totalRings; j++) {
    const idx = Math.min(Math.round((j / totalRings) * N), N)
    const theta = (idx / N) * maxTheta
    const r = getRadius(theta)
    const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower)
    const sep = def.separation * taper
    const cr = Math.min(cornerR, Math.min(halfThick, sep / 2))
    if (cornerR <= 0 || cr < 0.001) {
      seg(PA[idx], PB[idx]); seg(PB[idx], PC[idx]); seg(PC[idx], PD[idx]); seg(PD[idx], PA[idx])
      continue
    }
    const cosT = Math.cos(theta), sinT = Math.sin(theta)
    const cx = r * cosT, cy = r * sinT
    const hx = halfThick, hy = sep / 2
    const corners: Array<[number, number, number, number]> = [
      [-hx + cr, -hy + cr, Math.PI, Math.PI * 1.5],
      [hx - cr, -hy + cr, Math.PI * 1.5, Math.PI * 2],
      [hx - cr, hy - cr, 0, Math.PI * 0.5],
      [-hx + cr, hy - cr, Math.PI * 0.5, Math.PI],
    ]
    const pts: THREE.Vector3[] = []
    for (const [ccx, ccy, startA, endA] of corners) {
      for (let k = 0; k <= ARC_SEGS; k++) {
        const a = startA + (endA - startA) * (k / ARC_SEGS)
        const lr = ccx + cr * Math.cos(a), ls = ccy + cr * Math.sin(a)
        pts.push(world(cx + lr * cosT, cy + lr * sinT, hy + ls))
      }
    }
    for (let k = 0; k < pts.length; k++) seg(pts[k], pts[(k + 1) % pts.length])
  }
  return new Float32Array(verts)
}

// ── What SpiralMesh draws ────────────────────────────────────────────────────

/** The position array of the wire SpiralMesh draws for `def` (null without one). */
function drawnWire(def: SpiralDef): Float32Array | null {
  store().loadPreset({ ...store().preset, spirals: [def] })
  const vp = createViewportStub()
  const mesh = new SpiralMesh(vp)
  disposers.push(() => mesh.dispose())
  const wire = vp.spiralGroup.children.find((c) => c instanceof THREE.LineSegments && !c.userData.editorOnly) as THREE.LineSegments
  const pos = wire.geometry.getAttribute('position')
  return pos ? (pos.array as Float32Array) : null
}

const SPIRALS: Array<[string, SpiralDef]> = [
  ['the flat fixture', FLAT_SPIRAL],
  ['a flat golden spiral, taper 0', { ...FLAT_SPIRAL, spiralType: 'golden', taperPower: 0 }],
  ['the thick fixture (rounded corners)', THICK_SPIRAL],
  ['thick, sharp corners', { ...THICK_SPIRAL, cornerRadius: 0 }],
  ['thick, corner radius below 0.001 (drawn sharp)', { ...THICK_SPIRAL, cornerRadius: 0.0005 }],
  ['thick archimedean, quarter turn', { ...THICK_SPIRAL, spiralType: 'archimedean', turns: 0.25 }],
  ['thick, taper 2', { ...THICK_SPIRAL, taperPower: 2 }],
]

/** The fixtures' own rotations and positions, the identity, and ten random ones. */
function poses(): Array<{ rotation: V3; position: V3 }> {
  const rnd = lcg(31)
  const out: Array<{ rotation: V3; position: V3 }> = [
    { rotation: [0, 0, 0], position: [0, 0, 0] },
    { rotation: [0.4, 0.2, 0.1], position: [0.5, 2.2, -0.3] },
  ]
  for (let n = 0; n < 10; n++) {
    out.push({
      rotation: [(rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI, (rnd() * 2 - 1) * Math.PI],
      position: [rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4],
    })
  }
  return out
}

describe('SpiralMesh draws the spiral three.js math draws, bit for bit', () => {
  for (const [name, spiral] of SPIRALS) {
    test(`${name}, at 12 rotations and positions`, () => {
      for (const pose of poses()) {
        const def = { ...spiral, ...pose }
        const want = referenceWire(def)
        const got = drawnWire(def)
        const label = `rotation ${pose.rotation}, position ${pose.position}`
        expect(got === null, label).toBe(want === null)
        if (!want || !got) continue
        expect(got.length, label).toBe(want.length)
        for (let i = 0; i < want.length; i++) {
          if (!Object.is(got[i], want[i])) expect.fail(`${label}: float ${i} is ${got[i]}, three gives ${want[i]}`)
        }
      }
    })
  }

  test('a spiral of no turns draws no wire', () => {
    expect(drawnWire({ ...THICK_SPIRAL, turns: 0 })).toBeNull()
    expect(drawnWire({ ...FLAT_SPIRAL, endRadius: 0 })).toBeNull()
  })
})

describe("the surface mesh's spiral volume is the thick spiral SpiralMesh draws", () => {
  /** The cross-section rings of the drawn wire, after its four lengthwise curves: their vertices
   *  (each segment's first point), their centre (the vertices' mean) and the path's distance
   *  from the spiral's centre there. */
  function drawnRings(def: SpiralDef): Array<{ centre: V3; vertices: V3[]; radius: number }> {
    const wire = drawnWire(def)!
    const N = Math.max(2, Math.round(def.turns * SAMPLES_PER_TURN))
    const maxTheta = def.turns * Math.PI * 2
    const totalRings = Math.max(1, Math.round(def.turns * def.rungDensity))
    const perRing = (wire.length / 6 - 4 * N) / (totalRings + 1)
    expect(Number.isInteger(perRing)).toBe(true)
    const rings: Array<{ centre: V3; vertices: V3[]; radius: number }> = []
    for (let j = 0; j <= totalRings; j++) {
      const vertices: V3[] = []
      for (let k = 0; k < perRing; k++) {
        const o = (4 * N + j * perRing + k) * 6
        vertices.push([wire[o], wire[o + 1], wire[o + 2]])
      }
      const centre = [0, 1, 2].map((a) => vertices.reduce((s, v) => s + v[a], 0) / perRing) as V3
      const theta = (Math.min(Math.round((j / totalRings) * N), N) / N) * maxTheta
      const radius = def.spiralType === 'golden'
        ? def.startRadius * Math.exp((Math.log(def.endRadius / def.startRadius) / maxTheta) * theta)
        : def.startRadius + (def.endRadius - def.startRadius) * (theta / maxTheta)
      rings.push({ centre, vertices, radius })
    }
    return rings
  }

  const THICK: Array<[string, SpiralDef]> = [
    ['the thick fixture', THICK_SPIRAL],
    ['sharp corners', { ...THICK_SPIRAL, cornerRadius: 0 }],
    ['taper 0', { ...THICK_SPIRAL, taperPower: 0 }],
    // An Archimedean path crosses its rings at a small angle only away from its centre.
    ['archimedean, wide inner radius', { ...THICK_SPIRAL, spiralType: 'archimedean', startRadius: 0.6 }],
  ]
  for (const [name, spiral] of THICK) {
    test(`${name}: points 5% inside the drawn rings are inside, 5% outside are outside, at 12 poses`, () => {
      for (const pose of poses()) {
        const def = { ...spiral, ...pose }
        const volume = buildSpiralVolume(sampleSpiral(def, SAMPLES_PER_TURN))
        // The end rings lie on the volume's end faces.
        const rings = drawnRings(def).slice(1, -1).filter((ring) => ring.radius >= def.thickness)
        let checked = 0
        for (const { centre, vertices } of rings) {
          for (const v of vertices) {
            const at = (f: number) => [0, 1, 2].map((a) => centre[a] + f * (v[a] - centre[a])) as V3
            const [ix, iy, iz] = at(0.95)
            const [ox, oy, oz] = at(1.05)
            expect(spiralSDF(ix, iy, iz, volume), `${pose.rotation}: inside ${at(0.95)}`).toBeLessThan(0)
            expect(spiralSDF(ox, oy, oz, volume), `${pose.rotation}: outside ${at(1.05)}`).toBeGreaterThan(0)
            checked++
          }
        }
        expect(checked).toBeGreaterThan(40)
      }
    })
  }

  test('a corner radius below 0.001, whose rings SpiralMesh draws sharp, is sharp in the volume', () => {
    for (const cornerRadius of [0.0005, 0.0009]) {
      const v = buildSpiralVolume(sampleSpiral({ ...THICK_SPIRAL, cornerRadius }, SAMPLES_PER_TURN))
      // At a sample halfway along, in the volume's own section frame: the radial direction made
      // perpendicular to the tangent, and the tangent times it.
      const i = Math.floor(v.n / 2)
      const at = (a: Float64Array) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]]
      const [tx, ty, tz] = at(v.tangent)
      let [rx, ry, rz] = at(v.radial)
      const rt = rx * tx + ry * ty + rz * tz
      rx -= rt * tx; ry -= rt * ty; rz -= rt * tz
      const rl = Math.hypot(rx, ry, rz)
      rx /= rl; ry /= rl; rz /= rl
      const sx = ty * rz - tz * ry, sy = tz * rx - tx * rz, sz = tx * ry - ty * rx
      const [cx, cy, cz] = at(v.centre)
      const a = v.halfThick[i] - 1e-5, b = v.halfSep[i] - 1e-5
      for (const [ka, kb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const d = spiralSDF(cx + ka * a * rx + kb * b * sx, cy + ka * a * ry + kb * b * sy, cz + ka * a * rz + kb * b * sz, v)
        expect(d, `corner radius ${cornerRadius}, corner (${ka}, ${kb})`).toBeLessThan(0)
      }
    }
  })

  test('a flat spiral has no volume: the surface mesh is the same without it', () => {
    const without = surfaceMeshMessage(fixture('flatSpiral'))
    const withFlat = generateSurfaceMesh(without)
    const none = generateSurfaceMesh({ ...without, spirals: [] })
    expect(without.spirals).toHaveLength(1)
    expect(withFlat.positions).toEqual(none.positions)
    expect(withFlat.indices).toEqual(none.indices)
  })
})
