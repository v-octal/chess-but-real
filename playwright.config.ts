import { defineConfig } from '@playwright/test'

const previewUrl = process.env.PLAYWRIGHT_PREVIEW_URL
const preview = previewUrl ? new URL(previewUrl) : null

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
  webServer: preview ? {
    command: `npm run preview -- --port ${preview.port || '4173'} --strictPort --base ${preview.pathname}`,
    url: preview.href,
    reuseExistingServer: false,
  } : undefined,
  use: {
    baseURL: previewUrl || process.env.ARENA_PREVIEW_URL || `http://127.0.0.1:${process.env.PASEO_PORT || process.env.PORT || '5173'}`,
    browserName: 'chromium',
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /mobile/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'webkit-dialogs',
      grep: /new game dialog/,
      use: {
        browserName: 'webkit',
        viewport: { width: 1440, height: 1000 },
        launchOptions: { args: [] },
      },
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
