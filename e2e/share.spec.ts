import {
  expect,
  inspectedName,
  isConsoleProblem,
  openApp,
  selectBySearch,
  test,
  waitForGraph,
  waitForStableUrl,
} from './helpers'

test.describe('sharing', () => {
  test('copy link, then open it in a new page: the view is rebuilt', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const label = await selectBySearch(page, 'readme')
    const address = await waitForStableUrl(page)

    await page.getByRole('button', { name: 'Copy link to this view' }).click()
    await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(address)

    const other = await context.newPage()
    const problems: string[] = []
    other.on('console', (message) => {
      if (isConsoleProblem(message.type(), message.text())) problems.push(message.text())
    })
    other.on('pageerror', (error) => problems.push(String(error)))
    await other.goto(copied)
    await waitForGraph(other)

    await expect(inspectedName(other)).toHaveText(label)
    expect(await waitForStableUrl(other)).toBe(address)
    expect(problems).toEqual([])
    await other.close()
  })

  test('without the Clipboard API the link is shown, selected, to copy by hand', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    })
    await openApp(page)
    await selectBySearch(page, 'readme')
    const address = await waitForStableUrl(page)

    await page.getByRole('button', { name: 'Copy link to this view' }).click()

    const field = page.getByLabel('Copy this link')
    await expect(field).toHaveValue(address)
    await expect(field).toBeFocused()
    await expect(page.locator('.eog-share [role=status]')).toContainText('Could not copy automatically')

    await field.press('Escape')
    await expect(field).toHaveCount(0)
  })
})
