import {
  accordionHeader,
  closePanel,
  expect,
  fieldRow,
  INITIALLY_OPEN,
  isPanelOpen,
  openApp,
  openPanel,
  panelBody,
  sliderRow,
  test,
  toolbarButton,
  type PanelLabel,
} from './helpers'

const PANELS: readonly PanelLabel[] = ['Spheres', 'Base', 'Tail', 'Spirals', 'Flow Cloud', 'Export']

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test.describe('accordion', () => {
  test('starts with Spheres and Flow Cloud open', async ({ page }) => {
    for (const label of PANELS) {
      expect(await isPanelOpen(page, label), label).toBe(INITIALLY_OPEN.includes(label))
      const header = accordionHeader(page, label)
      if (INITIALLY_OPEN.includes(label)) {
        await expect(header).toHaveClass(/\bopen\b/)
        await expect(header).toContainText('▲')
      } else {
        await expect(header).not.toHaveClass(/\bopen\b/)
        await expect(header).toContainText('▼')
      }
    }
  })

  for (const label of PANELS) {
    test(`${label} opens and closes`, async ({ page }) => {
      const header = accordionHeader(page, label)
      const startsOpen = await isPanelOpen(page, label)

      await header.click()
      expect(await isPanelOpen(page, label)).toBe(!startsOpen)
      await header.click()
      expect(await isPanelOpen(page, label)).toBe(startsOpen)

      await openPanel(page, label)
      await expect(header).toHaveClass(/\bopen\b/)
      await expect(header).toContainText('▲')
      await closePanel(page, label)
      await expect(header).not.toHaveClass(/\bopen\b/)
      await expect(header).toContainText('▼')
    })
  }

  // Audit finding a11y-accordions-sliders: the header buttons had no aria-expanded or aria-controls.
  test('each header reports its state and names the region it opens', async ({ page }) => {
    for (const label of PANELS) {
      const header = accordionHeader(page, label)
      const open = INITIALLY_OPEN.includes(label)
      await expect(header, label).toHaveAttribute('aria-expanded', String(open))
      const controls = await header.getAttribute('aria-controls')
      expect(controls, label).toBeTruthy()
      if (!open) await header.click()
      await expect(header).toHaveAttribute('aria-expanded', 'true')
      const region = page.getByRole('region', { name: label })
      await expect(region).toHaveAttribute('id', controls!)
      await expect(region).toHaveClass(/\baccordion-body\b/)
    }
  })

  test('panels open independently of each other', async ({ page }) => {
    for (const label of PANELS) await openPanel(page, label)
    for (const label of PANELS) expect(await isPanelOpen(page, label), label).toBe(true)
    await closePanel(page, 'Base')
    expect(await isPanelOpen(page, 'Tail')).toBe(true)
    expect(await isPanelOpen(page, 'Spheres')).toBe(true)
  })
})

test.describe('list editing', () => {
  test('add and remove a sphere updates the counts', async ({ page }) => {
    const body = await openPanel(page, 'Spheres')
    const header = accordionHeader(page, 'Spheres')
    await expect(header).toContainText('Spheres (3)')
    await expect(body.locator('.swirl-item')).toHaveCount(3)

    await body.getByRole('button', { name: '+ Add' }).click()
    await expect(header).toContainText('Spheres (4)')
    await expect(body.locator('.panel-section-header')).toContainText('Spheres (4)')
    await expect(body.locator('.swirl-item')).toHaveCount(4)
    await expect(body.locator('.swirl-item-header').nth(3)).toContainText('Sphere 4 (sphere)')

    await body.locator('.swirl-item').nth(3).getByRole('button', { name: '×' }).click()
    await expect(header).toContainText('Spheres (3)')
    await expect(body.locator('.swirl-item')).toHaveCount(3)
  })

  test('add and remove a spiral updates the counts and the empty state', async ({ page }) => {
    const body = await openPanel(page, 'Spirals')
    const header = accordionHeader(page, 'Spirals')
    await expect(header).toContainText('Spirals (0)')
    await expect(body.getByText(/^No spirals\./)).toBeVisible()

    await body.getByRole('button', { name: '+ Add' }).click()
    await expect(header).toContainText('Spirals (1)')
    await expect(body.locator('.swirl-item')).toHaveCount(1)
    await expect(body.locator('.swirl-item-header')).toContainText('Spiral 1 (golden)')
    await expect(body.getByText(/^No spirals\./)).toHaveCount(0)

    await body.locator('.swirl-item').getByRole('button', { name: '×' }).click()
    await expect(header).toContainText('Spirals (0)')
    await expect(body.getByText(/^No spirals\./)).toBeVisible()
  })

  test('add and remove a base control point', async ({ page }) => {
    const body = await openPanel(page, 'Base')
    const rows = body.locator('.control-point-row')
    await expect(rows).toHaveCount(4)
    await expect(rows.locator('.cp-label')).toHaveText(['P0', 'P1', 'P2', 'P3'])

    await body.getByRole('button', { name: '+ Point' }).click()
    await expect(rows).toHaveCount(5)
    await expect(rows.nth(4).locator('.cp-label')).toHaveText('P4')

    await rows.nth(4).getByRole('button', { name: '×' }).click()
    await expect(rows).toHaveCount(4)
  })

  test('base keeps at least two control points', async ({ page }) => {
    const body = await openPanel(page, 'Base')
    const rows = body.locator('.control-point-row')
    await rows.nth(0).getByRole('button', { name: '×' }).click()
    await rows.nth(0).getByRole('button', { name: '×' }).click()
    await expect(rows).toHaveCount(2)
    for (const i of [0, 1]) await expect(rows.nth(i).getByRole('button', { name: '×' })).toBeDisabled()
  })

  test('add and remove a tail setpoint updates the counts', async ({ page }) => {
    const body = await openPanel(page, 'Tail')
    const title = body.locator('.panel-section-header')
    const rows = body.locator('.setpoint-row')
    await expect(title).toContainText('Tail (3 pts)')
    await expect(rows).toHaveCount(3)

    await body.locator('.panel-section-header').getByRole('button', { name: '+ Point' }).click()
    await expect(title).toContainText('Tail (4 pts)')
    await expect(rows).toHaveCount(4)

    // Insert-after on SP 0 adds a row between SP 0 and the old SP 1.
    await rows.nth(0).getByRole('button', { name: '+' }).click()
    await expect(title).toContainText('Tail (5 pts)')

    await rows.nth(4).getByRole('button', { name: '×' }).click()
    await rows.nth(1).getByRole('button', { name: '×' }).click()
    await expect(title).toContainText('Tail (3 pts)')
    await expect(rows.locator('.setpoint-header > span')).toHaveText(['SP 0', 'SP 1', 'SP 2'])
  })
})

test.describe('sliders', () => {
  test('ArrowRight on a focused range input changes the displayed value', async ({ page }) => {
    const body = await openPanel(page, 'Base')
    const row = sliderRow(body, 'Width')
    const input = row.locator('input[type=range]')
    const value = row.locator('.slider-value')
    await expect(value).toHaveText('1.20')

    await input.focus()
    await page.keyboard.press('ArrowRight')
    await expect(value).toHaveText('1.25')
    await expect(input).toHaveValue('1.25')

    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(value).toHaveText('1.15')
  })

  test('formatted sliders show their unit', async ({ page }) => {
    const tail = await openPanel(page, 'Tail')
    const curl = sliderRow(tail, 'Curl')
    await expect(curl.locator('.slider-value')).toHaveText('0.50π')
    await curl.locator('input[type=range]').focus()
    await page.keyboard.press('ArrowRight')
    // The range input snaps the default π/2 (1.5708) to its 0.05 step grid (1.55); ArrowRight gives
    // 1.60, and 1.60 / π = 0.509.
    await expect(curl.locator('.slider-value')).toHaveText('0.51π')

    const flow = await openPanel(page, 'Flow Cloud')
    const lines = sliderRow(flow, 'Flow Lines')
    await expect(lines.locator('.slider-value')).toHaveText('16')
    await lines.locator('input[type=range]').focus()
    await page.keyboard.press('ArrowRight')
    await expect(lines.locator('.slider-value')).toHaveText('17')
  })

  test('tail start and end radius sliders edit the first and last setpoint width', async ({ page }) => {
    const body = await openPanel(page, 'Tail')
    const widthInputs = body.locator('.setpoint-fields input[type=number]:nth-of-type(4)')
    await expect(widthInputs).toHaveCount(3)
    await expect(widthInputs.nth(0)).toHaveValue('0.80')
    await expect(widthInputs.nth(2)).toHaveValue('0.10')

    await sliderRow(body, 'Start radius').locator('input[type=range]').focus()
    await page.keyboard.press('ArrowRight')
    await expect(widthInputs.nth(0)).toHaveValue('0.81')

    await sliderRow(body, 'End radius').locator('input[type=range]').focus()
    await page.keyboard.press('ArrowRight')
    await expect(widthInputs.nth(2)).toHaveValue('0.11')
  })
})

// Audit finding number-input-nan: a cleared or half-typed number input stored NaN at once.
test.describe('number fields', () => {
  test('a typed coordinate applies on Enter, as one undo step', async ({ page }) => {
    const x = (await openPanel(page, 'Base')).getByRole('spinbutton', { name: 'P0 X' })
    await expect(x).toHaveValue('-2.50')
    await x.fill('-3')
    await x.press('Enter')
    await expect(x).toHaveValue('-3.00')
    await toolbarButton(page, 'Undo').click()
    await expect(x).toHaveValue('-2.50')
    await expect(toolbarButton(page, 'Undo')).toBeDisabled()
  })

  test('a field left empty shows its value again and records nothing', async ({ page }) => {
    const width = (await openPanel(page, 'Tail')).getByRole('spinbutton', { name: 'SP 1 width' })
    await width.fill('')
    await width.blur()
    await expect(width).toHaveValue('0.40')
    await expect(toolbarButton(page, 'Undo')).toBeDisabled()
  })
})

test.describe('selects', () => {
  test('sphere shape select switches to ellipsoid and reveals scale sliders', async ({ page }) => {
    const body = await openPanel(page, 'Spheres')
    const item = body.locator('.swirl-item').first()
    await item.locator('.swirl-item-header').click()
    await expect(sliderRow(item, 'Radius')).toBeVisible()
    await expect(sliderRow(item, 'Scale X')).toHaveCount(0)

    await fieldRow(item, 'Shape').locator('select').selectOption('ellipsoid')
    await expect(item.locator('.swirl-item-header')).toContainText('Sphere 1 (ellipsoid)')
    for (const axis of ['X', 'Y', 'Z']) await expect(sliderRow(item, `Scale ${axis}`)).toBeVisible()

    await fieldRow(item, 'Shape').locator('select').selectOption('sphere')
    await expect(item.locator('.swirl-item-header')).toContainText('Sphere 1 (sphere)')
    await expect(sliderRow(item, 'Scale X')).toHaveCount(0)
  })

  test('base cross-section shape select', async ({ page }) => {
    const body = await openPanel(page, 'Base')
    const select = fieldRow(body, 'Shape').locator('select')
    await expect(select).toHaveValue('oval')
    await select.selectOption('rect')
    await expect(select).toHaveValue('rect')
  })

  test('tail attach select hides the offset slider when detached', async ({ page }) => {
    const body = await openPanel(page, 'Tail')
    const select = fieldRow(body, 'Attach').locator('select')
    await expect(select).toHaveValue('end')
    await expect(sliderRow(body, 'Attach Offset')).toBeVisible()

    await select.selectOption('none')
    await expect(sliderRow(body, 'Attach Offset')).toHaveCount(0)
    await select.selectOption('start')
    await expect(sliderRow(body, 'Attach Offset')).toBeVisible()
  })

  test('spiral type select', async ({ page }) => {
    const body = await openPanel(page, 'Spirals')
    await body.getByRole('button', { name: '+ Add' }).click()
    const item = body.locator('.swirl-item').first()
    await item.locator('.swirl-item-header').click()
    await fieldRow(item, 'Type').locator('select').selectOption('archimedean')
    await expect(item.locator('.swirl-item-header')).toContainText('Spiral 1 (archimedean)')
  })

  test('flow cloud wireframe mode select hides the spiral-mode controls', async ({ page }) => {
    const body = await openPanel(page, 'Flow Cloud')
    const select = fieldRow(body, 'Mode').locator('select')
    await expect(select).toHaveValue('spiral')
    await expect(fieldRow(body, 'Show Flow Lines')).toBeVisible()
    await expect(body.getByRole('button', { name: 'Snap Back → Tail' })).toBeVisible()

    await select.selectOption('edges')
    await expect(fieldRow(body, 'Show Flow Lines')).toHaveCount(0)
    await expect(sliderRow(body, 'Spiral Twist')).toHaveCount(0)
  })

  test('flow cloud resolution and mesh density selects', async ({ page }) => {
    const body = await openPanel(page, 'Flow Cloud')
    const resolution = fieldRow(body, 'Resolution').locator('select')
    await expect(resolution).toHaveValue('64')
    await resolution.selectOption('32')
    await expect(resolution).toHaveValue('32')

    const density = fieldRow(body, 'Mesh Density').locator('select')
    await expect(density).toHaveValue('64')
    await density.selectOption('96')
    await expect(density).toHaveValue('96')
  })
})

test.describe('checkboxes', () => {
  test('base Closed checkbox', async ({ page }) => {
    const body = await openPanel(page, 'Base')
    const box = fieldRow(body, 'Closed').locator('input[type=checkbox]')
    await expect(box).not.toBeChecked()
    await box.check()
    await expect(box).toBeChecked()
    await box.uncheck()
    await expect(box).not.toBeChecked()
  })

  test('sphere Half checkbox', async ({ page }) => {
    const body = await openPanel(page, 'Spheres')
    const item = body.locator('.swirl-item').first()
    await item.locator('.swirl-item-header').click()
    const box = fieldRow(item, 'Half').locator('input[type=checkbox]')
    await expect(box).not.toBeChecked()
    await box.check()
    await expect(box).toBeChecked()
  })

  test('Generate Bands reveals Show Bands and the Bands slider', async ({ page }) => {
    const body = await openPanel(page, 'Flow Cloud')
    const generate = fieldRow(body, 'Generate Bands').locator('input[type=checkbox]')
    await expect(generate).not.toBeChecked()
    await expect(fieldRow(body, 'Show Bands')).toHaveCount(0)
    await expect(sliderRow(body, 'Bands')).toHaveCount(0)

    await generate.check()
    await expect(fieldRow(body, 'Show Bands').locator('input[type=checkbox]')).toBeChecked()
    await expect(sliderRow(body, 'Bands').locator('.slider-value')).toHaveText('8')

    await fieldRow(body, 'Show Bands').locator('input[type=checkbox]').uncheck()
    await expect(fieldRow(body, 'Show Bands').locator('input[type=checkbox]')).not.toBeChecked()
  })

  test('Show Flow Lines and Smooth checkboxes toggle', async ({ page }) => {
    const body = await openPanel(page, 'Flow Cloud')
    for (const label of ['Show Flow Lines', 'Smooth']) {
      const box = fieldRow(body, label).locator('input[type=checkbox]')
      await expect(box, label).toBeChecked()
      await box.uncheck()
      await expect(box, label).not.toBeChecked()
    }
  })

  test('Surface Mesh checkbox is disabled until Cut & Glue has run', async ({ page }) => {
    const body = await openPanel(page, 'Flow Cloud')
    const box = fieldRow(body, 'Surface Mesh').locator('input[type=checkbox]')
    await expect(box).toBeDisabled()
    await expect(box).toHaveAttribute('title', 'Run Cut & Glue first')
  })
})

test('Show/Hide toggles its own label', async ({ page }) => {
  const body = await openPanel(page, 'Flow Cloud')
  await body.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(body.getByRole('button', { name: 'Show', exact: true })).toBeVisible()
  await body.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(body.getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
})

test('preset name input edits the name', async ({ page }) => {
  const input = page.getByPlaceholder('Cloud name...')
  await expect(input).toHaveValue('Default Cloud')
  await input.fill('Storm Front')
  await expect(input).toHaveValue('Storm Front')
})

test('the panel body is absent while its accordion is closed', async ({ page }) => {
  await expect(panelBody(page, 'Export')).toHaveCount(0)
  await openPanel(page, 'Export')
  await expect(panelBody(page, 'Export').getByRole('button', { name: 'Export JSON Preset' })).toBeVisible()
})
