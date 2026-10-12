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
    // 实际覆盖：user-journey(J0/J1) plugin-install(J0) search-and-analysis(J3/J4)
    // realtime(J9) integration-and-lifecycle(J13)
    // 注意：testMatch 的路径含 tests/e2e/ 前缀，所以不要用 ^ 锚定文件名，否则一个都匹配不到
    {
      name: 'smoke',
      use: { browserName: 'chromium' },
      testMatch: /^.*(user-journey|plugin-install|search-and-analysis|realtime|integration-and-lifecycle)\.spec\.ts$/,
    },
    // regression 集（全量回归，排除独立 visual/performance 集）
    // on-demand-loading 归此集而非 smoke：它守的是 P3-1 的定量契约（请求计数），
    // 不是每次提交都要跑的核心旅程；但它是唯一断言「请求了哪个 URL、几次」的 spec，
    // 因此必须留在回归集里，否则「按需加载」的 5 条计数契约在 CI 中无人执行。
    {
      name: 'regression',
      use: { browserName: 'chromium' },
      testMatch: /^.*(user-journey|plugin-install|search-and-analysis|realtime|filter-and-export|view-modes|focus-mode|chaos|integration-and-lifecycle|diff-and-integration|keyboard-shortcuts|i18n|v020-features|view-layers|micro-views|resource-exhaustion|local-repos|large-repo|conversation-remote-web-ui|on-demand-loading)\.spec\.ts$/,
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