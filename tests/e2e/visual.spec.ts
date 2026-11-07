import type { Page } from '@playwright/test'
import {
  cutAndGlue,
  expect,
  fieldRow,
  nextFrames,
  openApp,
  openPanel,
  regenerate,
  sliderRow,
  test,
  toolbarButton,
  viewportCanvas,
} from './helpers'

// Screenshot baselines of the viewport canvas and the full page at 1280x800 (playwright.config.ts).
// Baselines are platform-specific (`*-darwin.png`) and live next to this file. Regenerate them with
// `npx playwright test visual --update-snapshots` only in a commit that names the intended change.
//
// Tolerance: `threshold` is Playwright's per-pixel colour distance (0-1, YIQ); `maxDiffPixelRatio` is
// the share of pixels allowed past it (0.002 of the 960x760 canvas is 1,459 pixels). Three runs at
// zero tolerance rendered identical pixels on this machine (2026-11-07), so the budget only absorbs
// driver or anti-aliasing noise. Measured against it: one 0.05 step of sphere 1's radius changes 9,508
// canvas pixels (1.3%) and spiral thickness 0.25 instead of 0.30 changes 3,629 (0.5%); both fail.
const CANVAS = { threshold: 0.1, maxDiffPixelRatio: 0.002 } as const
const PAGE = { threshold: 0.1, maxDiffPixelRatio: 0.002, fullPage: true } as const

/** Thickness after the edit below: the spiral default is 0.15; 15 ArrowRight steps of 0.01 give 0.30. */
const THICKNESS_STEPS = 15

async function snapshot(page: Page, name: string): Promise<void> {
  await nextFrames(page)
  await expect(viewportCanvas(page)).toHaveScreenshot(`${name}-canvas.png`, CANVAS)
  await expect(page).toHaveScreenshot(`${name}-page.png`, PAGE)
}

async function addThickSpiral(page: Page): Promise<void> {
  const body = await openPanel(page, 'Spirals')
  await body.getByRole('button', { name: '+ Add' }).click()
  const item = body.locator('.swirl-item').first()
  await item.locator('.swirl-item-header').click()
  const thickness = sliderRow(item, 'Thickness')
  const input = thickness.locator('input[type=range]')
  await input.focus()
  for (let i = 0; i < THICKNESS_STEPS; i++) await page.keyboard.press('ArrowRight')
  await expect(thickness.locator('.slider-value')).toHaveText((0.15 + THICKNESS_STEPS * 0.01).toFixed(2))
  // Move focus off the slider so no focus ring is captured.
  await input.blur()
}

async function showSurfaceMesh(page: Page): Promise<void> {
  const box = fieldRow(await openPanel(page, 'Flow Cloud'), 'Surface Mesh').locator('input[type=checkbox]')
  await box.check()
  await expect(box).toBeChecked()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('initial edit view', async ({ page }) => {
  await snapshot(page, 'initial')
})

test('after Regenerate', async ({ page }) => {
  await regenerate(page)
  await snapshot(page, 'regenerated')
})

test('Preview after Cut & Glue', async ({ page }) => {
  await regenerate(page)
  await cutAndGlue(page)
  await toolbarButton(page, 'Preview').click()
  await snapshot(page, 'preview-cut-glue')
})

test('Preview with Surface Mesh', async ({ page }) => {
  await regenerate(page)
  await cutAndGlue(page)
  await toolbarButton(page, 'Preview').click()
  await showSurfaceMesh(page)
  await snapshot(page, 'preview-surface-mesh')
})

test('thick spiral in the edit view', async ({ page }) => {
  await addThickSpiral(page)
  await snapshot(page, 'thick-spiral')
})

test('thick spiral in the surface mesh', async ({ page }) => {
  await addThickSpiral(page)
  await regenerate(page)
  await cutAndGlue(page)
  await toolbarButton(page, 'Preview').click()
  await showSurfaceMesh(page)
  await snapshot(page, 'thick-spiral-surface-mesh')
})
