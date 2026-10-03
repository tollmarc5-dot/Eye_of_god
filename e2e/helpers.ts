import { expect, test as base, type Locator, type Page } from '@playwright/test'

/**
 * Performance notes that the browser's own graphics driver writes to the
 * console when WebGL runs without a real GPU (headless Chromium in CI), e.g.
 * "GL Driver Message (OpenGL, Performance, …): GPU stall due to ReadPixels".
 * They describe the test machine, not the application, and are the ONLY
 * console output the suite tolerates.
 */
const GRAPHICS_DRIVER_NOTE = /GL Driver Message \([^)]*\bPerformance\b/

export function isConsoleProblem(type: string, text: string): boolean {
  return (type === 'error' || type === 'warning') && !GRAPHICS_DRIVER_NOTE.test(text)
}

/**
 * Every test fails if the page logs an error or a warning, or throws.
 * A clean console is part of what "it works" means here.
 */
export const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('console', (message) => {
        if (isConsoleProblem(message.type(), message.text())) problems.push(message.text())
      })
      page.on('pageerror', (error) => problems.push(String(error)))
      await use(problems)
      expect(problems, 'console errors or warnings').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 780 },
} as const

export const inspector = (page: Page): Locator => page.getByRole('region', { name: 'Node inspector' })
export const explorer = (page: Page): Locator => page.getByRole('region', { name: 'Explorer' })
export const inspectedName = (page: Page): Locator => inspector(page).locator('.eog-node__name')
export const modeBanner = (page: Page): Locator => page.locator('.eog-mode')
export const headerStats = (page: Page): Locator => page.locator('.eog-stats')

/** The header figures as the user reads them (rendered text, one line). */
export async function statsText(page: Page): Promise<string> {
  return (await headerStats(page).innerText()).replace(/\s+/g, ' ').trim()
}

/** Opens the app (optionally on a deep link) and waits until the real graph is drawn. */
export async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(`./${query}`)
  await waitForGraph(page)
}

export async function waitForGraph(page: Page): Promise<void> {
  await expect(page.locator('.eog-status')).toContainText('System online', { timeout: 30_000 })
  await expect(page.locator('.eog-world canvas').first()).toBeAttached()
}

/** Value of one URL parameter of the current view, or null. */
export function viewParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name)
}

/**
 * Waits until the address stops changing: camera transitions are over and the
 * URL layer has written the resting view. The quiet period has to outlast a
 * camera transition (450 ms) plus the URL layer's own wait for the camera to
 * rest (400 ms) and the renderer's reporting throttle.
 */
export async function waitForStableUrl(page: Page, quietMs = 1600): Promise<string> {
  let last = page.url()
  let quietSince = Date.now()
  while (Date.now() - quietSince < quietMs) {
    await page.waitForTimeout(100)
    if (page.url() !== last) {
      last = page.url()
      quietSince = Date.now()
    }
  }
  return last
}

/** Searches from the header and picks the first result. Returns its label. */
export async function selectBySearch(page: Page, text: string): Promise<string> {
  const input = page.getByRole('combobox', { name: 'Search the graph' })
  await input.click()
  await input.fill(text)
  const first = page.getByRole('option').first()
  await expect(first).toBeVisible()
  const label = (await first.locator('.eog-result__name').innerText()).trim()
  await input.press('Enter')
  await expect(inspectedName(page)).toHaveText(label)
  return label
}

export async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - window.innerWidth,
    height: document.documentElement.scrollHeight - window.innerHeight,
  }))
  expect(overflow.width, 'horizontal overflow').toBeLessThanOrEqual(0)
  expect(overflow.height, 'vertical overflow').toBeLessThanOrEqual(0)
}

/** Opens the first community of the explorer and enters it through its first key node. */
export async function enterCommunity(page: Page, rowIndex: number): Promise<string> {
  await explorer(page).locator('.eog-row-pair .eog-row').nth(rowIndex).click()
  const keyNode = inspector(page).getByRole('button', { name: /^Enter the community at/ }).first()
  const label = ((await keyNode.getAttribute('aria-label')) ?? '').replace('Enter the community at ', '')
  await keyNode.click()
  await expect(inspectedName(page)).toHaveText(label)
  return label
}

/** The zoom the HUD read-out shows, in percent (100 = default framing). */
export async function zoomPercent(page: Page): Promise<number> {
  const text = await page.locator('.eog-readout').innerText()
  const match = /zoom\s*([\d,]+)\s*%/i.exec(text.replace(/\s+/g, ' '))
  if (!match?.[1]) throw new Error(`no zoom in the read-out: ${text}`)
  return Number(match[1].replace(/,/g, ''))
}

/** "Knowledge graph: 721 of 3,271 nodes visible" → 721: what the world says it draws. */
export async function drawnNodeCount(page: Page): Promise<number> {
  const label = (await page.locator('.eog-world').getAttribute('aria-label')) ?? ''
  const match = /([\d,]+) of [\d,]+ nodes visible/.exec(label)
  if (!match?.[1]) throw new Error(`no node count on the world: ${label}`)
  return Number(match[1].replace(/,/g, ''))
}

/** Camera ratio of the current view (1 = default framing), or null when the URL has none. */
export function cameraRatio(page: Page): number | null {
  const camera = viewParam(page, 'cam')
  return camera === null ? null : Number(camera.split(',')[2])
}
