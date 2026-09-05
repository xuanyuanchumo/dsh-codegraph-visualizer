import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 120000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 60000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'pnpm run build:client && pnpm run dev',
    url: 'http://localhost:3080',
    reuseExistingServer: true,
    timeout: 180000,
  },
});