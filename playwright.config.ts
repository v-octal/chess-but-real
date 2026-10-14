import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env.ARENA_PREVIEW_URL || `http://127.0.0.1:${process.env.PASEO_PORT || process.env.PORT || '5173'}`,
    browserName: 'chromium',
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /mobile/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
