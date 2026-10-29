import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:3080';

// ── 端口身份守卫（为什么需要三道）──────────────────────────────────────────
// `webServer.reuseExistingServer: true` + 固定 3080 意味着**本机 3080 上的任何东西都会被
// 当成被测站点**。实测（cycle-110）占用者是真机验证用的桌面端 DSH 宿主
// （进程名 `DeepSeek Harness.exe`），后果分两种：
//   · 宿主回 401 ⇒ Playwright 判定「URL 不可用」⇒ 来起自己的 dev-server ⇒ 端口打不开但
//     进程不退出 ⇒ 「webServer 180s 超时」（伪装成环境慢）；
//   · 宿主回 200 ⇒ Playwright 直接复用 ⇒ 20 个 spec 全落到宿主页面 ⇒
//     `TimeoutError: locator('.cg-graph-panel')`（伪装成选择器漂移，见 docs/测试体系.md §2.7）。
// 两种都是**假失败**，而且绿色的 run 同样不能作为回归证据。
// 判定分三道，判据与文案的单一事实源在 `tests/e2e/port-identity.mjs`：
//   1. `webServer.command` 的第一段 `preflight-dev-server.mjs`（只在「要自己起服务」时跑）
//   2. `globalSetup`：跑任何 spec 之前再确认一次（防两阶段之间 owner 变更，实测发生过）
//   3. 手动排障：`curl -s -o /dev/null -w "%{http_code}" http://localhost:3080`
// 说明：`playwright.config.ts` 只支持导出对象（async 工厂会报 "must export a single object"），
// 所以没有第四道「配置阶段」判定。

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // ── outputDir 必须与真机启动器的 Chrome profile 解耦（cycle-110 实测）────────
  // Playwright 每次 run 的「clear output」阶段会**递归删除 outputDir**。默认值 `test-results`
  // 恰好是 `scripts/start-dsh-test.mjs:50` 放真机 Chrome profile 的地方
  // （`USER_DATA_DIR = test-results/chrome-debug-profile`，内含数千个 WasmTtsEngine 缓存文件，
  // 且运行中被 Chrome 锁定）。后果：E2E 一启动就卡在删除上——实测 `--global-timeout=25s` 报
  // 「Timed out waiting 25s for the clear output to run」，**没有任何用例输出**，
  // 看起来像「Playwright 起不来」而不是「两个工具抢同一个目录」。
  // 因此把 Playwright 的产物收进独立子目录：只清自己的，不碰真机的 profile。
  outputDir: 'test-results/e2e',
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
    baseURL: BASE_URL,
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
      // 注意：testMatch 里**只能列真实存在的 spec**。cycle-110 清理时移除了
      // `conversation-remote-web-ui`——该文件已不存在（历史遗留），列在这里的后果是
      // 「以为有 21 个 spec 在跑，实际 20 个」，属 §2.20 那类「套件比你以为的小」的静默缺口。
      testMatch: /^.*(user-journey|plugin-install|search-and-analysis|realtime|filter-and-export|view-modes|focus-mode|chaos|integration-and-lifecycle|diff-and-integration|keyboard-shortcuts|i18n|v020-features|view-layers|micro-views|resource-exhaustion|local-repos|graph-browsing|on-demand-loading|conditional-requests|keyword-query)\.spec\.ts$/,
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
    // 第一段是端口身份守卫（见文件头三道说明与 `tests/e2e/port-identity.mjs`）：
    // 它只在 Playwright 决定「自己起服务」时执行，正好覆盖「端口被非 dev-server 占用」这一支。
    command: 'node tests/e2e/preflight-dev-server.mjs && pnpm run build:client && pnpm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
  },
});
