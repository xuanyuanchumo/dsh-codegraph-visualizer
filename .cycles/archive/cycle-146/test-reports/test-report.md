# cycle-146 测试报告

## 1. 概要

| 项 | 值 |
|---|---|
| 循环 | cycle-146（Config schema + 诊断四态 + 可观测补口 + 图谱交互） |
| 日期 | 2026-11-07 |
| 执行者 | AI（L4 全自主） |
| 结论 | **PASS**（293 文件 / 7055 用例 0 失败 / typecheck 0 / lint 0/0 / build exit 0） |

## 2. 汇总

| 指标 | 数量 |
|---|---|
| 通过 | 7055 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 耗时 | 113.87s（全量 vitest） |

> 旅程覆盖：Legend 组件 6 用例（开面板即图例 → 点击切换 → 防呆 → 视觉状态）；
> HighlightController 流动动画 4 用例（启动/停止/换节点/空集）；全量回归 0 失败。
> 覆盖缺口：会话 cwd 归属 defer（§90.7）；流动动画的视觉流动性由真机旅程验证（E2E 豁免条件未触发）。

## 2.1 验证矩阵

| 验证项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` ×3（host/client/test） | **0 错误** |
| Lint | `pnpm run lint` | **0 warnings / 0 errors**（323 files / 103 rules） |
| 全量回归 | `pnpm run test` | **293 文件 / 7055 用例 0 失败**（基线 7041 + 14） |
| 构建 | `pnpm run build` | **成功**（client 2.84MB/3MB · host 503KB/512KB · worker 1528568B） |
| 性能棘轮 | `pnpm run perf-gate` | **3 项全 PASS** |

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| tests/unit/configSchemaContract.test.ts | 5 | CS-1 Standard Schema 接口 / CS-2 默认值单一真源 / CS-3 加载期拒绝 / CS-4 运行时防线兼容 / CS-5 schema 封闭性 |
| tests/unit/diagnosisContract.test.ts | 6 | DQ-1 disabled+聚合码首位 / DQ-2 degraded / DQ-3 ready≠零问题 / DQ-4 lens 通道对等 / DQ-5 AST 不救 disabled / DQ-6 通道序确定 |
| tests/unit/rateLimiterSnapshot.test.ts | 4 | RL-1 空快照 / RL-2 零观测者效应 / RL-3 过期桶不虚报 / RL-4 排序+配额标注 |
| tests/component/Legend.test.tsx | 6 | LG-1/2 双向切换 / LG-3/4 最后类型防呆 / LG-5 视觉状态+非空自证 / LG-6 runtime 零行 |
| tests/unit/HighlightController.test.ts（追加） | 4 | CFA-1 动画启动 / CFA-2 清空停句柄 / CFA-3 换节点先停 / CFA-4 空集合无句柄 |

## 3. 新增测试资产（14 用例）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | tsc --noEmit ×3（host/client/test） | 0/0/0 错误 |
| lint | oxlint src/ | 0 warnings / 0 errors @323 files |
| 单元+组件 | pnpm run test | **293 文件 / 7055 用例全绿**（基线 7041 → 7055，+14） |
| 构建 | pnpm run build | exit 0（client 2.84MB/3MB · host 503KB/512KB · worker 1528568B） |
| 性能棘轮 | pnpm run perf-gate | 3 项全 PASS |

## 4. 失败与修复记录

| 轮次 | 症状 | 根因 | 处置 |
|---|---|---|---|
| 1 | HighlightController 4 用例红 `edges.empty is not a function` | mock 集合缺 `empty()/animate()/stop()`（真实 cytoscape 契约） | mock 补齐三方法（fixture 转录真实契约） |
| 2 | CFA-2 红 `stop not called` | 测试设计错误：空集合本无动画句柄 | 重写为「先建句柄再清空」真实序列 |
| 3 | routes.test /status 断言红 | additive 新字段 `diagnosis` | 断言按 additive 契约更新（形状 objectContaining） |

## 5. 变异探针（抽样）

- M-T146-2：把 `diagnosePrerequisiteStatus` 的 `!hasGraph ? 'disabled'` 分支改为恒 `'ready'` ⇒ DQ-1/DQ-5 红，恢复全绿（四态分类器承重确认）。
- M-T146-4：删除 Legend `next.size <= 1` 防呆早退 ⇒ LG-3/LG-4 红，恢复全绿（防呆承重确认）。
