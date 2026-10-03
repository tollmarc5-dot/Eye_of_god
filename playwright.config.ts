import { defineConfig } from '@playwright/test'

const PORT = 4173

/**
 * End-to-end checks of the critical flows, run against the PRODUCTION build
 * (dist/ served as static files) and the real graph.json. Nothing here uses
 * development-only hooks: the tests drive the interface like a user would.
 *
 * `npm run test:e2e` builds first; `npm run e2e` tests the dist/ that is there.
 *
 * Browser:
 * - locally, the installed Google Chrome (nothing to download);
 * - in CI, Playwright's own Chromium: the workflow installs it and sets
 *   EOG_E2E_CHANNEL to an empty value, which means "no channel".
 */
const channelSetting = process.env.EOG_E2E_CHANNEL
const channel = channelSetting === undefined ? 'chrome' : channelSetting || undefined
const isCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e-results',
  // A CI runner has no GPU: WebGL is drawn in software and everything takes several times longer.
  timeout: isCi ? 180_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  // One retry in CI only: a shared runner can be slow, a developer machine should not need it.
  retries: isCi ? 1 : 0,
  forbidOnly: true,
  reporter: isCi ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    channel,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
