import { defineConfig } from 'vitest/config';

/**
 * dsh-anic 测试配置。vitest 本体复用父工程 node_modules（dsh-anic 是独立插件工程，
 * 不自带测试依赖——经 scripts/run-vitest.mjs 以父工程 vitest.mjs + 本 config 运行）。
 *
 * 三层：
 *   tests/unit/       —— 纯函数与宿主路由单元（snapshotCore / snapshotRoute / apply）
 *   tests/contract/   —— DSH 规范契约守卫（源码形状 + 构建产物，含反向自检）
 *   scripts/offline-smoke.mjs —— 机制冒烟（stub 宿主，由 run-tests.mjs 编排）
 *   scripts/j0-probe.mjs      —— 真实宿主 E2E（需 start-dsh-test.mjs 环境，--live）
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // 隔离：每个文件独立 worker，宿主路由测试里改 process.cwd 互不影响
    pool: 'forks',
  },
});
