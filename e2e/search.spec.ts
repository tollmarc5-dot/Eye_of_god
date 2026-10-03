import { expect, inspectedName, inspector, openApp, selectBySearch, test, viewParam, waitForStableUrl } from './helpers'

test.describe('search', () => {
  test('finds nodes, shows context and selects a result into the inspector', async ({ page }) => {
    await openApp(page)
    const input = page.getByRole('combobox', { name: 'Search the graph' })

    await page.keyboard.press('/')
    await expect(input).toBeFocused()
    await input.fill('readme')
    await expect(page.getByRole('option').first()).toBeVisible()
    expect(await page.getByRole('option').count()).toBeGreaterThan(1)
    await expect(page.locator('.eog-results__note')).toContainText(/\d+ of \d+/)

    await input.press('ArrowDown')
    const second = page.getByRole('option').nth(1)
    await expect(second).toHaveAttribute('aria-selected', 'true')
    const label = (await second.locator('.eog-result__name').innerText()).trim()
    await input.press('Enter')

    await expect(inspectedName(page)).toHaveText(label)
    await expect(inspector(page).getByText('Location')).toBeVisible()
    expect(viewParam(page, 'node')).not.toBeNull()
  })

  test('selecting a result focuses the camera on the node', async ({ page }) => {
    await openApp(page)
    const label = await selectBySearch(page, 'readme')

    await waitForStableUrl(page)
    // Focus zooms to a fixed ratio; the camera lands in the URL once it rests.
    expect(viewParam(page, 'cam')).toMatch(/,0\.2$/)

    // The node is now at the centre of the canvas: a click there keeps it selected.
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('no viewport')
    await page.mouse.click(viewport.width / 2, viewport.height / 2)
    await expect(inspectedName(page)).toHaveText(label)
  })

  test('says so when nothing matches, and Escape cancels', async ({ page }) => {
    await openApp(page)
    const input = page.getByRole('combobox', { name: 'Search the graph' })

    await input.fill('zzz-no-such-node-zzz')
    await expect(page.locator('.eog-results__note')).toContainText('No matches')
    await input.press('Escape')

    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(viewParam(page, 'node')).toBeNull()
  })
})
