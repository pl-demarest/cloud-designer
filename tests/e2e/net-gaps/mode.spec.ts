import { canvasPixels, cutAndGlue, expect, fieldRow, openApp, openPanel, regenerate, sliderRow, test, toolbarButton } from '../helpers'

// Mode and visibility paths the main suite does not reach, found by mutation testing (Stage A net
// check, 2026-11-07). App.handleModeChange and App.handleToggleSurfaceMesh each decide whether the
// spiral group shows in Preview; the main suite only enters Preview before the Surface Mesh box is
// checked, so the handleModeChange branch for "surface mesh already on, flat spiral present" was
// never run.

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('re-entering Preview with the surface mesh on keeps a flat spiral visible', async ({ page }) => {
  const spirals = await openPanel(page, 'Spirals')
  await spirals.getByRole('button', { name: '+ Add' }).click()
  const item = spirals.locator('.swirl-item').first()
  await item.locator('.swirl-item-header').click()
  const thickness = sliderRow(item, 'Thickness')
  await thickness.locator('input[type=range]').focus()
  await page.keyboard.press('Home')
  await expect(thickness.locator('.slider-value')).toHaveText('flat')
  await thickness.locator('input[type=range]').blur()

  await regenerate(page)
  await cutAndGlue(page)
  await toolbarButton(page, 'Preview').click()
  const surface = fieldRow(await openPanel(page, 'Flow Cloud'), 'Surface Mesh').locator('input[type=checkbox]')
  await surface.check()
  const meshWithFlatSpiral = await canvasPixels(page)

  await toolbarButton(page, 'Edit').click()
  await expect(toolbarButton(page, 'Edit')).toHaveClass(/\bactive\b/)
  await toolbarButton(page, 'Preview').click()
  await expect(toolbarButton(page, 'Preview')).toHaveClass(/\bactive\b/)
  expect(await canvasPixels(page)).toEqual(meshWithFlatSpiral)
})
