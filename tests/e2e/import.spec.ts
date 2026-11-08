import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { DEFAULT_PRESET } from '../../src/model/defaults'
import { accordionHeader, expect, openApp, openPanel, test, toolbarButton } from './helpers'

// Import JSON (the Export panel's button, or a file dropped on the viewport). Before Stage C an
// exported preset could not be opened again (audit no-import-loadpreset-unreachable).

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

const spheresHeader = (page: Page) => accordionHeader(page, 'Spheres')

/** The default preset with `n` spheres in a row, as JSON. */
function presetJson(n: number, name: string): string {
  const p = structuredClone(DEFAULT_PRESET)
  p.name = name
  p.spheres = Array.from({ length: n }, (_, i) => ({ ...DEFAULT_PRESET.spheres[0], id: `sphere-${i}`, position: [i * 1.2 - 2, 0, 0] }))
  return JSON.stringify(p)
}

test('an exported preset imports back, as one undo step', async ({ page }) => {
  await page.getByPlaceholder('Cloud name...').fill('Round Trip')
  await (await openPanel(page, 'Spheres')).getByRole('button', { name: '+ Add' }).click()
  await expect(spheresHeader(page)).toContainText('Spheres (4)')

  const exportPanel = await openPanel(page, 'Export')
  const [dl] = await Promise.all([page.waitForEvent('download'), exportPanel.getByRole('button', { name: 'Export JSON Preset' }).click()])
  const buffer = await readFile(await dl.path())

  page.once('dialog', (dialog) => void dialog.accept())
  await toolbarButton(page, 'Reset').click()
  await expect(spheresHeader(page)).toContainText('Spheres (3)')

  await exportPanel.getByLabel('Preset file to import').setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/json', buffer })
  await expect(spheresHeader(page)).toContainText('Spheres (4)')
  await expect(page.getByPlaceholder('Cloud name...')).toHaveValue('Round Trip')
  await expect(page.locator('.notice')).toHaveText(/Imported round-trip-preset\.json\./)

  await toolbarButton(page, 'Undo').click()
  await expect(spheresHeader(page)).toContainText('Spheres (3)')
  await expect(page.getByPlaceholder('Cloud name...')).toHaveValue('Default Cloud')
})

test('a file that is not a preset changes nothing, and the alert says why', async ({ page }) => {
  const exportPanel = await openPanel(page, 'Export')
  await exportPanel.getByLabel('Preset file to import').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Could not import notes.txt: it is not valid JSON.')
  await expect(spheresHeader(page)).toContainText('Spheres (3)')
  await expect(toolbarButton(page, 'Undo')).toBeDisabled()

  await exportPanel.getByLabel('Preset file to import').setInputFiles({ name: 'list.json', mimeType: 'application/json', buffer: Buffer.from('[1, 2, 3]') })
  await expect(alert).toContainText('Could not import list.json: it holds no cloud preset (the JSON is not an object).')

  await alert.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a preset file dropped on the viewport is imported', async ({ page }) => {
  const dataTransfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], 'dropped.json', { type: 'application/json' }))
    return dt
  }, presetJson(5, 'Dropped'))
  const area = page.locator('.viewport-wrap')
  await area.dispatchEvent('dragenter', { dataTransfer })
  await area.dispatchEvent('dragover', { dataTransfer })
  await expect(area).toHaveClass(/\bdrop-target\b/)
  await area.dispatchEvent('drop', { dataTransfer })
  await expect(area).not.toHaveClass(/\bdrop-target\b/)
  await expect(spheresHeader(page)).toContainText('Spheres (5)')
  await expect(page.getByPlaceholder('Cloud name...')).toHaveValue('Dropped')
  await expect(page.locator('.notice')).toHaveText(/Imported dropped\.json\./)
  await toolbarButton(page, 'Undo').click()
  await expect(spheresHeader(page)).toContainText('Spheres (3)')
})
