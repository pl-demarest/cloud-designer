import { accordionHeader, expect, openApp, openPanel, test, toolbarButton } from './helpers'

// Audit finding (react-layer, high): "commit() pushes the render-closure preset, so discrete edits
// (add/remove/checkbox/select-onChange) record the pre-edit state" (src/components/SpherePanel.tsx:16).
// After "+ Add" the history holds [initial, initial]: Undo still returns to 3 spheres, but Redo
// replays the pre-edit snapshot, so the added sphere never comes back. The redo assertions below
// state the correct behaviour and are marked test.fail() until Stage C fixes the history layer.

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

  // Redo is accepted and consumes the redo stack (the restored state is pinned by the test.fail below).
  await toolbarButton(page, 'Redo').click()
  await expect(toolbarButton(page, 'Redo')).toBeDisabled()
  await expect(toolbarButton(page, 'Undo')).toBeEnabled()
})

test('toolbar Redo restores an added sphere', async ({ page }) => {
  test.fail(true, 'react-layer finding: commit() records the stale pre-edit preset')
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
  // Fails for two reasons today: the stale snapshot above, and App.tsx compares e.key to lowercase
  // 'z' although Shift makes it 'Z' (audit finding "Ctrl+Shift+Z redo compares e.key to lowercase 'z'").
  test.fail(true, 'react-layer findings: stale commit() snapshot; Shift+Z key case')
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
