import type { Page } from '@playwright/test'
import { accordionHeader, expect, openApp, openPanel, test, toolbarButton } from './helpers'

// The localStorage autosave (src/store/autosave.ts). The usage guide promised persistence that did
// not exist (audit, react-layer). Each Playwright test starts with empty storage.

const KEY = 'cloud-designer/autosave/v1'

const saved = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY)

test('an edit survives a reload, with a note that it was restored', async ({ page }) => {
  await openApp(page)
  await page.getByPlaceholder('Cloud name...').fill('Kept')
  await (await openPanel(page, 'Spheres')).getByRole('button', { name: '+ Add' }).click()
  await expect.poll(() => saved(page).then((s) => s !== null && s.includes('"Kept"'))).toBe(true)

  await page.reload()
  await openApp(page)
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)')
  await expect(page.getByPlaceholder('Cloud name...')).toHaveValue('Kept')
  await expect(page.locator('.notice')).toContainText('Restored the cloud from autosave')
  // The history opens on the restored preset.
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()
})

test('Discard goes back to the default preset and forgets the save', async ({ page }) => {
  await openApp(page)
  await (await openPanel(page, 'Spheres')).getByRole('button', { name: '+ Add' }).click()
  await expect.poll(() => saved(page)).not.toBeNull()
  await page.reload()
  await openApp(page)

  await page.locator('.notice').getByRole('button', { name: 'Discard' }).click()
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await expect(page.locator('.notice')).toHaveCount(0)
  expect(await saved(page)).toBeNull()

  await page.reload()
  await openApp(page)
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await expect(page.locator('.notice')).toHaveCount(0)
})

test('a save that does not read as a preset is ignored and removed', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem(key, '{ not json')
    }
  }, KEY)
  await openApp(page)
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')
  await expect(page.locator('.notice')).toHaveCount(0)
  expect(await saved(page)).toBeNull()
})
