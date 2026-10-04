import type { Page } from '@playwright/test'
import {
  expect,
  explorer,
  inspectedName,
  inspector,
  openApp,
  selectBySearch,
  test,
  VIEWPORTS,
  waitForStableUrl,
  zoomPercent,
} from './helpers'

/**
 * Phase 15A: the graph and the HUD stop covering each other. Everything here is
 * measured in what the page really draws: label text on Sigma's label canvas,
 * the selected node's plate on its hover canvas, and the HUD's boxes in the DOM.
 */

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Records the text boxes of the last label frame and the plates of the last hover frame. */
async function installCanvasProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frame: { labels: Box[]; plates: Box[] } = { labels: [], plates: [] }
    Object.assign(window, { __canvasFrame: frame })
    const layer = (context: CanvasRenderingContext2D) =>
      context.canvas.classList.contains('sigma-labels')
        ? 'labels'
        : context.canvas.classList.contains('sigma-hovers')
          ? 'hovers'
          : null
    const proto = CanvasRenderingContext2D.prototype
    const { clearRect, fillText, roundRect } = proto
    proto.clearRect = function (...args) {
      const which = layer(this)
      if (which === 'labels') frame.labels = []
      if (which === 'hovers') frame.plates = []
      return clearRect.apply(this, args)
    }
    proto.fillText = function (text, x, y, ...rest) {
      if (layer(this) === 'labels') {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12)
        frame.labels.push({ left: x, right: x + this.measureText(text).width, top: y - size / 2, bottom: y + size / 2 })
      }
      return fillText.call(this, text, x, y, ...rest)
    }
    proto.roundRect = function (x, y, w, h, ...rest) {
      if (layer(this) === 'hovers') frame.plates.push({ left: x, top: y, right: x + w, bottom: y + h })
      return roundRect.call(this, x, y, w, h, ...rest)
    }
  })
}

/** Everything the HUD covers right now, as the user sees it. */
const HUD_SELECTOR = [
  '.eog-wordmark',
  '.eog-legend__toggle',
  '.eog-legend__panel:not([hidden])',
  '.eog-topbar__search',
  '.eog-topbar__end',
  '.eog-explorer[data-open="true"]',
  '.eog-inspector[data-open="true"]',
  '.eog-panel-tab',
  '.eog-dock',
  '.eog-readout',
  '.eog-mode',
].join(', ')

interface Reading {
  labels: number
  labelsUnderHud: number
  overlappingLabels: number
  plate: Box | null
  plateUnderHud: boolean
  plateOnScreen: boolean
}

function readFrame(page: Page): Promise<Reading> {
  return page.evaluate((selector) => {
    const frame = (window as unknown as { __canvasFrame: { labels: Box[]; plates: Box[] } }).__canvasFrame
    const zones = [...document.querySelectorAll(selector)].map((element) => element.getBoundingClientRect())
    const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    let overlappingLabels = 0
    for (let i = 0; i < frame.labels.length; i++) {
      for (let j = i + 1; j < frame.labels.length; j++) if (meets(frame.labels[i]!, frame.labels[j]!)) overlappingLabels++
    }
    const plate = frame.plates[0] ?? null
    // The node sits just left of its plate (ring and gap): check a point there too.
    const core = plate ? { left: plate.left - 20, right: plate.left - 12, top: plate.top, bottom: plate.bottom } : null
    return {
      labels: frame.labels.length,
      labelsUnderHud: frame.labels.filter((label) => zones.some((zone) => meets(label, zone))).length,
      overlappingLabels,
      plate,
      plateUnderHud: plate !== null && core !== null && zones.some((zone) => meets(plate, zone) || meets(core, zone)),
      plateOnScreen:
        plate !== null && core !== null && core.left >= 0 && plate.right <= innerWidth && plate.top >= 0 && plate.bottom <= innerHeight,
    }
  }, HUD_SELECTOR)
}

/** The selected node, ring and plate, is on screen and clear of every HUD piece. */
async function expectSelectedVisible(page: Page): Promise<void> {
  await waitForStableUrl(page)
  const reading = await readFrame(page)
  expect(reading.plate, 'the selected node has a plate').not.toBeNull()
  expect(reading.plateOnScreen, 'the selected node is on screen').toBe(true)
  expect(reading.plateUnderHud, 'the selected node is clear of the HUD').toBe(false)
}

async function openPanel(page: Page, name: 'explorer' | 'inspector'): Promise<void> {
  const tab = page.getByRole('button', { name: `Open ${name}` })
  if (await tab.isVisible()) await tab.click()
  await expect(page.locator(`.eog-${name}`)).toHaveAttribute('data-open', 'true')
}

test.describe('legibility of the HUD and the graph', () => {
  test('1440×900, panels open: no label under the HUD, close up on the full graph', async ({ page }) => {
    await installCanvasProbe(page)
    await openApp(page, '?thirdParty=1&cam=0.45,0.5,0.08')
    // The linked camera waits for the layout of the third-party nodes.
    await expect.poll(async () => (await readFrame(page)).labels, { timeout: 30_000 }).toBeGreaterThan(10)

    const reading = await readFrame(page)
    expect(reading.labelsUnderHud).toBe(0)
    expect(reading.overlappingLabels).toBe(0)
  })

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${viewport.width}×${viewport.height}: the selected node lands in the free area`, async ({ page }) => {
      test.slow()
      await page.setViewportSize(viewport)
      await installCanvasProbe(page)
      await openApp(page)
      if (name !== 'mobile') await openPanel(page, 'explorer')

      await selectBySearch(page, 'taste-skill README')
      await expectSelectedVisible(page)
      expect((await readFrame(page)).labelsUnderHud).toBe(0)

      // On a phone the explorer replaces the inspector sheet: the node is moved above it.
      if (name === 'mobile') {
        await openPanel(page, 'explorer')
        await expectSelectedVisible(page)
      }

      await page.getByRole('button', { name: 'Focus selected node' }).click()
      await expectSelectedVisible(page)
      await page.getByRole('button', { name: 'Reset view' }).click()
      await waitForStableUrl(page)
      expect((await readFrame(page)).labelsUnderHud).toBe(0)
    })
  }

  test('the inspector names the selected node even after navigating from deep in a list', async ({ page }) => {
    await installCanvasProbe(page)
    await openApp(page)
    await selectBySearch(page, 'taste-skill README')
    const connection = inspector(page).locator('button.eog-connection').nth(20)
    await connection.scrollIntoViewIfNeeded()
    const target = ((await connection.locator('.eog-connection__name').innerText().catch(() => '')) || '').trim()

    await connection.click()

    const body = inspector(page).locator('.eog-panel__body')
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
    if (target) await expect(inspectedName(page)).toHaveText(target)
    const nameBox = await inspectedName(page).boundingBox()
    const bodyBox = await body.boundingBox()
    expect(nameBox && bodyBox && nameBox.y >= bodyBox.y && nameBox.y + nameBox.height <= bodyBox.y + bodyBox.height).toBe(true)
    await expectSelectedVisible(page)
  })

  test('the community view frames every aggregate, even from a close-up', async ({ page }) => {
    await openApp(page, '?cam=0.45,0.5,0.08')
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(1000)

    await explorer(page).getByRole('switch', { name: /Community view/ }).click()

    await expect.poll(() => zoomPercent(page)).toBeLessThanOrEqual(100)
  })

  test('search, Focus, zoom and Reset still answer as before', async ({ page }) => {
    await openApp(page)
    await selectBySearch(page, 'readme')
    await page.getByRole('button', { name: 'Reset view' }).click()
    await waitForStableUrl(page)
    const framed = await zoomPercent(page)

    await page.getByRole('button', { name: 'Focus selected node' }).click()
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(framed * 2)
    const focused = await zoomPercent(page)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(focused)

    await page.getByRole('button', { name: 'Reset view' }).click()
    await expect.poll(() => zoomPercent(page)).toBe(framed)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('nothing runs per frame at rest, before and after moving the camera', async ({ page }) => {
    await page.addInitScript(() => {
      const native = window.requestAnimationFrame.bind(window)
      const counter = { calls: 0 }
      Object.assign(window, { __rafCounter: counter })
      window.requestAnimationFrame = (callback) => {
        counter.calls++
        return native(callback)
      }
    })
    const callsDuring = async (ms: number) => {
      const before = await page.evaluate(() => (window as unknown as { __rafCounter: { calls: number } }).__rafCounter.calls)
      await page.waitForTimeout(ms)
      return (await page.evaluate(() => (window as unknown as { __rafCounter: { calls: number } }).__rafCounter.calls)) - before
    }

    await openApp(page)
    await waitForStableUrl(page)
    expect(await callsDuring(2000)).toBe(0)

    await selectBySearch(page, 'readme')
    await page.getByRole('button', { name: 'Focus selected node' }).click()
    await waitForStableUrl(page)
    expect(await callsDuring(2000)).toBe(0)
  })
})
