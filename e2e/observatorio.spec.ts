import type { Page } from '@playwright/test'
import { expect, explorer, inspector, openApp, test, waitForStableUrl } from './helpers'

/**
 * Phase 15B, the Observatorio HUD: constellation names, legend, explorer rail,
 * search shortcut and skip links, in a real browser.
 */

/** Texts of the last frame of Sigma's label canvas, with the font they were drawn in. */
async function installLabelProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frame: { texts: { text: string; font: string }[] } = { texts: [] }
    Object.assign(window, { __labelFrame: frame })
    const proto = CanvasRenderingContext2D.prototype
    const { clearRect, fillText } = proto
    proto.clearRect = function (...args) {
      if (this.canvas.classList.contains('sigma-labels')) frame.texts = []
      return clearRect.apply(this, args)
    }
    proto.fillText = function (text, x, y, ...rest) {
      if (this.canvas.classList.contains('sigma-labels')) frame.texts.push({ text, font: this.font })
      return fillText.call(this, text, x, y, ...rest)
    }
  })
}

const constellationNames = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as { __labelFrame: { texts: { text: string; font: string }[] } }).__labelFrame.texts
      .filter((entry) => entry.font.includes('Plex Mono'))
      .map((entry) => entry.text),
  )

test.describe('Observatorio', () => {
  test('the universe names its largest communities, and only at universe scale in the node view', async ({ page }) => {
    await installLabelProbe(page)
    await openApp(page)
    await expect.poll(async () => (await constellationNames(page)).length).toBeGreaterThanOrEqual(5)
    const names = await constellationNames(page)
    for (const name of names) expect(name).toBe(name.toUpperCase())

    // The community view names its aggregates itself: no second name over them.
    await explorer(page).getByRole('switch', { name: /Community view/ }).click()
    await expect.poll(async () => (await constellationNames(page)).length).toBe(0)
  })

  test('the stars and nebulae sit behind the graph, never in the way of the pointer', async ({ page }) => {
    await openApp(page)
    const layer = page.locator('.eog-world canvas.eog-universe')
    await expect(layer).toHaveCount(1)
    expect(await layer.evaluate((canvas) => getComputedStyle(canvas).pointerEvents)).toBe('none')
    expect(await layer.evaluate((canvas) => canvas.parentElement?.firstElementChild === canvas)).toBe(true)
  })

  test('the legend opens from its button, explains every mark in words and closes with Escape', async ({ page }) => {
    await openApp(page)
    const toggle = page.getByRole('button', { name: 'Legend' })

    await toggle.click()
    const legend = page.getByRole('region', { name: 'Legend' })
    await expect(legend).toBeVisible()
    await expect(legend).toContainText('third-party code')

    await page.keyboard.press('Escape')
    await expect(legend).toBeHidden()
    await expect(toggle).toBeFocused()
  })

  test('with the explorer folded, the rail opens it straight on a section', async ({ page }) => {
    await openApp(page)
    await explorer(page).getByRole('button', { name: /^Collapse explorer|^Close explorer/ }).click()
    const rail = page.getByRole('navigation', { name: 'Explorer sections' })
    await expect(rail).toBeVisible()

    await rail.getByRole('button', { name: 'Key nodes' }).click()

    await expect(page.locator('.eog-explorer')).toHaveAttribute('data-open', 'true')
    await expect(explorer(page).locator('[data-section="key-nodes"] .eog-section__toggle')).toBeFocused()
    await expect(rail).toHaveCount(0)
  })

  test('the first Tab offers the skip links; they reach the search and the inspector', async ({ page }) => {
    await openApp(page)

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to search' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('combobox', { name: 'Search the graph' })).toBeFocused()

    await page.getByRole('link', { name: 'Skip to the inspector' }).focus()
    await page.keyboard.press('Enter')
    await expect(inspector(page)).toBeFocused()
  })

  test('Ctrl K reaches the search from anywhere', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Legend' }).focus()

    await page.keyboard.press('Control+k')

    await expect(page.getByRole('combobox', { name: 'Search the graph' })).toBeFocused()
    await waitForStableUrl(page)
  })

  test('at rest the observatory is still, even without reduced motion: no frame runs', async ({ page }) => {
    await page.addInitScript(() => {
      const native = window.requestAnimationFrame.bind(window)
      const counter = { calls: 0 }
      Object.assign(window, { __rafCounter: counter })
      window.requestAnimationFrame = (callback) => {
        counter.calls++
        return native(callback)
      }
    })
    await openApp(page)
    await waitForStableUrl(page)
    const calls = () => page.evaluate(() => (window as unknown as { __rafCounter: { calls: number } }).__rafCounter.calls)

    const before = await calls()
    await page.waitForTimeout(2000)
    expect(await calls()).toBe(before)
  })
})
