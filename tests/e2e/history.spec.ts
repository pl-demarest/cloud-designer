import { accordionHeader, expect, openApp, openPanel, sliderRow, test, toolbarButton } from './helpers'

// Audit finding (react-layer, high): "commit() pushes the render-closure preset, so discrete edits
// (add/remove/checkbox/select-onChange) record the pre-edit state" (src/components/SpherePanel.tsx:16).
// After "+ Add" the history held [initial, initial]: Undo still returned to 3 spheres, but Redo
// replayed the pre-edit snapshot, so the added sphere never came back. Since Stage C the store's
// commit() records the preset as it is after the edit.

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

async function addSphere(page: import('@playwright/test').Page): Promise<void> {
  const body = await openPanel(page, 'Spheres')
  await body.getByRole('button', { name: '+ Add' }).click()
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)')
}

test('Undo and Redo start disabled', async ({ page }) => {
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
  await expect(toolbarButton(page, 'Redo')).toBeDisabled()
})

test('toolbar Undo removes an added sphere and enables Redo', async ({ page }) => {
  await addSphere(page)
  await expect(toolbarButton(page, 'Undo')).toBeEnabled()
  await expect(toolbarButton(page, 'Redo')).toBeDisabled()

  await toolbarButton(page, 'Undo').click()
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
  await expect(toolbarButton(page, 'Redo')).toBeEnabled()

  // Redo is accepted and consumes the redo stack (the restored state is pinned by the next test).
  await toolbarButton(page, 'Redo').click()
  await expect(toolbarButton(page, 'Redo')).toBeDisabled()
  await expect(toolbarButton(page, 'Undo')).toBeEnabled()
})

test('toolbar Redo restores an added sphere', async ({ page }) => {
  await addSphere(page)
  await toolbarButton(page, 'Undo').click()
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await toolbarButton(page, 'Redo').click()
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)', { timeout: 2_000 })
})

test('Ctrl+Z undoes an added sphere', async ({ page }) => {
  await addSphere(page)
  await page.keyboard.press('Control+z')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await expect(toolbarButton(page, 'Redo')).toBeEnabled()
})

test('Ctrl+Y redo is accepted after Ctrl+Z', async ({ page }) => {
  await addSphere(page)
  await page.keyboard.press('Control+z')
  await expect(toolbarButton(page, 'Redo')).toBeEnabled()
  await page.keyboard.press('Control+y')
  await expect(toolbarButton(page, 'Redo')).toBeDisabled()
})

test('Ctrl+Shift+Z redoes an added sphere', async ({ page }) => {
  // Failed for two reasons before Stage C: the stale snapshot above, and App.tsx compared e.key to
  // lowercase 'z' although Shift makes it 'Z' (audit finding keyboard-undo-in-inputs).
  await addSphere(page)
  await page.keyboard.press('Control+z')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await page.keyboard.press('Control+Shift+KeyZ')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)', { timeout: 2_000 })
})

test('Undo does not go past the initial state', async ({ page }) => {
  await addSphere(page)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
})

test('a new edit after Undo clears the redo stack', async ({ page }) => {
  await addSphere(page)
  await toolbarButton(page, 'Undo').click()
  await expect(toolbarButton(page, 'Redo')).toBeEnabled()
  const body = await openPanel(page, 'Spheres')
  await body.locator('.swirl-item').first().getByRole('button', { name: '×' }).click()
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (2)')
  await expect(toolbarButton(page, 'Redo')).toBeDisabled()
})

// Audit finding slider-commit-events: sliders committed only on mouseup and touchend, so keyboard
// steps were never undo steps, and a release without a change pushed a duplicate entry.
test('each keyboard step on a slider is one undo step', async ({ page }) => {
  const row = sliderRow(await openPanel(page, 'Base'), 'Width')
  const value = row.locator('.slider-value')
  await row.locator('input[type=range]').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(value).toHaveText('1.30')

  await toolbarButton(page, 'Undo').click()
  await expect(value).toHaveText('1.25')
  await toolbarButton(page, 'Undo').click()
  await expect(value).toHaveText('1.20')
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
})

test('a pointer drag on a slider is one undo step', async ({ page }) => {
  const row = sliderRow(await openPanel(page, 'Base'), 'Width')
  const value = row.locator('.slider-value')
  const box = (await row.locator('input[type=range]').boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.2, y)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.15 * i), y)
  await page.mouse.up()
  await expect(value).not.toHaveText('1.20')

  await toolbarButton(page, 'Undo').click()
  await expect(value).toHaveText('1.20')
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
})

// Audit finding keyboard-undo-in-inputs: Ctrl+Z in the name or a number field undid the preset.
test('Ctrl+Z in a text field undoes the text, not the preset', async ({ page }) => {
  await addSphere(page)
  const name = page.getByPlaceholder('Cloud name...')
  await name.click()
  await name.press('End')
  await page.keyboard.type(' X')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)')

  const x = (await openPanel(page, 'Base')).getByRole('spinbutton', { name: 'P0 X' })
  await x.fill('1')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)')
})

test('Cmd+Shift+Z and Ctrl+Z with Caps Lock work too', async ({ page }) => {
  await addSphere(page)
  await page.keyboard.press('Meta+z')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await page.keyboard.press('Meta+Shift+KeyZ')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)')
  // Caps Lock: Playwright sends e.key 'Z' without Shift.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })),
  )
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
})

test('Ctrl+Z while a slider has focus undoes its step', async ({ page }) => {
  const row = sliderRow(await openPanel(page, 'Base'), 'Width')
  await row.locator('input[type=range]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(row.locator('.slider-value')).toHaveText('1.25')
  await page.keyboard.press('Control+z')
  await expect(row.locator('.slider-value')).toHaveText('1.20')
})
