import {
  canvasPixels,
  cutAndGlue,
  cutGlueButton,
  expect,
  fieldRow,
  openApp,
  openPanel,
  regenerate,
  regenerateButton,
  test,
  toolbarButton,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('Regenerate produces flow-cloud geometry', async ({ page }) => {
  const before = await canvasPixels(page)
  expect(before.dark, 'scaffold wireframes are drawn before any generation').toBeGreaterThan(1000)

  await regenerate(page)
  const after = await canvasPixels(page)
  expect(after.dark).toBeGreaterThan(before.dark)
  await expect(regenerateButton(page)).toBeEnabled()
})

test('Regenerate twice gives the same picture', async ({ page }) => {
  await regenerate(page)
  const first = await canvasPixels(page)
  await regenerate(page)
  expect(await canvasPixels(page)).toEqual(first)
})

test('Hide removes the flow cloud from the viewport and Show restores it', async ({ page }) => {
  const scaffoldOnly = await canvasPixels(page)
  await regenerate(page)
  const withCloud = await canvasPixels(page)

  const body = await openPanel(page, 'Flow Cloud')
  await body.getByRole('button', { name: 'Hide', exact: true }).click()
  expect(await canvasPixels(page)).toEqual(scaffoldOnly)
  await body.getByRole('button', { name: 'Show', exact: true }).click()
  expect(await canvasPixels(page)).toEqual(withCloud)
})

test('Cut & Glue completes and enables the Surface Mesh toggle', async ({ page }) => {
  await regenerate(page)
  const editView = await canvasPixels(page)
  await cutAndGlue(page)

  await expect(cutGlueButton(page)).toHaveText('Cut & Glue')
  await expect(cutGlueButton(page)).toBeEnabled()
  const surface = fieldRow(await openPanel(page, 'Flow Cloud'), 'Surface Mesh').locator('input[type=checkbox]')
  await expect(surface).toBeEnabled()
  await expect(surface).not.toBeChecked()
  await expect(surface).toHaveAttribute('title', 'Toggle unified surface mesh wireframe')
  // The result lives in the Preview-only group, so the edit view is unchanged.
  expect(await canvasPixels(page)).toEqual(editView)
})

test('Preview shows the unified Cut & Glue result instead of the scaffold', async ({ page }) => {
  await toolbarButton(page, 'Preview').click()
  await expect(toolbarButton(page, 'Preview')).toHaveClass(/\bactive\b/)
  const emptyPreview = await canvasPixels(page)

  await toolbarButton(page, 'Edit').click()
  const editView = await canvasPixels(page)
  expect(emptyPreview.dark, 'Preview hides the scaffold').toBeLessThan(editView.dark)

  await regenerate(page)
  await cutAndGlue(page)
  await toolbarButton(page, 'Preview').click()
  const preview = await canvasPixels(page)
  expect(preview.dark, 'Preview shows the clipped wireframe').toBeGreaterThan(emptyPreview.dark + 1000)
  expect(preview).not.toEqual(editView)

  await toolbarButton(page, 'Edit').click()
  await expect(toolbarButton(page, 'Edit')).toHaveClass(/\bactive\b/)
  expect(await canvasPixels(page)).not.toEqual(preview)
})

test('Surface Mesh toggle swaps the clipped wireframe for the surface mesh', async ({ page }) => {
  await regenerate(page)
  await cutAndGlue(page)
  await toolbarButton(page, 'Preview').click()
  const clipped = await canvasPixels(page)

  const surface = fieldRow(await openPanel(page, 'Flow Cloud'), 'Surface Mesh').locator('input[type=checkbox]')
  await surface.check()
  const meshed = await canvasPixels(page)
  expect(meshed).not.toEqual(clipped)
  expect(meshed.dark).toBeGreaterThan(1000)

  await surface.uncheck()
  expect(await canvasPixels(page)).toEqual(clipped)
})

test('Fit reframes the camera', async ({ page }) => {
  const before = await canvasPixels(page)
  await toolbarButton(page, 'Fit').click()
  expect(await canvasPixels(page)).not.toEqual(before)
})

for (const name of ['Axes', 'Grid'] as const) {
  test(`${name} toggle hides and restores its helper`, async ({ page }) => {
    if (name === 'Axes') {
      // In the default view the 1-unit axes helper at the origin is drawn inside sphere 1's wireframe
      // and handle, and toggling it changes no pixel. Removing that sphere exposes the helper.
      const spheres = await openPanel(page, 'Spheres')
      await spheres.locator('.swirl-item').first().getByRole('button', { name: '×' }).click()
    }
    const button = toolbarButton(page, name)
    await expect(button).toHaveClass(/\bactive\b/)
    const shown = await canvasPixels(page)

    await button.click()
    await expect(button).not.toHaveClass(/\bactive\b/)
    const hidden = await canvasPixels(page)
    expect(hidden.digest).not.toBe(shown.digest)
    if (name === 'Grid') expect(hidden.nonBackground).toBeLessThan(shown.nonBackground)
    else expect(hidden.coloured).toBeLessThan(shown.coloured)

    await button.click()
    await expect(button).toHaveClass(/\bactive\b/)
    expect(await canvasPixels(page)).toEqual(shown)
  })
}

test('editing a sphere slider redraws the scaffold without regenerating', async ({ page }) => {
  const before = await canvasPixels(page)
  const body = await openPanel(page, 'Spheres')
  const item = body.locator('.swirl-item').first()
  await item.locator('.swirl-item-header').click()
  await item.locator('.slider-row', { hasText: 'Radius' }).locator('input[type=range]').focus()
  await page.keyboard.press('End')
  expect(await canvasPixels(page)).not.toEqual(before)
  await expect(regenerateButton(page)).toHaveText('Regenerate')
})
