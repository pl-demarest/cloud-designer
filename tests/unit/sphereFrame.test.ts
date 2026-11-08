// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, test } from 'vitest'
import { eulerXYZ } from '../../src/geometry/mat3'
import { insideSphere, sphereFieldTerm, sphereFrame, sphereSDF } from '../../src/geometry/primitives/sphere'
import { SphereMesh } from '../../src/three/SphereMesh'
import { useCloudStore } from '../../src/store/cloudStore'
import { createViewportStub } from '../helpers/scene'
import { fixture } from '../fixtures/presets'
import type { SphereDef } from '../../src/model/types'

/** The sphere's local frame (src/geometry/mat3.ts, src/geometry/primitives/sphere.ts), on its own. */

/** A pseudo-random sequence, so the angles are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

describe('eulerXYZ', () => {
  test("equals three's Matrix4.makeRotationFromEuler (order 'XYZ') on 1,000 random angle triples", () => {
    const rnd = lcg(3)
    const m4 = new THREE.Matrix4()
    for (let n = 0; n < 1000; n++) {
      const [x, y, z] = [0, 1, 2].map(() => (rnd() * 2 - 1) * 2 * Math.PI)
      const te = m4.makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')).elements // column-major
      const m = eulerXYZ(x, y, z) // row-major
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) expect(m[3 * row + col]).toBe(te[4 * col + row])
      }
    }
  })
})

describe('sphere frame', () => {
  afterEach(() => useCloudStore.getState().resetToDefault())

  const ROTATED: SphereDef[] = fixture('rotated').spheres.slice(1) // a rotated ellipsoid and a rotated half sphere

  /** SphereMesh's wire vertices for `def`, in world space. */
  function drawn(def: SphereDef): THREE.Vector3[] {
    const p = fixture('default')
    p.spheres = [def]
    useCloudStore.getState().loadPreset(p)
    const mesh = new SphereMesh(createViewportStub())
    const edges = mesh.getEdgesGrouped()[0].edges
    mesh.dispose()
    const out: THREE.Vector3[] = []
    for (let i = 0; i < edges.length; i += 3) out.push(new THREE.Vector3(edges[i], edges[i + 1], edges[i + 2]))
    return out
  }

  for (const def of ROTATED) {
    test(`${def.shape}${def.half ? ' (half)' : ''}: every drawn vertex is on the surface, distance 0`, () => {
      const f = sphereFrame(def)
      // The wire is float32 and its dome rim lies on the base plane, where both terms are 0.
      for (const v of drawn(def)) expect(Math.abs(sphereSDF(v.x, v.y, v.z, f))).toBeLessThan(1e-6)
    })
  }

  test('a half sphere is the dome above its rotated base plane', () => {
    const def = ROTATED[1]
    const f = sphereFrame(def)
    const up = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...def.rotation, 'XYZ'))
    const c = new THREE.Vector3(...def.position)
    const above = c.clone().addScaledVector(up, 0.5)
    const below = c.clone().addScaledVector(up, -0.5)
    expect(insideSphere(above.x, above.y, above.z, f)).toBe(true)
    expect(insideSphere(below.x, below.y, below.z, f)).toBe(false)
    expect(sphereSDF(below.x, below.y, below.z, f)).toBeCloseTo(0.5, 12)
  })

  test('the field term is constant on the drawn surface: falloff, as r^2 / d^2 = 1 there', () => {
    const def = ROTATED[0]
    const f = sphereFrame(def)
    for (const v of drawn(def)) expect(sphereFieldTerm(v.x, v.y, v.z, f)).toBeCloseTo(def.falloff, 5)
  })
})
