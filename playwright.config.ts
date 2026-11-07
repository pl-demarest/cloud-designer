import { defineConfig } from '@playwright/test'

const PORT = 5174

export default defineConfig({
  testDir: 'tests/e2e',
  // Screenshot baselines are platform-specific, so the browser suite runs locally, not in CI.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: { animations: 'disabled' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // System Google Chrome: no Playwright browser download.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // Headless Chrome 'new' headless creates a WebGL2 context without extra flags on this machine
    // (the smoke test asserts it). If a CI image lacks a GPU, add
    // launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }.
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
