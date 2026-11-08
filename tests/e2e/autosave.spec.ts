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

test('a save holding a base point of 1e200 opens the editor, with the point clamped (cd:explore CDX-01)', async ({ page }) => {
  // Before the range table (plan D11) the engine mount threw from the curve code on this save, and
  // every reload left the page blank, with no Discard button to recover.
  const hostile = { base: { controlPoints: [[-2.5, -0.8, 0], [1e200, -1, 0.3], [1, -1, -0.3], [2.5, -0.8, 0]] } }
  await page.addInitScript(
    ([key, record]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1')
        localStorage.setItem(key, record)
      }
    },
    [KEY, JSON.stringify({ savedAt: '2026-11-08T12:00:00.000Z', preset: hostile })] as const,
  )
  await openApp(page)
  await expect(page.locator('.notice')).toContainText('Restored the cloud from autosave')
  const body = await openPanel(page, 'Base')
  await expect(body.getByLabel('P1 X')).toHaveValue('50.00')
  await page.reload()
  await openApp(page)
})
