import type { Page } from '@playwright/test'
import {
  drawnNodeCount,
  expect,
  expectNoOverflow,
  explorer,
  inspectedName,
  inspector,
  modeBanner,
  openApp,
  selectBySearch,
  test,
  VIEWPORTS,
  waitForGraph,
  waitForStableUrl,
  zoomPercent,
} from './helpers'

/**
 * A panel by its element, open or not. A closed panel is `inert`, so it leaves
 * the accessibility tree and role queries (explorer(), inspector()) cannot see it.
 */
const panel = (page: Page, name: 'explorer' | 'inspector') => page.locator(`.eog-${name}`)

/** Opens a panel from its edge tab when the layout started with it closed. */
async function ensurePanelOpen(page: Page, name: 'explorer' | 'inspector'): Promise<void> {
  const tab = page.getByRole('button', { name: `Open ${name}` })
  if (await tab.isVisible()) await tab.click()
  await expect(panel(page, name)).toHaveAttribute('data-open', 'true')
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('loads, searches, inspects, shares and restores without overflow', async ({ page }) => {
      await openApp(page)
      await expectNoOverflow(page)

      const label = await selectBySearch(page, 'readme')
      await expect(inspector(page)).toBeVisible()
      // The actions stay inside the viewport, however small.
      const actions = inspector(page).locator('.eog-node__actions')
      await expect(actions).toBeInViewport()
      await expect(page.getByRole('button', { name: 'Copy link to this view' })).toBeInViewport()
      await expect(page.getByRole('toolbar', { name: 'Graph controls' })).toBeInViewport()
      await expectNoOverflow(page)

      const address = await waitForStableUrl(page)
      await page.reload()
      await waitForGraph(page)
      await expect(inspectedName(page)).toHaveText(label)
      expect(await waitForStableUrl(page)).toBe(address)
      await expectNoOverflow(page)
    })

    test('every main control works at this size: filters, community view, selection, focus, back', async ({ page }) => {
      const isPhone = viewport.width <= 720
      await openApp(page)
      await ensurePanelOpen(page, 'explorer')

      const drawn = await drawnNodeCount(page)
      const isolated = explorer(page).getByRole('switch', { name: /Isolated nodes/ })
      await isolated.click()
      await expect.poll(() => drawnNodeCount(page)).toBeLessThan(drawn)
      await isolated.click()
      await expect.poll(() => drawnNodeCount(page)).toBe(drawn)

      await explorer(page).getByRole('switch', { name: /Community view/ }).click()
      await expect(modeBanner(page)).toContainText('Community view')
      await modeBanner(page).getByRole('button', { name: 'Back to nodes' }).click()
      await expect(modeBanner(page)).toHaveCount(0)

      const keyNodes = explorer(page).locator('.eog-section', { hasText: 'Key nodes' })
      await keyNodes.locator('button.eog-row').first().click()
      await expect(panel(page, 'inspector')).toHaveAttribute('data-open', 'true')
      const first = (await inspectedName(page).innerText()).trim()
      // A phone has room for one sheet: the inspector replaces the explorer.
      await expect(panel(page, 'explorer')).toHaveAttribute('data-open', String(!isPhone))
      await waitForStableUrl(page)

      await page.getByRole('button', { name: 'Reset view' }).click()
      await waitForStableUrl(page)
      const framed = await zoomPercent(page)
      await page.getByRole('button', { name: 'Focus selected node' }).click()
      await expect.poll(() => zoomPercent(page)).toBeGreaterThan(framed)

      const connection = inspector(page).locator('button.eog-connection').first()
      await connection.scrollIntoViewIfNeeded()
      await connection.click()
      await expect(inspectedName(page)).not.toHaveText(first)
      await page.getByRole('button', { name: /^Back to the previous node/ }).click()
      await expect(inspectedName(page)).toHaveText(first)

      if (isPhone) {
        await ensurePanelOpen(page, 'explorer')
        await expect(panel(page, 'inspector')).toHaveAttribute('data-open', 'false')
      }
      await expectNoOverflow(page)
    })
  })
}
