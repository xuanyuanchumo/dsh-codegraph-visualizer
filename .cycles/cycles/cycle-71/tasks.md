# Cycle-71 任务清单

## P0 任务（必须修复）

| ID | 任务 | 复杂度 | 验证方法 |
|----|------|--------|----------|
| T01 | Fix HostVersionDetector unknown 降级 — `generation: 'gen2'` → `'unknown'` | 低 | 单元测试 |
| T02 | Install @testing-library/jest-dom + setup file + vitest config | 低 | 构建验证 |
| T03 | Replace toBeTruthy with semantic assertions in 17 component test files | 中 | 测试通过 |

## P1 任务（高优先级）

| ID | 任务 | 复杂度 | 验证方法 |
|----|------|--------|----------|
| T04 | Add try-catch error handling to 6 dataRoutes handlers | 中 | 单元测试 |
| T05 | Add destroyed flag for background async operations | 中 | 单元测试 |
| T06 | Fix useGraphActions to use useShallow (merge 27 subscriptions) | 低 | 单元测试 |
| T07 | Fix security: resolveDbPath validation + tree-sitter route path | 中 | 单元测试 |
| T08 | Add gen3 mapping to ApiCompatLayer | 低 | 单元测试 |
| T09 | Fix resource-exhaustion.spec.ts test.skip() + expand view-modes.spec.ts | 中 | E2E 测试 |

## P2 任务（中优先级）

| ID | 任务 | 复杂度 | 验证方法 |
|----|------|--------|----------|
| T10 | Accessibility: ContextMenu focus + cg-collapse-fab aria-expanded | 低 | 组件测试 |