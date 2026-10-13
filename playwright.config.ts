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
    // 视口必须显式钉住：视觉基线的像素尺寸是快照契约的一部分，
    // 依赖浏览器默认值意味着换 Playwright 版本就可能整体错位。
    viewport: { width: 1280, height: 720 },
  },
  // 视觉基线按「项目 + 平台」隔离。
  //
  // 为什么必须分平台：本机（Windows）与 CI（`.github/workflows/ci.yml` 全部 job 都是
  // `runs-on: ubuntu-latest`）的字体渲染与抗锯齿不同，同一份 PNG 无法互通；
  // 不加 `{platform}` 的话，本机生成的基线到了 ubuntu 上会整体假红。
  // `{projectName}` 让 visual 与 firefox 等项目的基线互不覆盖。
  //
  // 注：`firefox` project 无 testMatch（全量），所以视觉用例也会在 firefox 下跑一次，
  // 其基线落在 `.../firefox/` 子目录里，与 chromium 互不干扰。
  snapshotPathTemplate: 'tests/e2e/__screenshots__/{projectName}-{platform}/{testFilePath}/{arg}{ext}',
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
    // conditional-requests 同理：它守的是 ETag/304 的条件请求契约，只有请求头与
    // 响应码能区分「304 保留现状」与「304 被当成失败把面板清空」，必须进回归集。
    {
      name: 'regression',
      use: { browserName: 'chromium' },
      testMatch: /^.*(user-journey|plugin-install|search-and-analysis|realtime|filter-and-export|view-modes|focus-mode|chaos|integration-and-lifecycle|diff-and-integration|keyboard-shortcuts|i18n|v020-features|view-layers|micro-views|resource-exhaustion|local-repos|large-repo|conversation-remote-web-ui|on-demand-loading|conditional-requests)\.spec\.ts$/,
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