# 测试报告（cycle-107 · 璇玑图算法库落地与宿主集成）

> 执行时点：2026-10-27 · 执行者：AI-L4（lead + 3 teammate 并行）
> 环境：Windows / Node v24.14.0 / pnpm 9.12.0 / vitest 3.2.7

## §1 执行摘要

本轮把 `docs/research/` 的四份璇玑图文档落地为**零宿主依赖算法库** `src/xuanji/`
（15 个源文件、215 个库用例），并通过适配层接入 4 条真实宿主路径（CycleDFS 复用、
RuleEngine 早退、AdjacencyCache 增量、`graph_path_enumerate` 工具）。同时落地两份
优化方案的 P0–P2：Booth 环去重、多重边键、缓存增量 patch、规则共享遍历、输出敏感
可达（SCC + bitset）。

**结论：全绿。** 219 文件 / 5839 用例通过，0 失败；typecheck 三配置 0 错误；
lint 0 warning / 0 error（272 files）；coverage 四维均 ≥ 86；build / perf-gate /
hygiene 全过。

## §2 汇总

| 项 | 数值 |
|---|---|
| 测试文件 | **219 passed**（基线 208，+11） |
| 测试用例 | **5839 passed**（基线 5555，+284） |
| 通过 | 5839 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 耗时 | 94.79s（一次全量） |
| typecheck（host+client+test） | exit 0 |
| lint（oxlint src/） | Found 0 warnings and 0 errors（272 files / 103 rules） |
| coverage | All files：语句 94.14 / 分支 90.86 / 函数 95.05 / 行 94.14（阈值 86） |
| build | exit 0（client bundle 2.55MB / 3MB；host 272KB / 512KB；worker 1,528,568 B） |
| perf-gate | 3/3 PASS（client / host / test count 5838 vs 5347 baseline） |
| hygiene | exit 0（19 artefacts / 7 roots；payload 12.25 MB） |

## §3 本轮新增/改动用例

| 文件 | 类型 | 覆盖契约 |
|---|---|---|
| `tests/unit/xuanji/index.test.ts` | 新增 19 | 起点/终点×长度桶、hash 去重、仅返回 live、计数幂等、sample/clear/revive |
| `tests/unit/xuanji/incremental.test.ts` | 新增 17 | **200 组 C3 oracle**（独立全量枚举器逐哈希对照）、O(k) 删除、lMin=2/closed 回归、5 条 workBudget 降级 |
| `tests/unit/xuanji/rebalance.test.ts` | 新增 11 | 1-hop 局部性、幂等、邻域外隔离、多重边恢复 |
| `tests/unit/xuanji/query.test.ts` | 新增 40 | 枚举穷举对照、长度边界、closed/simple/canonical、maxPaths 精确截断、回退契约、永不 stale |
| `tests/unit/xuanji/registry.test.ts` | 新增 22 | 校验拒注册、版本热替换、deprecated/GC、索引按 name 隔离 |
| `tests/unit/xuanji/invariants.test.ts` | 新增 20 | I1–I5 阈值边界与 detail |
| `tests/unit/xuanji/nfa.test.ts` | 新增 15 | 长度维度状态数、∞/非整数抛错 |
| `tests/unit/xuanji/publicApi.test.ts` | 新增 49 | 公共 API 逐符号 + 类型面 |
| `tests/unit/xuanji/libraryBoundary.test.ts` | 新增 4 | 导入自包含 + 反向自检 + 非空扫描 + 宿主词汇禁止 |
| `tests/unit/xuanjiAdapter.test.ts` | 新增 19 | GraphData⇄GraphSpace 映射、路径/环/可达读法、**宿主级 C3**（applyDelta vs 重新 loadGraph） |
| `tests/unit/batchReach.test.ts` | 新增 23 | 300 组精确 vs 旧值对照、601 链、SCC 环、菱形去重、patch/rebuild |
| `tests/unit/AdjacencyCache.test.ts` | +11（17→28） | 多重边双键、addEdge/removeEdge patch、version 单调、patch 与 rebuild 20 组随机一致 |
| `tests/unit/CycleDFS.test.ts` | +10（15→25） | **引用相等**证明库复用、hasCycle 与 detectCyclesDFS 200 组一致 |
| `tests/unit/RuleEngine.test.ts` | +9（46→55） | 共享邻接只建一次、无环图 detectCyclesDFS 0 次、finally 清空 |
| `tests/unit/CoreFunctionAnalyzer.test.ts` | +6（26→32） | influenceReach 精确值、legacy 对照 |
| `tests/unit/tools.test.ts` | +6（116→122） | `graph_path_enumerate` 全链路（路径/过滤/夹紧/截断/渲染/缺端点） |
| `tests/unit/plugin.test.ts` | +1（18→19） | **注册契约**：入口 `apply()` 注册的集合 == `createGraphTools` 返回的集合（去重、含 `graph_path_enumerate`）；该用例抓出了「工厂返回但入口漏注册」的死工具 |
| `tests/unit/chaos.test.ts` | 0（超时预算） | 动态 import graphStore 的用例给 30s 预算（见 §6） |

## §4 核心正确性证据

### (a) C3 增量完备性：200 组随机 oracle

`incremental.test.ts` 内嵌**独立**全量枚举器（DFS + `isLegalPath`），流程：
原图全量物化 indexA → 加一条随机边 → `onEdgeAdded` → 新图从零全量物化 indexB →
断言 live 哈希集合逐项相等。随机维度：节点 2–4、边 0–6、边类型 2–3、closed /
simple / start(role) / nodeConstraint(tags) / normalize(none|reverse|canonical) /
lMin 0–2 / lMax ≤ 3。防退化断言：nonEmpty > 40、grown > 30、newEntries > 50、
degradedCases = 0。

### (b) 宿主级 C3：applyDelta vs 重新 loadGraph

`xuanjiAdapter.test.ts` 对注册了 `cycles` 规则的适配层执行 `applyDelta`（加边/删边），
与「用新 GraphData 重新 `loadGraph` 再全量枚举」逐哈希相等。这是「改一字只重读
经过该字的诗」在真实宿主数据结构上的证据。

### (c) 库复用不可伪装

`CycleDFS.test.ts` 断言 `expect(boothMinimalRotation).toBe(libBoothMinimalRotation)`、
`expect(hasCycle).toBe(hasCycleInAdjacency)` —— 复制一份实现会让行为断言全绿，但引用
相等会红。

### (d) 库边界

`libraryBoundary.test.ts` 扫描 `src/xuanji` 全部 15 个源文件的导入说明符：
0 条越界；反向自检喂 3 条人造样本必须恰好报出 2 条违规；扫描文件数 ≥ 10；
库内不得出现 `GraphNode`/`GraphEdge`/`GraphData`/`GraphDelta`/`RepoId`。

### (e) 精确可达 vs 旧截断

`batchReach.test.ts`：300 组随机小图上「精确值 < 500 时与旧 `bfsReachCount` 逐节点
相等」；601 长链精确 600 / 旧 499；星图旧值同样正确；`AdjacencyCache` 的 patch 与
rebuild 在 20 组随机边集上逐边一致（含有向邻接项的移除条件与反向残留检查）。

### (f) workBudget 降级

`onEdgeAdded(..., { workBudget: 2 })` 触发 `index.clear()`：counters 归零、返回 []、
不抛异常、`wasLastIncrementalDegraded()` 为 true 且下一次调用重置。

## §5 门禁输出（关键行）

```
Test Files  219 passed (219)
     Tests  5839 passed (5839)

# typecheck: tsc -p tsconfig.host.json && -p tsconfig.client.json && -p tsconfig.test.json → exit 0
# lint:     Found 0 warnings and 0 errors. Finished in 45ms on 272 files with 103 rules
# coverage: All files | 94.14 | 90.86 | 95.05 | 94.14 |   coverage_exit=0
# build:    [build-client] Done.  layout worker bytes: 1528568   BUILD_EXIT=0
# perf-gate: client 2.55MB/3MB; host 272KB/512KB; test count 5838/5347 → All performance gates passed
# hygiene:  every published artefact is reachable from a declared reader — 19 artefact(s) / 7 root(s)
```

## §6 已知波动与处置

- **`chaos.test.ts` 动态 import 超时**：首轮全量（219 文件并行、transform 78s）中
  `should recover from error state when new data arrives` 越过全局 10s；单跑 ~1.2–1.9s、
  后续两次全量均绿。根因是「动态 import 把 store 模块 + slices 的 transform 成本记在
  用例内」而非死锁。处置：该用例单独 30s 预算并写明理由（不是调大全局超时，
  也不是跳过断言）。
- **`perf-gate` 内部 vitest 曾报告非零退出**：随后独立
  `npx vitest run --reporter=json --outputFile=...` 复跑得 `exit=0 / 5838 passed / 0 failed`，
  判定为同一 transform 竞争下的瞬时超时；perf-gate 的设计本身只测量用例规模
  （注释在 `scripts/perf-gate.mjs:97-99`），故未改门禁逻辑。

## §7 未覆盖/流转

- `src/xuanji/core/path-rule.ts` 的组合代数（并/交/拼接/迭代/差）与 `pathConstraint`
  闭包是库内覆盖率最低点（约 45% 行覆盖）；组合的代数是**纯函数**，行为已由
  registry/query 侧用例间接覆盖，但独立组合用例尚未补齐 → 登记为下一轮候选。
- 真机 Chrome DevTools 验证未做：本插件 UI 零变更，新增能力是 host tool
  `graph_path_enumerate`，由 `tools.test.ts` 以真实 `createGraphTools` + 双 adapter mock
  覆盖（122 例）。
