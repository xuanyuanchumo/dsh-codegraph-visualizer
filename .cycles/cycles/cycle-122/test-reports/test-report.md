# 测试报告（cycle-122 · XJ-11 消费端收口）

## 2. 汇总（终态全量）

| 指标 | 数值 |
|---|---|
| 通过 | 6353 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 文件数 | 252（无新增测试文件；+8 例分布在 tools.test.ts 与 StatusBar.test.tsx） |
| 耗时 | ~89s（全量轮） |

## 1. 执行环境

| 项 | 值 |
|---|---|
| 执行时点 | 2026-10-31 17:17–17:38（Asia/Shanghai） |
| 执行者 | AI-L4（Team Lead 直接执行） |
| 基线 | cycle-121 / commit `8791525`（252 文件 / 6,345 用例） |
| 本轮终值 | **252 文件 / 6,353 用例 / 0 失败** |

## 3. 新增测试（8 例）

| 文件 | 用例 | 断言要点 |
|---|---|---|
| tests/unit/tools.test.ts（+3，XJ-11 组） | ①全量重建 ⇒ `metadata.xuanji` 缺席（`'xuanji' in metadata === false`，undefined ≠ skipped 的显式区分）；②增量分支 skipped ⇒ `applied:false` 且**不带 addedPaths**（引擎没跑，0 是假量化）、无降级不带 degradedRules 键（空数组冒充「体检过」防线）；③applied=true ⇒ `addedPaths` 为 number（引擎真实产出） |
| tests/component/StatusBar.test.tsx（+5，xuanji signal badge 组） | ①applied=true 显示「增量 +42」；②信号 null/缺省不渲染（不伪造观测）；③applied=false 不渲染；④degradedRules 非空 ⇒ `cg-xuanji-degraded` 染色 + title 含规则名；⑤invariantViolations 同样触发染色 |

## 4. 用例设计要点（变异敏感性）

| 设计 | 防的缺陷形态 |
|---|---|
| `'xuanji' in metadata` 键存在性断言（非 toEqual） | 「值断言无法区分键缺失与键为空」（cycle-89 家族） |
| skipped 不带 addedPaths | 假量化：引擎没跑却报 +0，用户误以为引擎跑过且无产出 |
| 无降级不带 degradedRules 键 | 空数组冒充「体检过」——本仓反复出现的形态（DELTA_SKIPPED 注释原文） |
| applied=false 不渲染徽标 | UI 伪造观测：skipped 也显示「增量 +0」 |
| 染色断言绑定 `.closest('.cg-status-xuanji').className` | DOM 存在性断言对颜色/类名盲（cycle-90 家族：死样式对行为测试不可见） |
| title 属性含规则名 | 白盒透明确认：降级的**是什么规则**必须可见，不只「有降级」 |

## 5. 过程缺陷记录

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| P-1 | XJ-11 applied=true 用例首跑红（applied=false） | 测试场景设计错误：首次 `executeGraphData` 走「无缓存基线」分支会 `invalidate` 预装 adapter（**这是正确行为**——没有基线不能混两版图） | 修正时序：先建 graphCache 基线 → 再预装 adapter → 第三次调用才满足「有基线 + 已装载」；时序约束写进用例注释 |
| P-2 | loadGraph fixture 带 repoId 等字段 TS2353 | `SyncGraphInput.metadata` 只声明 `timestamp?`（窄化契约） | fixture 收窄为 `{ timestamp: 0 }` |
| P-3 | executeGraphData 返回 `JsonValue`（toJsonValue 包装）| 工具出口统一 JSON 化 | 测试侧 `as unknown as GraphData` 收窄（与既有口径一致） |

## 6. 结论

+8 例全绿、既有 6,345 例零回归（含指纹/etag/graphFingerprint 30 例——xuanji 天然豁免的实证）。三层贯通链（引擎→工具面→SSE→store→UI）全链 typecheck 闭合。门禁证据齐备。
