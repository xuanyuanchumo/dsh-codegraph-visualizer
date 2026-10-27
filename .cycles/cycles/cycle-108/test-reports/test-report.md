# 测试报告（cycle-108 · 规则组合代数收口 + 依赖环读法工具）

> 执行时点：2026-10-27 · 执行者：AI-L4
> 环境：Windows / Node v24.14.0 / pnpm 9.12.0 / vitest 3.2.7

## §1 执行摘要

本轮补上 cycle-107 披露的最大质量缺口——**规则组合代数没有独立用例**（`path-rule.ts`
组合分支行覆盖约 45%）。先写独立 oracle（文件内枚举全部 walk + `isLegalPath` 过滤，
集合运算断言），14 条用例（含 200 组随机图 × 随机规则）暴露并修复三处**静默漏路径**
的语义缺陷；同时把「闭合路径 + Booth 规范去重」做成新工具 `graph_cycles`，
并实测评估了优化方案 C（派生分析增量）——结论是收益不足、不做，理由与数字留档。

**结论：全绿。** 220 文件 / 5862 用例通过，0 失败；typecheck 0；lint 0；
coverage 94.44 / 90.82 / 95.35（`path-rule.ts` 行覆盖 45.56% → **95.85%**）；
build / perf-gate / hygiene 全过。

## §2 汇总

| 项 | 数值 |
|---|---|
| 测试文件 | **220 passed**（基线 219，+1） |
| 测试用例 | **5862 passed**（基线 5839，+23） |
| 通过 / 失败 / 错误 / 跳过 | 5862 / 0 / 0 / 0 |
| 耗时 | 75.80s（一次全量） |
| typecheck（host+client+test） | exit 0 |
| lint（oxlint src/） | 0 warnings / 0 errors（272 files / 103 rules） |
| coverage | All files：语句 94.44 / 分支 90.82 / 函数 95.35 / 行 94.44（阈值 86） |
| `src/xuanji/core/path-rule.ts` | 行覆盖 **95.85%**（cycle-107 为 45.56%） |
| build | exit 0（client 2,669,392 B = 2.55MB / 3MB；host 281,213 B / 512KB；worker 1,528,568 B） |
| perf-gate | 3/3 PASS（test count 5862 vs 5347 baseline） |
| hygiene | exit 0（19 artefacts / 7 roots） |

## §3 新增/改动用例

| 文件 | 用例 | 覆盖契约 |
|---|---|---|
| `tests/unit/xuanji/composition.test.ts`（新） | 14 | 并/交/拼接/迭代/差；长度区间不相交抛错；闭合∪开放与双 simple 闭环；跨段重复；200 组随机集合运算 |
| `tests/unit/tools.test.ts` | 133（+8） | `graph_cycles`：三角形规范去重、双环+自环、maxLength、limit 截断、边类型过滤、空图 null、渲染（有环/无环） |
| `tests/unit/plugin.test.ts` | 19 | 注册集合契约自动覆盖第 10 个工具（含 `graph_cycles`） |

## §4 三处被 oracle 抓出的语义缺陷（红→绿）

oracle 方式：文件内 `bruteLegalPaths` 枚举全部 walk（上界 lMax）后逐条 `isLegalPath`，
不使用被测 `enumerate`；断言用集合相等（同时暴露「漏」与「多」）。

| # | 缺陷 | 红的表现 | 修复 |
|---|---|---|---|
| 1 | 并集用 `closed` 同时承担判定与剪枝 | `closed` 为 OR → 开放路径被判定拒绝；为 AND → 闭合路径在 simple 剪枝处被当成重复节点 | 新增 `pruneClosed` 剪枝提示（缺省=closed），并集 `closed=false, pruneClosed=OR`；`isLegalPath` 的 simple 检查改按 `pruneClosed` 放行「末=首」 |
| 2 | 拼接把两侧 `nodeConstraint` 取交 | 桥接图 a(entry)→b(bridge)→c(mid) 的 `a>b>c` 结果为空（a 不满足 r2、c 不满足 r1） | 拼接不设 `nodeConstraint`，精确性由 `pathConstraint` 逐段判定 |
| 3 | 拼接切分循环 `k < nodes.length` | 后段为单节点（0 边、`lMin=0`）无切分点 | `k <= nodes.length`，并固定两个零边边界用例 |

配套：拼接 `simple=false`（简单性按段判定，跨段重复仍合法）。

## §5 `graph_cycles` 工具链路

- 工具 → `XuanjiAdapter.cycles` → 闭合规则 `enumerate` → Booth 规范化去重；
- 参数夹紧：`maxLength` 1–12（默认 6）、`limit` 1–500（默认 100）、`edgeTypes` 白名单；
- 空图返回 null；无环返回空数组 + 「No dependency cycles detected.」（与「查不到」区分）；
- 注册：`src/index.ts` 解构 + register + disposer；`plugin.test.ts` 的
  「注册集合 == 工厂返回集合」契约自动把它纳入。
- 行为证据：三角形只报 1 条（三个起点同一 Booth 等价类）；自环报 1 条长度 1；
  `limit=1` 且两环时 `total=1, truncated=true`。

## §6 门禁输出（关键行）

```
Test Files  220 passed (220)
     Tests  5862 passed (5862)

# coverage: All files | 94.44 | 90.82 | 95.35 | 94.44 |   COV_EXIT=0
#           path-rule.ts | 95.85 | 80.34 | 88.88 | 95.85 |
# build:    [build-client] Done.  layout worker bytes: 1528568   BUILD_EXIT=0
# perf-gate: host 275KB/512KB; test count 5862/5347 → All performance gates passed
# hygiene:  every published artefact is reachable from a declared reader
# typecheck / lint: exit 0 / Found 0 warnings and 0 errors.
```

## §7 未覆盖/流转

- 组合测试固定 `normalize: 'none'`；canonical/reverse 的旋转等价由 `query.test.ts` 覆盖，
  组合 × canonical 的交叉（例如并集两侧 normalize 不同时的代表元选择）尚未单测，
  已在 `path-rule.ts` 的 JSDoc 注明「组合取 r1.normalize」。
- 真机 Chrome DevTools 未跑：本轮 UI 零变更，新增能力是 host tool，由 tools/plugin 用例覆盖。
- Q4（依赖漏洞）/ Q7（既有复杂度热点）仍为 carry-over，未在本轮处理。
