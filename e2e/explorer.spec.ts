import { expect, explorer, headerStats, openApp, statsText, test, viewParam } from './helpers'

test.describe('explorer', () => {
  test('project and folder narrow the graph, and clearing restores it', async ({ page }) => {
    await openApp(page)
    const whole = await statsText(page)
    const projects = explorer(page).locator('.eog-section').nth(0)
    const folders = explorer(page).locator('.eog-section').nth(1)

    await projects.locator('button.eog-row').first().click()
    await expect(explorer(page).locator('.eog-chip')).toContainText('Project')
    expect(viewParam(page, 'project')).not.toBeNull()
    const scoped = await statsText(page)
    expect(scoped).not.toBe(whole)

    await folders.locator('button.eog-row').first().click()
    await expect(explorer(page).locator('.eog-chip')).toHaveCount(2)
    expect(viewParam(page, 'folder')).not.toBeNull()
    expect(await statsText(page)).not.toBe(scoped)

    await explorer(page).getByRole('button', { name: 'Clear scope' }).click()
    await expect(explorer(page)).toContainText('Whole graph')
    expect(await statsText(page)).toBe(whole)
    expect(new URL(page.url()).search).toBe('')
  })

  test('"show only" filters to one community; the row itself only selects it', async ({ page }) => {
    await openApp(page)
    const whole = await statsText(page)
    const row = explorer(page).locator('.eog-row-pair').first()

    await row.locator('.eog-row').click()
    expect(viewParam(page, 'community')).not.toBeNull()
    expect(await statsText(page)).toBe(whole)

    await row.locator('.eog-row-action').click()
    await expect(row.locator('.eog-row-action')).toHaveAttribute('aria-pressed', 'true')
    await expect(headerStats(page)).toContainText(/Communities\s*1\s*\//)
    expect(viewParam(page, 'only')).not.toBeNull()

    await row.locator('.eog-row-action').click()
    expect(await statsText(page)).toBe(whole)
    expect(viewParam(page, 'only')).toBeNull()
  })

  test('filters: third-party code, isolated nodes, relations, and reset', async ({ page }) => {
    // The heaviest flow: it lays out and draws the whole graph, third-party code included.
    test.slow()
    await openApp(page)
    const whole = await statsText(page)

    await explorer(page).getByRole('switch', { name: /Third-party code/ }).click()
    expect(viewParam(page, 'thirdParty')).toBe('1')
    // Every node is drawn once the extra layout finishes: "visible / total" becomes one figure.
    await expect(headerStats(page)).not.toContainText('/', { timeout: 30_000 })
    await expect(page.locator('.eog-status')).toContainText('System online', { timeout: 30_000 })

    await explorer(page).getByRole('switch', { name: /Isolated nodes/ }).click()
    expect(viewParam(page, 'isolated')).toBe('0')
    await explorer(page).getByRole('switch', { name: /Relations/ }).click()
    expect(viewParam(page, 'relations')).toBe('0')

    await explorer(page).getByRole('button', { name: 'Reset filters and scope' }).click()
    expect(new URL(page.url()).search).toBe('')
    await expect.poll(() => statsText(page)).toBe(whole)
  })
})
