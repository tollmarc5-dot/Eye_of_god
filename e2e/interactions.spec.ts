import {
  drawnNodeCount,
  enterCommunity,
  expect,
  explorer,
  inspectedName,
  inspector,
  modeBanner,
  openApp,
  selectBySearch,
  statsText,
  test,
  viewParam,
  waitForGraph,
  waitForStableUrl,
  zoomPercent,
} from './helpers'

/** Combinations of features, end to end: the state has to stay coherent across all of them. */
test.describe('interactions', () => {
  test('A · search → inspector → Focus → Reset view: the camera moves, the selection stays', async ({ page }) => {
    await openApp(page)
    const label = await selectBySearch(page, 'readme')
    await waitForStableUrl(page)

    await page.getByRole('button', { name: 'Reset view' }).click()
    await waitForStableUrl(page)
    const framed = await zoomPercent(page)

    await page.getByRole('button', { name: 'Focus selected node' }).click()
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(framed * 2)

    await page.getByRole('button', { name: 'Reset view' }).click()
    await expect.poll(() => zoomPercent(page)).toBe(framed)
    await expect(inspectedName(page)).toHaveText(label)
    expect(viewParam(page, 'node')).not.toBeNull()
  })

  test('B · a filter that hides the selected node deselects it; one that keeps it drawn keeps it', async ({ page }) => {
    await openApp(page)
    // Third-party code: picking it switches that code on.
    await selectBySearch(page, 'make_xlsx_lib')
    expect(viewParam(page, 'thirdParty')).toBe('1')

    await explorer(page).getByRole('switch', { name: /Third-party code/ }).click()
    await expect(inspector(page)).toContainText('No node selected')
    expect(viewParam(page, 'node')).toBeNull()
    expect(viewParam(page, 'thirdParty')).toBeNull()

    const label = await selectBySearch(page, 'readme')
    await explorer(page).getByRole('switch', { name: /Isolated nodes/ }).click()
    expect(viewParam(page, 'isolated')).toBe('0')
    await expect(inspectedName(page)).toHaveText(label)
    expect(viewParam(page, 'node')).not.toBeNull()
  })

  test('C · project → folder → community, then reset: the scope goes, the inspected community stays', async ({ page }) => {
    await openApp(page)
    const whole = await statsText(page)
    await explorer(page).locator('.eog-section').nth(0).locator('button.eog-row').first().click()
    await explorer(page).locator('.eog-section').nth(1).locator('button.eog-row').first().click()
    const row = explorer(page).locator('.eog-row-pair .eog-row').first()
    const community = (await row.locator('.eog-row__name').innerText()).trim()
    await row.click()
    await expect(inspectedName(page)).toHaveText(community)
    expect(viewParam(page, 'folder')).not.toBeNull()

    await explorer(page).getByRole('button', { name: 'Reset filters and scope' }).click()

    await expect(explorer(page)).toContainText('Whole graph')
    expect(await statsText(page)).toBe(whole)
    expect(viewParam(page, 'project')).toBeNull()
    expect(viewParam(page, 'folder')).toBeNull()
    // Reset is about what is drawn; the inspected community is still drawn.
    await expect(inspectedName(page)).toHaveText(community)
    expect(viewParam(page, 'community')).not.toBeNull()
  })

  test('D · community view → community → expand → node → Back returns to the expanded community', async ({ page }) => {
    await openApp(page)
    await explorer(page).getByRole('switch', { name: /Community view/ }).click()
    const row = explorer(page).locator('.eog-row-pair .eog-row').nth(2)
    const community = (await row.locator('.eog-row__name').innerText()).trim()
    await row.click()
    await inspector(page).getByRole('button', { name: /^Expand:/ }).click()
    const communityId = viewParam(page, 'community')
    expect(viewParam(page, 'expanded')).toBe(communityId)

    const keyNode = inspector(page).getByRole('button', { name: /^Enter the community at/ }).first()
    const label = ((await keyNode.getAttribute('aria-label')) ?? '').replace('Enter the community at ', '')
    await keyNode.click()
    await expect(inspectedName(page)).toHaveText(label)
    // The node is drawn as a node: its community stays expanded, the view stays the community view.
    expect(viewParam(page, 'view')).toBe('communities')
    expect(viewParam(page, 'expanded')).toBe(communityId)

    await page.goBack()
    await expect(inspectedName(page)).toHaveText(community)
    await expect(inspector(page).locator('.eog-node__tags')).toContainText('Expanded')
    expect(viewParam(page, 'community')).toBe(communityId)
    await expect(modeBanner(page)).toContainText('1 expanded')
  })

  test('E · path → navigate along it → history Back: the path stays until it is cleared', async ({ page }) => {
    await openApp(page)
    const origin = await enterCommunity(page, 0)
    await inspector(page).getByRole('button', { name: /^Path to/ }).click()
    const destination = inspector(page).locator('button.eog-connection').first()
    await destination.scrollIntoViewIfNeeded()
    await destination.click()
    await expect(modeBanner(page)).toContainText(/\d+ hops?/)
    const destinationName = (await inspectedName(page).innerText()).trim()
    const from = viewParam(page, 'from')
    const to = viewParam(page, 'to')

    // Walk to the origin from the route itself.
    await inspector(page).locator('.eog-path__route button').first().click()
    await expect(inspectedName(page)).toHaveText(origin)
    await expect(modeBanner(page)).toContainText(/\d+ hops?/)

    await page.keyboard.press('[')
    await expect(inspectedName(page)).toHaveText(destinationName)
    expect(viewParam(page, 'from')).toBe(from)
    expect(viewParam(page, 'to')).toBe(to)

    await page.keyboard.press('Escape')
    await expect(modeBanner(page)).toHaveCount(0)
    await expect(inspectedName(page)).toHaveText(destinationName)
  })

  test('F · selection + filters + path survive a reload together', async ({ page }) => {
    await openApp(page)
    await enterCommunity(page, 0)
    await inspector(page).getByRole('button', { name: /^Path to/ }).click()
    const destination = inspector(page).locator('button.eog-connection').first()
    await destination.scrollIntoViewIfNeeded()
    await destination.click()
    await expect(modeBanner(page)).toContainText(/\d+ hops?/)
    await explorer(page).getByRole('switch', { name: /Isolated nodes/ }).click()
    await explorer(page).getByRole('switch', { name: /Relations/ }).click()
    const name = (await inspectedName(page).innerText()).trim()
    const hops = (await modeBanner(page).locator('.eog-mode__text').innerText()).trim()
    const drawn = await drawnNodeCount(page)
    const address = await waitForStableUrl(page)

    await page.reload()
    await waitForGraph(page)

    await expect(inspectedName(page)).toHaveText(name)
    await expect(modeBanner(page).locator('.eog-mode__text')).toHaveText(hops)
    await expect(explorer(page).getByRole('switch', { name: /Isolated nodes/ })).toHaveAttribute('aria-checked', 'false')
    await expect(explorer(page).getByRole('switch', { name: /Relations/ })).toHaveAttribute('aria-checked', 'false')
    expect(await drawnNodeCount(page)).toBe(drawn)
    expect(await waitForStableUrl(page)).toBe(address)
  })
})
