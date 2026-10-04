import { expect, explorer, inspectedName, inspector, modeBanner, openApp, test, viewParam, waitForStableUrl } from './helpers'

test.describe('communities', () => {
  test('community view, select, expand, collapse, focus and back to nodes', async ({ page }) => {
    await openApp(page)
    const row = explorer(page).locator('.eog-row-pair .eog-row').first()
    const name = (await row.locator('.eog-row__name').innerText()).trim()

    await explorer(page).getByRole('switch', { name: /Community view/ }).click()
    await expect(modeBanner(page)).toContainText('Community view')
    expect(viewParam(page, 'view')).toBe('communities')

    await row.click()
    await expect(inspectedName(page)).toHaveText(name)
    await expect(inspector(page).locator('.eog-node__tags')).toContainText('Collapsed')
    const communityId = viewParam(page, 'community')
    expect(communityId).not.toBeNull()
    // Total and visible members are both shown.
    await expect(inspector(page).locator('.eog-figure', { hasText: 'Nodes' })).toContainText(/\d+/)
    await expect(inspector(page).locator('.eog-figure', { hasText: 'Visible' })).toContainText(/\d+/)

    await inspector(page).getByRole('button', { name: /^Expand:/ }).click()
    await expect(inspector(page).locator('.eog-node__tags')).toContainText('Expanded')
    expect(viewParam(page, 'expanded')).toBe(communityId)

    await inspector(page).getByRole('button', { name: /^Collapse:/ }).click()
    await expect(inspector(page).locator('.eog-node__tags')).toContainText('Collapsed')
    expect(viewParam(page, 'expanded')).toBeNull()

    const beforeFocus = await waitForStableUrl(page)
    await page.getByRole('button', { name: 'Reset view' }).click()
    await inspector(page).getByRole('button', { name: 'Focus this community' }).click()
    await waitForStableUrl(page)
    expect(viewParam(page, 'cam')).not.toBeNull()
    expect(new URL(beforeFocus).searchParams.get('community')).toBe(communityId)

    await modeBanner(page).getByRole('button', { name: 'Back to nodes' }).click()
    expect(viewParam(page, 'view')).toBeNull()
    await expect(inspectedName(page)).toHaveText(name)
  })

  test('community → nodes → community', async ({ page }) => {
    await openApp(page)
    const row = explorer(page).locator('.eog-row-pair .eog-row').first()
    const name = (await row.locator('.eog-row__name').innerText()).trim()
    await row.click()

    await inspector(page).getByRole('button', { name: /^Enter the community at/ }).first().click()
    await expect(inspectedName(page)).not.toHaveText(name)
    expect(viewParam(page, 'node')).not.toBeNull()
    expect(viewParam(page, 'community')).toBeNull()

    await inspector(page).getByRole('button', { name: /^Open community/ }).click()
    await expect(inspectedName(page)).toHaveText(name)
    expect(viewParam(page, 'community')).not.toBeNull()

    await inspector(page).getByRole('button', { name: 'Clear selection' }).click()
    await expect(inspector(page)).toContainText('No node selected')
    expect(viewParam(page, 'community')).toBeNull()
  })
})
