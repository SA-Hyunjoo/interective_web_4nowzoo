import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, expect: { timeout: 10000 }, workers: 1,
  use: { baseURL: 'https://127.0.0.1:5187', ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 }, channel: 'chrome', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort', url: 'https://127.0.0.1:5187', ignoreHTTPSErrors: true, reuseExistingServer: !process.env.CI },
})
