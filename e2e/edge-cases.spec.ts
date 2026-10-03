import type { Page } from '@playwright/test'
import {
  cameraRatio,
  drawnNodeCount,
  expect,
  explorer,
  inspectedName,
  inspector,
  modeBanner,
  openApp,
  selectBySearch,
  test,
  viewParam,
  waitForGraph,
  waitForStableUrl,
  zoomPercent,
} from './helpers'

/** Turns the mouse wheel over the middle of the graph, one notch at a time. */
async function wheel(page: Page, notches: number, deltaY: number): Promise<void> {
  await page.mouse.move(720, 450)
  for (let i = 0; i < notches; i++) await page.mouse.wheel(0, deltaY)
}

test.describe('edge cases', () => {
  test('extreme zoom stays readable both ways, and the camera it reaches survives a reload', async ({ page }) => {
    await openApp(page)

    await wheel(page, 50, 600)
    await waitForStableUrl(page)
    expect(cameraRatio(page)).toBeCloseTo(4, 2)
    expect(await zoomPercent(page)).toBe(25)
    const farthest = page.url()

    await page.reload()
    await waitForGraph(page)
    expect(await waitForStableUrl(page)).toBe(farthest)

    await wheel(page, 120, -600)
    await waitForStableUrl(page)
    expect(cameraRatio(page)).toBeCloseTo(0.02, 3)
    expect(await zoomPercent(page)).toBe(5000)
  })

  test('filters that leave no node: an empty world, explanations, and the way back', async ({ page }) => {
    await openApp(page)
    const initial = await drawnNodeCount(page)
    // A document that nothing references: alone in its community.
    await selectBySearch(page, 'Graphify Commands (PDF)')
    await inspector(page).getByRole('button', { name: /^Open community/ }).click()
    await inspector(page).getByRole('button', { name: 'Show only this community' }).click()
    await expect.poll(() => drawnNodeCount(page)).toBe(1)

    await explorer(page).getByRole('switch', { name: /Isolated nodes/ }).click()

    await expect(page.locator('.eog-world')).toHaveAttribute('aria-label', /^Knowledge graph: 0 of/)
    await expect(page.locator('.eog-stats')).toContainText(/nodes\s*0\s*\//i)
    await expect(explorer(page)).toContainText('No nodes in view')
    // The community stays inspected, and says why nothing of it is drawn.
    await expect(inspector(page)).toContainText('None of its nodes is drawn in the current view.')

    await explorer(page).getByRole('switch', { name: /Isolated nodes/ }).click()
    await expect.poll(() => drawnNodeCount(page)).toBe(1)
    await expect(inspector(page).getByRole('button', { name: /^Enter the community at Graphify Commands/ })).toBeVisible()

    await explorer(page).getByRole('button', { name: 'Reset filters and scope' }).click()
    await expect.poll(() => drawnNodeCount(page)).toBe(initial)
    expect(viewParam(page, 'only')).toBeNull()
  })

  test('Escape leaves secondary states one at a time, and never while typing in the search', async ({ page }) => {
    await openApp(page)
    const row = explorer(page).locator('.eog-row-pair .eog-row').first()
    const community = (await row.locator('.eog-row__name').innerText()).trim()
    await row.click()
    await expect(inspectedName(page)).toHaveText(community)

    const search = page.getByRole('combobox', { name: 'Search the graph' })
    await search.fill('readme')
    await expect(page.getByRole('option').first()).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeHidden()
    await expect(inspectedName(page)).toHaveText(community)

    await search.press('Escape')
    await expect(search).not.toBeFocused()
    await page.keyboard.press('Escape')
    await expect(inspector(page)).toContainText('No node selected')
    expect(viewParam(page, 'community')).toBeNull()
  })

  test('labels never overlap, even close up on the full graph with a node selected', async ({ page }) => {
    // Records what Sigma's label and hover canvases draw: text boxes and plates of the last frame.
    await page.addInitScript(() => {
      type Box = { left: number; right: number; top: number; bottom: number }
      const frame: Record<'labels' | 'hovers', Box[]> = { labels: [], hovers: [] }
      Object.assign(window, { __labelFrame: frame })
      const layerOf = (context: CanvasRenderingContext2D) =>
        context.canvas.classList.contains('sigma-labels')
          ? 'labels'
          : context.canvas.classList.contains('sigma-hovers')
            ? 'hovers'
            : null
      const proto = CanvasRenderingContext2D.prototype
      const { clearRect, fillText, roundRect } = proto
      proto.clearRect = function (...args) {
        const layer = layerOf(this)
        if (layer) frame[layer] = []
        return clearRect.apply(this, args)
      }
      proto.fillText = function (text, x, y, ...rest) {
        if (layerOf(this) === 'labels') {
          const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12)
          const width = this.measureText(text).width
          frame.labels.push({ left: x, right: x + width, top: y - size / 2, bottom: y + size / 2 })
        }
        return fillText.call(this, text, x, y, ...rest)
      }
      proto.roundRect = function (x, y, w, h, ...rest) {
        if (layerOf(this) === 'hovers') frame.hovers.push({ left: x, right: x + w, top: y, bottom: y + h })
        return roundRect.call(this, x, y, w, h, ...rest)
      }
    })
    const overlappingPairs = () =>
      page.evaluate(() => {
        const { labels, hovers } = (window as unknown as { __labelFrame: Record<string, { left: number; right: number; top: number; bottom: number }[]> }).__labelFrame
        const boxes = [...(labels ?? []), ...(hovers ?? [])]
        let pairs = 0
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!
            const b = boxes[j]!
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) pairs++
          }
        }
        return { pairs, labels: labels?.length ?? 0, plates: hovers?.length ?? 0 }
      })

    // The densest close-up of the full graph.
    await openApp(page, '?thirdParty=1&cam=0.45,0.5,0.08')
    // The linked camera waits for the layout of the third-party nodes.
    await expect.poll(async () => (await overlappingPairs()).labels, { timeout: 30_000 }).toBeGreaterThan(20)
    expect((await overlappingPairs()).pairs).toBe(0)

    // A node with 30 relations: its plate competes with many neighbour labels.
    await selectBySearch(page, 'taste-skill README')
    // Let the camera arrive: a zoom started mid-flight would cancel the travel.
    await waitForStableUrl(page)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await waitForStableUrl(page)
    const selected = await overlappingPairs()
    expect(selected.plates).toBe(1)
    expect(selected.labels).toBeGreaterThan(3)
    expect(selected.pairs).toBe(0)
  })

  test('the main controls work from the keyboard alone', async ({ page }) => {
    await openApp(page)

    await page.keyboard.press('/')
    await page.keyboard.type('readme')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(inspectedName(page)).not.toHaveText('')
    const first = (await inspectedName(page).innerText()).trim()
    await waitForStableUrl(page)

    const zoomBefore = await zoomPercent(page)
    await page.getByRole('button', { name: 'Zoom out' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => zoomPercent(page)).toBeLessThan(zoomBefore)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect.poll(() => zoomPercent(page)).toBeGreaterThanOrEqual(zoomBefore)

    // Expand from the inspector, leave it with Escape.
    await inspector(page).getByRole('button', { name: 'Expand to depth 1' }).focus()
    await page.keyboard.press('Space')
    await expect(modeBanner(page)).toContainText('Expansion')
    await page.keyboard.press('Escape')
    await expect(modeBanner(page)).toHaveCount(0)

    // A connected node, then back with "[".
    const connection = inspector(page).locator('button.eog-connection').first()
    await connection.focus()
    await page.keyboard.press('Enter')
    await expect(inspectedName(page)).not.toHaveText(first)
    await page.keyboard.press('[')
    await expect(inspectedName(page)).toHaveText(first)
  })
})
