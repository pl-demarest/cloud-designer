import * as THREE from 'three'
import type { Page } from '@playwright/test'
import { canvasPixels, expect, openApp, test, toolbarButton, viewportCanvas } from './helpers'

// Viewport dragging in Chrome, with real pointer capture (the unit tests stub it). The camera
// the app opens with is at (0, 4, 10), looking at the origin, with a 50-degree field of view
// (src/engine/Viewport.ts); sphere 1's handle sits at its centre, (1.6, 0.3, 0).

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

/** The page coordinates of a world point in the opening view. */
async function onScreen(page: Page, point: THREE.Vector3): Promise<{ x: number; y: number; box: { x: number; y: number; width: number; height: number } }> {
  const box = (await viewportCanvas(page).boundingBox())!
  const camera = new THREE.PerspectiveCamera(50, box.width / box.height, 0.01, 1000)
  camera.position.set(0, 4, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const p = point.clone().project(camera)
  return { x: box.x + ((p.x + 1) / 2) * box.width, y: box.y + ((1 - p.y) / 2) * box.height, box }
}

test('dragging a sphere handle, released outside the canvas, is one undo step', async ({ page }) => {
  const { x, y, box } = await onScreen(page, new THREE.Vector3(1.6, 0.3, 0))
  const before = await canvasPixels(page)
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()

  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + 8 * i, y)
  // Pointer capture delivers the release to the canvas.
  await page.mouse.move(box.x + box.width + 50, y)
  await page.mouse.up()
  expect(await canvasPixels(page), 'the sphere moved').not.toEqual(before)
  await expect(toolbarButton(page, 'Undo')).toBeEnabled()

  await toolbarButton(page, 'Undo').click()
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
  expect(await canvasPixels(page), 'Undo puts the sphere back').toEqual(before)
})

// The name records its edit when it loses focus. A press on a handle opened the drag's history
// gesture before Chrome moved the focus, so the rename landed inside the gesture and one Undo
// took back both.
test('a rename stays its own undo step when a handle drag takes the focus', async ({ page }) => {
  const { x, y } = await onScreen(page, new THREE.Vector3(1.6, 0.3, 0))
  const name = page.getByRole('textbox', { name: 'Cloud name' })
  await name.fill('Storm')
  const before = await canvasPixels(page)

  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + 8 * i, y)
  await page.mouse.up()
  expect(await canvasPixels(page), 'the sphere moved').not.toEqual(before)

  await toolbarButton(page, 'Undo').click()
  expect(await canvasPixels(page), 'Undo puts the sphere back').toEqual(before)
  await expect(name, 'the rename is a step of its own').toHaveValue('Storm')
  await toolbarButton(page, 'Undo').click()
  await expect(name).toHaveValue('Default Cloud')
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
})

test('after a drag the orbit controls work again', async ({ page }) => {
  const { x, y, box } = await onScreen(page, new THREE.Vector3(1.6, 0.3, 0))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 20, y, { steps: 3 })
  await page.mouse.up()
  const dragged = await canvasPixels(page)

  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 5 })
  await page.mouse.up()
  // OrbitControls damps the rotation over the following frames.
  await page.waitForTimeout(500)
  expect(await canvasPixels(page), 'the camera turned').not.toEqual(dragged)
  await expect(toolbarButton(page, 'Undo')).toBeEnabled()
})
