import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /live_demo_audit\.spec\.js|todo_app_simulation\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live-demo',
      testMatch: /live_demo_audit\.spec\.js/,
      timeout: 360_000,
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        launchOptions: { slowMo: 0 },
        video: 'on',
        trace: 'on',
        viewport: { width: 1280, height: 720 },
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
      },
    },
    {
      name: 'todo-sim',
      testMatch: /todo_app_simulation\.spec\.js/,
      timeout: 360_000,
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        launchOptions: { slowMo: 300 },
        video: 'on',
        trace: 'on',
        viewport: { width: 1280, height: 720 },
        actionTimeout: 45_000,
        navigationTimeout: 60_000,
      },
    },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173 --mode e2e',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_E2E_AUTH_BYPASS: 'true',
    },
  },
})
