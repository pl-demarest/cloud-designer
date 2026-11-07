import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

/**
 * Shared fixture for the cloud-designer browser suite.
 *
 * Every test fails on an uncaught page error or a console.error message (from the page or its
 * workers). Console warnings are collected and exposed, not failed on, so a spec can assert on them.
 */
export interface Diagnostics {
  pageErrors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
}

export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [
    async ({ page }, use) => {
      const diagnostics: Diagnostics = { pageErrors: [], consoleErrors: [], consoleWarnings: [] }
      page.on('pageerror', (err) => diagnostics.pageErrors.push(`${err.name}: ${err.message}`))
      page.on('console', (msg) => {
        if (msg.type() === 'error') diagnostics.consoleErrors.push(msg.text())
        else if (msg.type() === 'warning') diagnostics.consoleWarnings.push(msg.text())
      })
      await use(diagnostics)
      expect(diagnostics.pageErrors, 'uncaught page errors').toEqual([])
      expect(diagnostics.consoleErrors, 'console.error messages').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export type PanelLabel = 'Spheres' | 'Base' | 'Tail' | 'Spirals' | 'Flow Cloud' | 'Export'

/** Panels the app opens on first render (App.tsx `openPanels` initial state). */
export const INITIALLY_OPEN: readonly PanelLabel[] = ['Spheres', 'Flow Cloud']

/** Load the editor and wait until the viewport canvas has a backing store and the sidebar exists. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  const canvas = viewportCanvas(page)
  await expect(canvas).toBeVisible()
  await expect
    .poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width * el.height))
    .toBeGreaterThan(0)
  await expect(page.locator('.accordion-header')).toHaveCount(6)
  await nextFrames(page)
}

export function viewportCanvas(page: Page): Locator {
  return page.locator('.viewport-wrap canvas')
}

/** The accordion header button whose label starts with `label` (counts such as "(3)" follow it). */
export function accordionHeader(page: Page, label: PanelLabel): Locator {
  return page.locator('.accordion-header').filter({ hasText: new RegExp(`^${escapeRegExp(label)}\\b`) })
}

/** The accordion section (header plus body) for a panel. */
export function accordion(page: Page, label: PanelLabel): Locator {
  return page.locator('.accordion').filter({ has: accordionHeader(page, label) })
}

/** The body of an accordion panel; only present while the panel is open. */
export function panelBody(page: Page, label: PanelLabel): Locator {
  return accordion(page, label).locator('.accordion-body')
}

export async function isPanelOpen(page: Page, label: PanelLabel): Promise<boolean> {
  return (await panelBody(page, label).count()) > 0
}

/** Open an accordion panel by its label; a no-op if it is already open. */
export async function openPanel(page: Page, label: PanelLabel): Promise<Locator> {
  if (!(await isPanelOpen(page, label))) await accordionHeader(page, label).click()
  const body = panelBody(page, label)
  await expect(body).toBeVisible()
  return body
}

export async function closePanel(page: Page, label: PanelLabel): Promise<void> {
  if (await isPanelOpen(page, label)) await accordionHeader(page, label).click()
  await expect(panelBody(page, label)).toHaveCount(0)
}

/** A SliderRow (`.slider-row`) whose label text is exactly `label`. Labels are not tied to inputs. */
export function sliderRow(scope: Locator, label: string): Locator {
  return scope
    .locator('.slider-row')
    .filter({ has: scope.page().locator('label', { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) })
}

/** A `.field-row` (label plus select or checkbox) whose label text is exactly `label`. */
export function fieldRow(scope: Locator, label: string): Locator {
  return scope
    .locator('.field-row')
    .filter({ has: scope.page().locator('label', { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) })
}

/**
 * Run `action` and wait for `button` to go busy and back to idle.
 *
 * A MutationObserver is installed before the action, so a busy phase shorter than Playwright's polling
 * interval is still seen. FlowCloud.regenerate() debounces by 50 ms before it reports busy, so polling
 * for the busy label alone could miss it.
 */
async function runBusyCycle(
  page: Page,
  button: Locator,
  busyText: string,
  idleText: string,
  action: () => Promise<void>,
  timeout: number,
): Promise<void> {
  await expect(button).toHaveText(idleText)
  const state = await button.evaluateHandle(
    (el, [busy, idle]) => {
      const s = { sawBusy: false, done: false }
      const check = () => {
        const text = el.textContent?.trim()
        if (text === busy) s.sawBusy = true
        else if (s.sawBusy && text === idle && !(el as HTMLButtonElement).disabled) {
          s.done = true
          observer.disconnect()
        }
      }
      const observer = new MutationObserver(check)
      observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true })
      return s
    },
    [busyText, idleText] as const,
  )
  await action()
  await page.waitForFunction((s) => s.done, state, { timeout })
  await state.dispose()
  await nextFrames(page)
}

/** The Regenerate button in the Flow Cloud panel ("Working..." while the marching-cubes worker runs). */
export function regenerateButton(page: Page): Locator {
  return panelBody(page, 'Flow Cloud').getByRole('button', { name: /^(Regenerate|Working\.\.\.)$/ })
}

/** The Cut & Glue button ("Generating..." while the cut-and-glue or surface-mesh worker runs). */
export function cutGlueButton(page: Page): Locator {
  return panelBody(page, 'Flow Cloud').getByRole('button', { name: /^(Cut & Glue|Generating\.\.\.)$/ })
}

/** Click Regenerate and wait for the flow-cloud worker to finish and the result to be drawn. */
export async function regenerate(page: Page, timeout = 30_000): Promise<void> {
  await openPanel(page, 'Flow Cloud')
  const button = regenerateButton(page)
  await runBusyCycle(page, button, 'Working...', 'Regenerate', () => button.click(), timeout)
}

/** Click Cut & Glue and wait for both the clip worker and the surface-mesh worker to finish. */
export async function cutAndGlue(page: Page, timeout = 60_000): Promise<void> {
  await openPanel(page, 'Flow Cloud')
  const button = cutGlueButton(page)
  await runBusyCycle(page, button, 'Generating...', 'Cut & Glue', () => button.click(), timeout)
}

export function toolbarButton(page: Page, name: string): Locator {
  return page.locator('.toolbar').getByRole('button', { name, exact: true })
}

/** Wait for `count` animation frames so a store or scene change has been rendered. */
export async function nextFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    count,
  )
}

export interface PixelStats {
  /** Pixels whose colour differs from the white clear colour by more than 8 in any channel. */
  nonBackground: number
  /** Pixels with luminance below 128: wire lines and handles, but not the light-grey grid. */
  dark: number
  /** Saturated pixels (channel spread above 96): coloured handles, gizmos and the axes helper. */
  coloured: number
  total: number
  /** SHA-1 of the RGBA data, so two stats objects are equal only if the pictures are identical. */
  digest: string
}

/** Decode a PNG screenshot and count non-background pixels (background is white, 0xffffff). */
export function pixelStats(png: Buffer): PixelStats {
  const { data, width, height } = PNG.sync.read(png)
  let nonBackground = 0
  let dark = 0
  let coloured = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r < 247 || g < 247 || b < 247) nonBackground++
    if (0.299 * r + 0.587 * g + 0.114 * b < 128) dark++
    if (Math.max(r, g, b) - Math.min(r, g, b) > 96) coloured++
  }
  const digest = createHash('sha1').update(data).digest('hex')
  return { nonBackground, dark, coloured, total: width * height, digest }
}

/** Screenshot the viewport canvas and return its pixel statistics. */
export async function canvasPixels(page: Page): Promise<PixelStats> {
  await nextFrames(page)
  return pixelStats(await viewportCanvas(page).screenshot({ animations: 'disabled' }))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
