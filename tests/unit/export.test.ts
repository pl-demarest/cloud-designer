// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { REVOKE_DELAY_MS, downloadBlob, safeFileName } from '../../src/export/download'
import { cloneExportable, cloudScene, fullScene, scaffoldScene, wireframeScene, type ExportSources } from '../../src/export/scenes'
import { THICK_SPIRAL, fixture } from '../fixtures/presets'
import { buildEditorScene, installFakeWorker, regenerateFlowCloud, type EditorScene } from '../helpers/scene'
import { installCanvas2dStub } from '../helpers/engine'

/**
 * src/export: file names, the download link, and the GLB scenes, which copy the editor's groups
 * without anything flagged userData.editorOnly (audit export-includes-handles,
 * export-full-omits-tail-spirals, export-filename, export-json-duplicate).
 */

describe('safeFileName', () => {
  const cases: Array<[string, string]> = [
    ['Default Cloud', 'default-cloud'],
    ['Storm Front', 'storm-front'],
    ['  spaced   out  ', 'spaced-out'],
    ['a/b:c?d*e', 'a-b-c-d-e'],
    ['Nuage d’été', 'nuage-d-ete'],
    ['keep_under-score', 'keep_under-score'],
    ['---', 'cloud'],
    ['', 'cloud'],
    ['雲', 'cloud'],
    ['x'.repeat(200), 'x'.repeat(80)],
  ]
  for (const [name, stem] of cases) test(JSON.stringify(name.slice(0, 20)), () => expect(safeFileName(name)).toBe(stem))
})

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('clicks a link that names the file, then revokes the URL later, not at once', () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicks: Array<{ href: string; download: string; attached: boolean }> = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, attached: this.isConnected })
    })

    downloadBlob(new Blob(['{}'], { type: 'application/json' }), 'default-cloud-preset.json')
    expect(create).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([{ href: 'blob:test', download: 'default-cloud-preset.json', attached: true }])
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})

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

  test('without a flow cloud: no wireframe scene; the full scene has the scaffold, tail and spirals', () => {
    expect(wireframeScene(sources())).toBeNull()
    const full = outline(fullScene(sources())!)
    expect(full.names).toEqual(['cloud', 'scaffold', 'spheres', 'base', 'tail', 'spirals'])
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
    expect(full.names.slice(0, 6)).toEqual(['cloud', 'scaffold', 'spheres', 'base', 'tail', 'spirals'])
    expect(full.names).toContain('wireframe')
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
