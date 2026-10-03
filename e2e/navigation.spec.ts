import {
  enterCommunity,
  expect,
  inspectedName,
  inspector,
  modeBanner,
  openApp,
  selectBySearch,
  test,
  viewParam,
} from './helpers'

test.describe('navigation', () => {
  test('internal history: back and forward follow the nodes visited', async ({ page }) => {
    await openApp(page)
    const back = page.getByRole('button', { name: /^Back to the previous node/ })
    const forward = page.getByRole('button', { name: /^Forward to the next node/ })
    await expect(back).toBeDisabled()

    const first = await selectBySearch(page, 'readme')
    // Second node: a connected node, through the inspector list.
    const connected = inspector(page).locator('button.eog-connection').first()
    await connected.scrollIntoViewIfNeeded()
    await connected.click()
    await expect(inspectedName(page)).not.toHaveText(first)
    const second = (await inspectedName(page).innerText()).trim()

    await back.click()
    await expect(inspectedName(page)).toHaveText(first)
    await expect(forward).toBeEnabled()

    await forward.click()
    await expect(inspectedName(page)).toHaveText(second)
    await expect(forward).toBeDisabled()

    // Keyboard shortcuts walk the same history.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('[')
    await expect(inspectedName(page)).toHaveText(first)
  })

  test('expansion at depth 1, 2 and 3 lights a growing neighbourhood', async ({ page }) => {
    await openApp(page)
    await enterCommunity(page, 0)
    const sizes: number[] = []

    for (const depth of [1, 2, 3]) {
      await inspector(page).getByRole('button', { name: `Expand to depth ${depth}` }).click()
      await expect(modeBanner(page)).toContainText(`Depth ${depth}`)
      expect(viewParam(page, 'expand')).toBe(String(depth))
      const text = await modeBanner(page).innerText()
      sizes.push(Number(/(\d+) nodes/.exec(text)?.[1]))
    }
    expect(sizes[0]).toBeGreaterThan(1)
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[0] ?? 0)
    expect(sizes[2]).toBeGreaterThanOrEqual(sizes[1] ?? 0)

    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Escape')
    await expect(modeBanner(page)).toHaveCount(0)
    expect(viewParam(page, 'expand')).toBeNull()
  })

  test('path between two connected nodes, then clear', async ({ page }) => {
    await openApp(page)
    const origin = await enterCommunity(page, 0)

    await inspector(page).getByRole('button', { name: /^Path to/ }).click()
    await expect(modeBanner(page)).toContainText('Select the destination node')
    // Destination: a node connected to the origin, picked from the inspector.
    const destination = inspector(page).locator('button.eog-connection').first()
    await destination.scrollIntoViewIfNeeded()
    await destination.click()

    await expect(modeBanner(page)).toContainText(/\d+ hops?/)
    await expect(inspector(page).locator('.eog-path__title')).toContainText(/\d+ hops? · \d+ nodes/)
    await expect(inspector(page).locator('.eog-path__route button').first()).toContainText(origin)
    expect(viewParam(page, 'from')).not.toBeNull()
    expect(viewParam(page, 'to')).toBe(viewParam(page, 'node'))

    await inspector(page).getByRole('button', { name: 'Clear path' }).click()
    await expect(modeBanner(page)).toHaveCount(0)
    expect(viewParam(page, 'from')).toBeNull()
    expect(viewParam(page, 'node')).not.toBeNull()
  })

  test('no path between nodes of two unconnected communities', async ({ page }) => {
    await openApp(page)
    await enterCommunity(page, 0)
    await inspector(page).getByRole('button', { name: /^Path to/ }).click()

    // Among project code, communities are not connected to each other.
    const destination = await enterCommunity(page, 1)

    await expect(inspector(page).locator('.eog-path__title')).toHaveText('No path found')
    await expect(modeBanner(page)).toContainText('No path found')
    // The destination is still inspected normally.
    await expect(inspectedName(page)).toHaveText(destination)
  })
})
