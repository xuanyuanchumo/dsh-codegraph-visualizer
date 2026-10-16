# cycle-97 测试报告（补记）

> 补记时间：2026-10-16 14:40 · 周期末实测值（来自当时工作区验证记录）

## 1. 静态层

| 检查 | 结果 |
|---|---|
| typecheck（client + host） | ✅ 0 错 |
| build | ✅ dist/client.js + dist/host.js |

## 2. vitest

**Test Files 30 passed (30) / Tests 368 passed (368)**（cycle-96 末 27/315 → +3 文件 +53 用例）。

新增文件与用例：

| 文件 | 用例 | 覆盖 |
|---|---|---|
| tests/unit/skillRegistration.test.ts（新） | 12 | frontmatter 解析 / ctx.skills.register 输入形状 / 静态 inject 四成员 |
| tests/unit/invocationFeed.test.ts（新） | 19 | isAnicInvocation 过滤 / 环回缓冲（配对/error/drop-oldest/重放/终态幂等/orphan/副本）/ previewOf / attachInvocationFeed / 路由 |
| tests/unit/invocationsRender.test.ts（新） | 8 | 空态 / 调用中脉冲 / 完成 / 截断 |
| tests/contract/dshConformance.test.ts（扩） | — | inject 四成员契约 |
| tests/unit/snapshotRoute.test.ts（扩） | — | ALL_ROUTES 增量 |

## 3. 三层汇总

validate（DSH 规范符合性门）PASS · vitest PASS · smoke（stub 宿主）ALL PASS。

## 4. 真模型实测（本周期最重要的一次「测试」）

新建免费模型测试对话，实测发现：

1. **P0-A**：`content.some is not a function` —— anic_evaluate / anic_status / anic_skill 三工具全坏（render 返回裸字符串，契约要求 ContentBlock[]）。
2. **P0-B**：模型回复含 anic_status 结果摘要，但 /anic/api/invocations/live total=0（事件通道未接通，当时未定位根因）。

判别矩阵（m02105 遗产延续）：多提供商对照确认非提供商侧故障；禁用插件对照确认非宿主线缆问题——缺陷在插件内，如实记录并转入 cycle-98 修复。

## 5. 结论

静态层全绿；两个 P0 均为「stub 宿主不可见」类延迟爆炸缺陷，由真模型实测暴露——这正是引入真模型验证环节的价值。G2 测试收敛门 PASS。
