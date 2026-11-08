// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { cloneExportable, cloudScene, fullScene, scaffoldScene, wireframeScene, type ExportSources } from '../../src/export/scenes'
import { THICK_SPIRAL, fixture } from '../fixtures/presets'
import { buildEditorScene, installFakeWorker, regenerateFlowCloud, type EditorScene } from '../helpers/scene'
import { installCanvas2dStub } from '../helpers/engine'

/**
 * src/export: the GLB scenes, which copy the editor's groups without anything flagged
 * userData.editorOnly (audit export-includes-handles).
 */

describe('cloneExportable', () => {
  test('copies the tree without editor-only objects, sharing geometry and material', () => {
    const geometry = new THREE.BufferGeometry()
    const material = new THREE.LineBasicMaterial()
    const root = new THREE.Group()
    const wire = new THREE.LineSegments(geometry, material)
    const handle = Object.assign(new THREE.Mesh(), { name: 'handle' })
    handle.userData.editorOnly = true
    const nested = new THREE.Group()
    const flaggedGroup = new THREE.Group()
    flaggedGroup.userData.editorOnly = true
    flaggedGroup.add(new THREE.LineSegments(geometry, material))
    nested.add(new THREE.Line(geometry, material), flaggedGroup)
    root.add(wire, handle, nested)

    const copy = cloneExportable(root)!
    expect(copy).not.toBe(root)
    expect(copy.children.map((c) => c.type)).toEqual(['LineSegments', 'Group'])
    expect(copy.children[1].children.map((c) => c.type)).toEqual(['Line'])
    const copiedWire = copy.children[0] as THREE.LineSegments
    expect(copiedWire.geometry).toBe(geometry)
    expect(copiedWire.material).toBe(material)
    expect(root.children, 'the original keeps its children').toHaveLength(3)
  })

  test('an editor-only root gives null', () => {
    const handle = new THREE.Mesh()
    handle.userData.editorOnly = true
    expect(cloneExportable(handle)).toBeNull()
  })
})

describe('the GLB scenes over the editor scene', () => {
  let scene: EditorScene

  beforeAll(() => {
    installFakeWorker()
    installCanvas2dStub()
    const p = fixture('default')
    p.spirals = [structuredClone(THICK_SPIRAL)]
    scene = buildEditorScene(p)
  })
  afterAll(() => scene.dispose())

  const sources = (): ExportSources => ({ ...scene.engine.scaffoldGroups(), flowCloud: scene.vp.flowCloudGroup })

  /** Names of the named objects, and the types of the drawing ones, depth first. */
  function outline(root: THREE.Object3D) {
    const names: string[] = []
    const types = new Set<string>()
    let editorOnly = 0
    root.traverse((o) => {
      if (o.name) names.push(o.name)
      if ('geometry' in o) types.add(o.type)
      if (o.userData.editorOnly) editorOnly++
    })
    return { names, types, editorOnly }
  }

  test('the editor groups do hold handles (what the exports leave out)', () => {
    const groups: THREE.Group[] = Object.values(sources())
    const handles = groups.flatMap((g) => g.children.filter((c) => c.userData.editorOnly))
    expect(handles.length).toBeGreaterThan(5)
  })

  test('without a flow cloud: no wireframe scene; the full scene is the scaffold', () => {
    expect(wireframeScene(sources())).toBeNull()
    const full = outline(fullScene(sources())!)
    expect(full.names).toEqual(['cloud', 'scaffold', 'spheres', 'base'])
    expect(full.types).toEqual(new Set(['LineSegments']))
    expect(full.editorOnly).toBe(0)
  })

  test('after Regenerate: scaffold, wireframe and full scenes, none with a handle', async () => {
    await regenerateFlowCloud(scene)
    const scaffold = outline(scaffoldScene(sources())!)
    expect(scaffold.names).toEqual(['scaffold', 'spheres', 'base'])
    expect(scaffold.types).toEqual(new Set(['LineSegments']))

    const wire = outline(wireframeScene(sources())!)
    expect(wire.names.slice(0, 2)).toEqual(['cloud-wireframe', 'body'])
    expect(wire.names).toEqual(expect.arrayContaining(['flowLines', 'tail', 'spirals']))
    expect(wire.types, 'flow lines stay line strips').toEqual(new Set(['LineSegments', 'Line']))

    const full = outline(fullScene(sources())!)
    expect(full.names.slice(0, 5)).toEqual(['cloud', 'scaffold', 'spheres', 'base', 'wireframe'])
    for (const o of [scaffold, wire, full]) expect(o.editorOnly).toBe(0)
  })

  test('the part copies keep the flow-cloud group transform', () => {
    scene.vp.flowCloudGroup.position.set(1, 2, 3)
    const body = wireframeScene(sources())!.getObjectByName('body')!
    expect(body.position.toArray()).toEqual([1, 2, 3])
    scene.vp.flowCloudGroup.position.set(0, 0, 0)
  })
})

describe('cloudScene', () => {
  test('one LineSegments under "cloud"; dispose frees its geometry and material', () => {
    const edges = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1])
    const { scene, dispose } = cloudScene(edges)
    expect(scene.name).toBe('cloud')
    expect(scene.children.map((c) => c.type)).toEqual(['LineSegments'])
    const lines = scene.children[0] as THREE.LineSegments
    expect(lines.geometry.getAttribute('position').array).toBe(edges)
    const freed: string[] = []
    lines.geometry.addEventListener('dispose', () => freed.push('geometry'))
    ;(lines.material as THREE.Material).addEventListener('dispose', () => freed.push('material'))
    dispose()
    expect(freed).toEqual(['geometry', 'material'])
  })
})
