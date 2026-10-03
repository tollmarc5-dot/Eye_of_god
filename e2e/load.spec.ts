import { expect, expectNoOverflow, explorer, headerStats, inspector, openApp, test } from './helpers'

test.describe('initial load', () => {
  test('the real graph loads, is drawn and the app is ready', async ({ page }) => {
    await openApp(page)

    await expect(page).toHaveTitle('Eye of God')
    // Figures come from graph.json: visible / total nodes, relations, communities.
    await expect(headerStats(page)).toContainText(/Nodes\s*[\d,]+\s*\/\s*[\d,]+/)
    await expect(headerStats(page)).toContainText('Relations')
    await expect(explorer(page).locator('.eog-row-pair').first()).toBeVisible()
    await expect(inspector(page)).toContainText('No node selected')
    expect(new URL(page.url()).search).toBe('')
    await expectNoOverflow(page)
  })

  test('graph.json is fetched from the deployed site, next to the page', async ({ page }) => {
    const responses: { url: string; status: number }[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('graph.json')) responses.push({ url: response.url(), status: response.status() })
    })

    await openApp(page)

    expect(responses).toHaveLength(1)
    expect(responses[0]?.status).toBe(200)
    expect(responses[0]?.url).toBe(new URL('data/graph.json', page.url().split('?')[0]).href)
  })

  test('every asset loads: nothing 404s and nothing points at another server', async ({ page, baseURL }) => {
    const failed: string[] = []
    const foreign: string[] = []
    const origin = new URL(baseURL ?? '').origin
    page.on('response', (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`)
      if (new URL(response.url()).origin !== origin) foreign.push(response.url())
    })

    await openApp(page)
    await page.waitForLoadState('networkidle')

    expect(failed).toEqual([])
    expect(foreign).toEqual([])
  })

  test('the production build does not expose the development handle', async ({ page }) => {
    await openApp(page)

    expect(await page.evaluate(() => '__EOG__' in window)).toBe(false)
  })
})
