import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { cutAndGlue, expect, openApp, openPanel, regenerate, test } from './helpers'

interface Download {
  name: string
  bytes: Buffer
}

async function download(page: Page, button: Locator): Promise<Download> {
  const [dl] = await Promise.all([page.waitForEvent('download'), button.click()])
  const path = await dl.path()
  return { name: dl.suggestedFilename(), bytes: await readFile(path) }
}

/** Click a button that raises window.alert; accept the alert and return its message. */
async function clickForAlert(page: Page, button: Locator): Promise<string> {
  const message = new Promise<string>((resolve) => {
    page.once('dialog', (dialog) => {
      resolve(dialog.message())
      void dialog.accept()
    })
  })
  await button.click()
  return message
}

interface GltfJson {
  asset: { version: string }
  nodes: { name?: string; mesh?: number }[]
  meshes: { primitives: { mode?: number }[] }[]
}

const GLB_MAGIC = 0x46546c67 // "glTF", little-endian
const CHUNK_JSON = 0x4e4f534a // "JSON", little-endian
const MODE_LINES = 1
const MODE_TRIANGLES = 4

/** Parse the header and JSON chunk of a binary glTF file. */
function parseGlb(bytes: Buffer): GltfJson {
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('glTF')
  expect(bytes.readUInt32LE(0)).toBe(GLB_MAGIC)
  expect(bytes.readUInt32LE(4), 'GLB container version').toBe(2)
  expect(bytes.readUInt32LE(8), 'declared length').toBe(bytes.length)
  const jsonLength = bytes.readUInt32LE(12)
  expect(bytes.readUInt32LE(16)).toBe(CHUNK_JSON)
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as GltfJson
}

/** Triangle primitives: in these exports only the editor's box and sphere drag handles are triangle meshes. */
function triangleMeshCount(gltf: GltfJson): number {
  return gltf.meshes.filter((m) => m.primitives.some((p) => (p.mode ?? MODE_TRIANGLES) === MODE_TRIANGLES)).length
}

function nodeNames(gltf: GltfJson): string[] {
  return gltf.nodes.map((n) => n.name ?? '').filter((n) => n !== '')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

function exportButton(page: Page, name: string): Locator {
  return page.locator('.accordion-body .export-buttons').getByRole('button', { name, exact: true })
}

test('Export JSON Preset downloads the current preset as version 1 JSON', async ({ page }) => {
  await openPanel(page, 'Export')
  const { name, bytes } = await download(page, exportButton(page, 'Export JSON Preset'))
  expect(name).toBe('default-cloud-preset.json')

  const preset = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
  for (const key of ['spheres', 'base', 'tail', 'spirals', 'flowCloud']) expect(preset, key).toHaveProperty(key)
  expect(preset.version).toBe(1)
  expect(preset.name).toBe('Default Cloud')
  expect(preset.spheres).toHaveLength(3)
  expect(preset.spirals).toEqual([])
})

test('Export JSON reflects edits and the preset name', async ({ page }) => {
  await page.getByPlaceholder('Cloud name...').fill('Storm Front')
  const spheres = await openPanel(page, 'Spheres')
  await spheres.getByRole('button', { name: '+ Add' }).click()
  const spirals = await openPanel(page, 'Spirals')
  await spirals.getByRole('button', { name: '+ Add' }).click()

  await openPanel(page, 'Export')
  const { name, bytes } = await download(page, exportButton(page, 'Export JSON Preset'))
  expect(name).toBe('storm-front-preset.json')
  const preset = JSON.parse(bytes.toString('utf8')) as { spheres: unknown[]; spirals: unknown[] }
  expect(preset.spheres).toHaveLength(4)
  expect(preset.spirals).toHaveLength(1)
})

test('Export Scaffold GLB downloads a binary glTF of spheres and base', async ({ page }) => {
  await openPanel(page, 'Export')
  const { name, bytes } = await download(page, exportButton(page, 'Export Scaffold GLB'))
  expect(name).toBe('default-cloud-scaffold.glb')
  const gltf = parseGlb(bytes)
  expect(gltf.asset.version).toBe('2.0')
  expect(nodeNames(gltf)).toEqual(['scaffold', 'spheres', 'base'])
  const lineMeshes = gltf.meshes.filter((m) => m.primitives.every((p) => p.mode === MODE_LINES))
  expect(lineMeshes, 'three sphere wireframes plus the base wireframe').toHaveLength(4)
})

test('Export Both (Full) downloads a binary glTF', async ({ page }) => {
  await regenerate(page)
  await openPanel(page, 'Export')
  const { name, bytes } = await download(page, exportButton(page, 'Export Both (Full)'))
  expect(name).toBe('default-cloud-full.glb')
  const names = nodeNames(parseGlb(bytes))
  expect(names.slice(0, 3)).toEqual(['cloud', 'scaffold', 'spheres'])
  expect(names).toContain('wireframe')
  expect(names).toContain('flowLines')
})

test('Export Wireframe GLB needs a generated flow cloud', async ({ page }) => {
  await openPanel(page, 'Export')
  expect(await clickForAlert(page, exportButton(page, 'Export Wireframe GLB'))).toBe('No flow cloud geometry. Click Regenerate first.')

  await regenerate(page)
  await openPanel(page, 'Export')
  const { name, bytes } = await download(page, exportButton(page, 'Export Wireframe GLB'))
  expect(name).toBe('default-cloud-wireframe.glb')
  const names = nodeNames(parseGlb(bytes))
  expect(names).toEqual(expect.arrayContaining(['cloud-wireframe', 'body', 'flowLines', 'tail']))
})

test('Export Cloud GLB needs Cut & Glue and contains only line segments', async ({ page }) => {
  await openPanel(page, 'Export')
  expect(await clickForAlert(page, exportButton(page, 'Export Cloud GLB'))).toBe('Run Cut & Glue first to generate the unified cloud wireframe.')

  await regenerate(page)
  await cutAndGlue(page)
  await openPanel(page, 'Export')
  const { name, bytes } = await download(page, exportButton(page, 'Export Cloud GLB'))
  expect(name).toBe('default-cloud-cloud.glb')
  const gltf = parseGlb(bytes)
  expect(nodeNames(gltf)).toEqual(['cloud'])
  expect(gltf.meshes).toHaveLength(1)
  expect(gltf.meshes[0].primitives.map((p) => p.mode)).toEqual([MODE_LINES])
  expect(triangleMeshCount(gltf)).toBe(0)
})

// Audit findings "Scaffold and wireframe GLB exports include editor drag-handle meshes"
// (src/components/ExportPanel.tsx:61) and "Base and tail handles use isBaseHandle/isTailHandle, so
// ExportPanel exports them into GLBs" (src/three/BaseMesh.ts:150). Measured on the default preset:
// scaffold 7 triangle meshes (3 sphere + 4 base handles), wireframe 3 (tail handles), full 7.
for (const [button, file] of [
  ['Export Scaffold GLB', 'scaffold'],
  ['Export Wireframe GLB', 'wireframe'],
  ['Export Both (Full)', 'full'],
] as const) {
  test(`${file} GLB contains no editor handle meshes`, async ({ page }) => {
    test.fail(true, 'export finding: GLB exports include editor drag handles')
    await regenerate(page)
    await openPanel(page, 'Export')
    const { bytes } = await download(page, exportButton(page, button))
    expect(triangleMeshCount(parseGlb(bytes))).toBe(0)
  })
}

test('Export Both (Full) includes the tail and spirals', async ({ page }) => {
  // Audit finding: "'Export Both (Full)' omits tail and spirals although docs say it contains all
  // geometry" (src/components/ExportPanel.tsx:124).
  test.fail(true, 'export finding: Export Both (Full) omits tail and spirals')
  await regenerate(page)
  await openPanel(page, 'Export')
  const names = nodeNames(parseGlb((await download(page, exportButton(page, 'Export Both (Full)'))).bytes))
  expect(names).toContain('tail')
})
