import {
  enterCommunity,
  expect,
  explorer,
  statsText,
  inspectedName,
  inspector,
  modeBanner,
  openApp,
  selectBySearch,
  test,
  viewParam,
  waitForGraph,
  waitForStableUrl,
} from './helpers'

test.describe('URL state', () => {
  test('selection and camera survive a reload', async ({ page }) => {
    await openApp(page)
    const label = await selectBySearch(page, 'readme')
    const before = await waitForStableUrl(page)
    expect(viewParam(page, 'node')).not.toBeNull()
    expect(viewParam(page, 'cam')).not.toBeNull()

    await page.reload()
    await waitForGraph(page)

    await expect(inspectedName(page)).toHaveText(label)
    expect(await waitForStableUrl(page)).toBe(before)
  })

  test('filters and scope survive a reload', async ({ page }) => {
    await openApp(page)
    await explorer(page).getByRole('switch', { name: /Isolated nodes/ }).click()
    await explorer(page).locator('.eog-section').nth(0).locator('button.eog-row').first().click()
    const stats = await statsText(page)
    const before = await waitForStableUrl(page)
    expect(viewParam(page, 'isolated')).toBe('0')

    await page.reload()
    await waitForGraph(page)

    await expect.poll(() => statsText(page)).toBe(stats)
    await expect(explorer(page).getByRole('switch', { name: /Isolated nodes/ })).toHaveAttribute('aria-checked', 'false')
    await expect(explorer(page).locator('.eog-chip')).toContainText('Project')
    expect(await waitForStableUrl(page)).toBe(before)
  })

  test('community view and a selected community survive a reload', async ({ page }) => {
    await openApp(page)
    await explorer(page).getByRole('switch', { name: /Community view/ }).click()
    const row = explorer(page).locator('.eog-row-pair .eog-row').first()
    const name = (await row.locator('.eog-row__name').innerText()).trim()
    await row.click()
    await inspector(page).getByRole('button', { name: /^Expand:/ }).click()
    const before = await waitForStableUrl(page)

    await page.reload()
    await waitForGraph(page)

    await expect(modeBanner(page)).toContainText('Community view')
    await expect(inspectedName(page)).toHaveText(name)
    await expect(inspector(page).locator('.eog-node__tags')).toContainText('Expanded')
    expect(await waitForStableUrl(page)).toBe(before)
  })

  test('a path survives a reload from its two ids', async ({ page }) => {
    await openApp(page)
    await enterCommunity(page, 0)
    await inspector(page).getByRole('button', { name: /^Path to/ }).click()
    const destination = inspector(page).locator('button.eog-connection').first()
    await destination.scrollIntoViewIfNeeded()
    await destination.click()
    const title = await inspector(page).locator('.eog-path__title').innerText()
    await waitForStableUrl(page)

    await page.reload()
    await waitForGraph(page)

    await expect(inspector(page).locator('.eog-path__title')).toHaveText(title)
    await expect(modeBanner(page)).toContainText(/\d+ hops?/)
  })

  test('browser Back and Forward walk the views, without loops', async ({ page }) => {
    await openApp(page)
    const first = await selectBySearch(page, 'readme')
    await waitForStableUrl(page)
    const second = await selectBySearch(page, 'index')
    await waitForStableUrl(page)
    expect(second).not.toBe(first)

    await page.goBack()
    await expect(inspectedName(page)).toHaveText(first)
    await page.goBack()
    await expect(inspector(page)).toContainText('No node selected')
    await page.goForward()
    await expect(inspectedName(page)).toHaveText(first)
    await page.goForward()
    await expect(inspectedName(page)).toHaveText(second)

    // At rest nothing keeps writing: same address, same number of entries.
    const url = await waitForStableUrl(page)
    const entries = await page.evaluate(() => window.history.length)
    await page.waitForTimeout(1500)
    expect(page.url()).toBe(url)
    expect(await page.evaluate(() => window.history.length)).toBe(entries)
  })

  test('moving the camera rewrites the entry instead of adding new ones', async ({ page }) => {
    await openApp(page)
    await selectBySearch(page, 'readme')
    await waitForStableUrl(page)
    const entries = await page.evaluate(() => window.history.length)
    const camera = viewParam(page, 'cam')

    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await waitForStableUrl(page)

    expect(viewParam(page, 'cam')).not.toBe(camera)
    expect(await page.evaluate(() => window.history.length)).toBe(entries)
  })

  test('a deep link opens directly on its view', async ({ page }) => {
    await openApp(page)
    const label = await selectBySearch(page, 'readme')
    const link = await waitForStableUrl(page)

    await page.goto('about:blank')
    await page.goto(link)
    await waitForGraph(page)

    await expect(inspectedName(page)).toHaveText(label)
  })

  test('a broken link is ignored and cleaned, never an error', async ({ page }) => {
    await openApp(page, '?node=ghost&community=999999&cam=NaN,1,2&thirdParty=maybe&view=%3Cscript%3E&expand=7&x=1')

    await expect(inspector(page)).toContainText('No node selected')
    expect(new URL(page.url()).search).toBe('')
  })
})
