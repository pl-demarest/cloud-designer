import type { Page } from '@playwright/test'
import { accordionHeader, canvasPixels, expect, openApp, openPanel, sliderRow, test, toolbarButton } from './helpers'

// Accessibility (audit findings a11y-accordions-sliders and css-focus-removed): every control has
// a name, keyboard focus is visible, and the editor works from the keyboard alone. The walkthrough
// below uses no mouse: Tab and Shift+Tab to move, Enter, Space and the arrow keys to act.

/** The focus ring index.css draws on keyboard focus: 2px solid var(--accent). */
const FOCUS_RING = { style: 'solid', width: '2px', color: 'rgb(37, 99, 235)' }

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

/** The focused element's name: aria-label, else its label's text, else its own text without
 *  aria-hidden parts (an accordion's arrow). */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text = (node: Node): string =>
      node instanceof Element && node.getAttribute('aria-hidden') === 'true'
        ? ''
        : node.nodeType === Node.TEXT_NODE
          ? (node.textContent ?? '')
          : Array.from(node.childNodes).map(text).join('')
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return ''
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel) return ariaLabel
    const labels = (el as HTMLInputElement).labels
    if (labels && labels.length > 0) return text(labels[0]).trim()
    return text(el).trim()
  })
}

/** Presses Tab (Shift+Tab with `back`) until the focused element is named `name`. */
async function tabTo(page: Page, name: string, back = false): Promise<void> {
  const seen: string[] = []
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab')
    const current = await focusedName(page)
    if (current === name) return
    seen.push(current)
  }
  throw new Error(`Tab did not reach "${name}"; it passed ${JSON.stringify(seen)}`)
}

async function expectFocusRing(page: Page, what: string): Promise<void> {
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!)
    return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }
  })
  expect(ring, `focus ring on ${what}`).toEqual(FOCUS_RING)
}

test('keyboard-only walkthrough: toolbar, panels, list items, sliders, fields and export', async ({ page }) => {
  // Toolbar: the name field first; Undo and Redo are disabled, so Tab passes them.
  await page.keyboard.press('Tab')
  expect(await focusedName(page)).toBe('Cloud name')
  await expectFocusRing(page, 'the name field')
  await tabTo(page, 'Preview')
  await expectFocusRing(page, 'a toolbar button')
  await page.keyboard.press('Enter')
  await expect(toolbarButton(page, 'Preview')).toHaveAttribute('aria-pressed', 'true')
  await tabTo(page, 'Edit', true)
  await page.keyboard.press('Space')
  await expect(toolbarButton(page, 'Edit')).toHaveAttribute('aria-pressed', 'true')

  // An accordion header closes and opens its panel.
  await tabTo(page, 'Spheres (3)')
  await expectFocusRing(page, 'an accordion header')
  await page.keyboard.press('Enter')
  await expect(accordionHeader(page, 'Spheres')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(accordionHeader(page, 'Spheres')).toHaveAttribute('aria-expanded', 'true')

  // Add a sphere; expand the first one; step a slider; undo the step from the slider.
  await tabTo(page, '+ Add')
  await page.keyboard.press('Enter')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (4)')
  await tabTo(page, 'Sphere 1 (sphere)')
  await expectFocusRing(page, 'a list item toggle')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Sphere 1 (sphere)' })).toHaveAttribute('aria-expanded', 'true')
  await tabTo(page, 'Shape')
  await expectFocusRing(page, 'a select')
  await tabTo(page, 'Pos X')
  await expectFocusRing(page, 'a slider')
  const posX = sliderRow(page.locator('.swirl-item').first(), 'Pos X').locator('.slider-value')
  await expect(posX).toHaveText('0.00')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(posX).toHaveText('0.10')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(posX).toHaveText('0.05')
  // Assistive technology reads the value as the slider shows it.
  await expect(page.getByRole('slider', { name: 'Rotate X' }).first()).toHaveAttribute('aria-valuetext', '0°')
  await tabTo(page, 'Half')
  await expectFocusRing(page, 'a checkbox')
  await page.keyboard.press('Space')
  await expect(page.getByRole('checkbox', { name: 'Half' })).toBeChecked()

  // Remove the added sphere with its remove button.
  await tabTo(page, 'Remove sphere 4')
  await expectFocusRing(page, 'a remove button')
  await page.keyboard.press('Enter')
  await expect(accordionHeader(page, 'Spheres')).toContainText('Spheres (3)')

  // A number field: type a coordinate, apply it with Enter.
  await tabTo(page, 'Base')
  await page.keyboard.press('Enter')
  await tabTo(page, 'P0 X')
  await expectFocusRing(page, 'a number field')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('-3')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('spinbutton', { name: 'P0 X' })).toHaveValue('-3.00')

  // Export, then back to Import with Shift+Tab.
  await tabTo(page, 'Export')
  await page.keyboard.press('Enter')
  await tabTo(page, 'Export JSON Preset')
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')])
  expect(download.suggestedFilename()).toBe('default-cloud-preset.json')
  await tabTo(page, 'Import JSON Preset', true)
  await expectFocusRing(page, 'an export panel button')
})

// The F and B anchors could only be dragged in the viewport, with no keyboard alternative (WCAG
// 2.1.1); every other handle has fields or sliders in its panel.
test('the F and B anchors can be set from the keyboard', async ({ page }) => {
  const before = await canvasPixels(page)
  await tabTo(page, 'Back Y')
  await expectFocusRing(page, 'an anchor field')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('1.5')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('spinbutton', { name: 'Back Y' })).toHaveValue('1.50')
  expect(await canvasPixels(page), 'the B anchor moved').not.toEqual(before)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('spinbutton', { name: 'Back Y' })).toHaveValue('0.00')
  expect(await canvasPixels(page), 'Ctrl+Z puts it back').toEqual(before)
})

test('every control has an accessible name', async ({ page }) => {
  for (const label of ['Base', 'Tail', 'Spirals', 'Export'] as const) await openPanel(page, label)
  await page.getByRole('button', { name: '+ Add' }).nth(1).click() // a spiral
  await page.getByRole('checkbox', { name: 'Generate Bands' }).check()
  for (const toggle of await page.locator('.swirl-item-header').all()) await toggle.click()

  const unnamed = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea, button'))) {
      if (el.hidden || el.closest('[hidden]')) continue
      const named =
        !!el.getAttribute('aria-label')?.trim() ||
        !!el.getAttribute('aria-labelledby') ||
        ((el as HTMLInputElement).labels?.length ?? 0) > 0 ||
        (el.tagName === 'BUTTON' && !!el.textContent?.trim())
      if (!named) out.push(el.outerHTML.slice(0, 120))
    }
    return out
  })
  expect(unnamed).toEqual([])
  expect(await page.locator('input, select, button').count(), 'controls checked').toBeGreaterThan(80)
})

test('list item headers are buttons, not clickable divs', async ({ page }) => {
  await (await openPanel(page, 'Spirals')).getByRole('button', { name: '+ Add' }).click()
  const toggles = page.locator('.swirl-item-header')
  await expect(toggles).toHaveCount(4)
  for (const toggle of await toggles.all()) {
    expect(await toggle.evaluate((el) => el.tagName)).toBe('BUTTON')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveAttribute('aria-controls', /.+/)
  }
})
