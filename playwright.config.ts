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
    // smoke 集（核心 P0 旅程 J0/J1/J3/J4/J9/J13，每次提交运行）
    {
      name: 'smoke',
      use: { browserName: 'chromium' },
      testMatch: /^(user-journey|search-and-analysis|realtime|integration-and-lifecycle)\.spec\.ts$/,
    },
    // regression 集（全量回归，排除独立 visual/performance 集）
    {
      name: 'regression',
      use: { browserName: 'chromium' },
      testMatch: /^(user-journey|search-and-analysis|realtime|filter-and-export|view-modes|focus-mode|chaos|integration-and-lifecycle|diff-and-integration|keyboard-shortcuts|i18n|v020-features|view-layers|micro-views|resource-exhaustion|local-repos|large-repo)\.spec\.ts$/,
    },
    // 独立集：视觉快照（手动触发）
    {
      name: 'visual',
      use: { browserName: 'chromium' },
      testMatch: /visual-screenshots\.spec\.ts$/,
    },
    // 独立集：性能门禁（手动触发）
    {
      name: 'performance',
      use: { browserName: 'chromium' },
      testMatch: /performance\.spec\.ts$/,
    },
    // Firefox 跨浏览器全量
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
  ],
  webServer: {
    command: 'pnpm run build:client && pnpm run dev',
    url: 'http://localhost:3080',
    reuseExistingServer: true,
    timeout: 180000,
  },
});