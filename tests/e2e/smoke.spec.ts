import { expect, test } from '@playwright/test'

test('app loads with a rendered viewport and the sidebar accordion', async ({ page }) => {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text())
  })

  await page.goto('/')

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)

  // The canvas backing store is sized by the viewport resize observer.
  const backing = await canvas.evaluate((el: HTMLCanvasElement) => ({ w: el.width, h: el.height }))
  expect(backing.w).toBeGreaterThan(0)
  expect(backing.h).toBeGreaterThan(0)

  // Three.js creates a WebGL2 context on this canvas; getContext returns that same context.
  const hasWebGL = await canvas.evaluate((el: HTMLCanvasElement) => el.getContext('webgl2') !== null)
  expect(hasWebGL, 'WebGL2 context on the viewport canvas').toBe(true)

  const headers = page.locator('.accordion-header')
  await expect(headers).toHaveText([
    /^Spheres \(\d+\)/,
    /^Base/,
    /^Tail/,
    /^Spirals \(\d+\)/,
    /^Flow Cloud/,
    /^Export/,
  ])

  // Let the first frames and any worker start-up run before asserting on errors.
  await page.waitForTimeout(500)
  expect(pageErrors, 'uncaught page errors').toEqual([])
  expect(consoleErrors, 'console.error messages').toEqual([])
  // three r183 deprecated THREE.Clock and warns when one is constructed; the editor constructs none.
  expect(consoleWarnings.filter((w) => /deprecated/i.test(w)), 'deprecation warnings').toEqual([])
  // StrictMode's remount builds a second renderer on the same WebGL context. The first one's label
  // upload left UNPACK_FLIP_Y_WEBGL set, and the second one's empty 3D textures then failed:
  // 'WebGL: INVALID_OPERATION: texImage3D: FLIP_Y or PREMULTIPLY_ALPHA isn't allowed ...'.
  expect(consoleWarnings.filter((w) => /WebGL/.test(w)), 'WebGL warnings').toEqual([])
})

test('the drawing buffer follows a devicePixelRatio change that comes without a resize (cd:review suspected 5)', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const sizes = () =>
    canvas.evaluate((el: HTMLCanvasElement) => ({ css: [el.clientWidth, el.clientHeight], buffer: [el.width, el.height] }))
  await expect.poll(async () => (await sizes()).buffer[0]).toBeGreaterThan(0)
  const before = await sizes()
  expect(before.buffer, 'devicePixelRatio 1').toEqual(before.css)

  // The window moves to a 2x display and keeps its size: no resize event, no ResizeObserver entry.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
  await expect.poll(async () => (await sizes()).buffer).toEqual([before.css[0] * 2, before.css[1] * 2])
})
