# 附录D：工具链依赖与算法选型基线

> 本附录为主流程 `docs/anchor/cycles/项目迭代驱动验证流程.md` 的**工具链版本治理与算法选型规范**
> 核心原则：版本基线以仓库锁定配置为唯一权威来源，文档不硬编码小版本号；引入新能力优先复用维护良好的成熟库，自研必须给出选型对照记录。

## 1. 动态基线原则与权威配置文件清单

### 1.1 权威来源（Single Source of Truth）

| 基线域 | 权威配置文件 | 文档引用规则 |
|--------|-------------|-------------|
| Node/pnpm 版本 | 根 `package.json` 的 `engines` 与 `packageManager` | 写约束区间（如 `^22.19 \|\| >=24`），不写具体补丁版 |
| TypeScript 语言档 | `tsconfig.base.json`（target/lib/module/strict 开关） | 引用开关名，不复制数值 |
| TS 依赖版本 | 各 `package.json` + `pnpm-lock.yaml` | 写主版本线（如 `Vitest 3.x`），不写小版本 |
| 覆盖率门限 | `vitest.config.ts` 的 `coverage.thresholds` | 直接引用数值并注明来源文件 |
| 构建参数 | 根 `package.json` 的 `build` 脚本 | 引用脚本名 |

> 任何循环中发现「文档描述 ≠ 配置文件事实」时，以配置文件为准修复文档，并按附录 A G0「事实基座抽验」登记。

### 1.2 每循环依赖健康检查（例行项）

进入每个循环的 Phase 0 时执行并登记结论于循环总规划：

```text
1. pnpm outdated            # workspace 依赖落后情况
2. pnpm audit               # 安全通告
3. 上游插件版本检查：确认 `dsh-codegraph` / `dsh-tool-lens` 版本兼容性
```

登记格式：`{依赖名}: 当前 {主版本线} → 最新 {主版本线}；结论 {本循环升级 / 立项 upgrade-* 子规划 / 观望(理由)}`。

## 2. 依赖升级评估流程

```text
信号识别 → 影响评估 → 独立子规划 → 全量回归 → 基线刷新
```

1. **信号识别**：安全通告（audit 命中）、主线大版本发布、当前版本进入 EOL、新版本删除本项目依赖的能力。
2. **影响评估**：breaking changes 清单、受影响包（UI / Host / 内核）、对 Wasm 产物体积的影响估计。
3. **独立子规划**：命名 `cycle-{N}-subplan-complex-upgrade-{name}`；**主版本升级不得与其他 feature 混入同一子规划**；同主版本内的 minor/patch 升级可与常规任务合并。
4. **全量回归**：`pnpm run test && pnpm run typecheck && pnpm run build`
5. **基线刷新**：更新 lockfile 与本文档 §3/§4 中受影响的主版本线表述。

## 3. TypeScript 工具链基线

| 项 | 基线 | 说明 |
|----|------|------|
| 语言标准 | ES2024 target、NodeNext module、`strict` 全家桶 | 对齐 `tsconfig.base.json`；含 `noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`isolatedModules` |
| 运行时 | Node `^22.19 \|\| >=24`，ESM only（`"type": "module"`） | 跨包引用用包名；本地相对导入带 `.ts` 扩展名 |
| 包管理 | pnpm（版本以根 package.json `packageManager` 为准） | workspace 协议 `workspace:*` |
| 类型检查 | `pnpm run typecheck`（tsc project references 双面：host + client） | 零错误才可过 G3 |
| Lint | oxlint（`pnpm run lint`）；克隆检测 `pnpm run duplication` | 不引入第二套 linter |
| 测试 | Vitest 3.x + @vitest/coverage-v8；覆盖率门限以 `vitest.config.ts` thresholds 为准 | 行/函数/语句 ≥80%、分支 ≥65% |
| E2E | Playwright（`pnpm run test:e2e`） | 用例位于 `tests/e2e/` |
| 打包/发布卫生 | tsdown 构建、publint + NodeNext 消费检查（`pnpm run hygiene`） | Release 前置 |

## 4. 上游依赖治理

本插件不维护独立的 Rust-Wasm 内核，图谱构建与代码解析能力由上游插件 `dsh-codegraph` 和 `dsh-tool-lens` 提供。

### 4.1 上游插件版本锁定

| 上游插件 | 版本锁定方式 | 治理要求 |
|---------|------------|---------|
| `dsh-codegraph` | `package.json` `dependencies` 字段 | 适配器接口版本与上游工具版本对齐；API 变动时通过适配器模式隔离 |
| `dsh-tool-lens` | `package.json` `dependencies` 字段（可选依赖） | 同上；不可用时降级到 CodeGraph 数据源 |

### 4.2 适配器版本兼容性

- 每次依赖健康检查（§1.2）须复查上游插件 API 兼容性
- 上游 API 变动时，适配器层优先通过版本条件分支兼容，而非立即升级
- 适配器接口变更须在子规划中记录并更新契约测试

## 5. 数据结构与算法选型规范

### 5.1 造轮子禁令（P16 具体化）

引入任何新解析/搜索/图谱/缓存/布局能力前，必须先完成成熟库检索并在子规划中记录选型对照。**仅当同时满足以下条件之一才允许自研**：

1. 无维护良好的等价库；
2. 成熟库导致运行时内存显著劣化（相对自研 > 30%）且超出本循环内存预算。

### 5.2 选型决策表

> 库名仅写定位不写版本，「以当次循环 §1.2 检索结果为准」。结论与 `docs/增强方案.md` §7 对齐；分歧点在表末登记。

| 场景 | 现状（本插件） | 首选成熟方案 | 次选 | 自研红线 |
|------|----------------|-------------|------|---------|
| 代码解析 | **上游完成**（`dsh-codegraph` / `dsh-tool-lens`） | 不重复造轮子 | — | — |
| AST 构建与遍历 | **上游完成**（`dsh-codegraph` / `dsh-tool-lens`） | 不重复造轮子 | — | — |
| 图谱数据结构 | **上游完成**（`dsh-codegraph` / `dsh-tool-lens`） | 不重复造轮子 | — | — |
| 符号解析与 xref | **上游完成**（`dsh-codegraph` / `dsh-tool-lens`） | 不重复造轮子 | — | — |
| 中文分词 | **上游完成**（`dsh-codegraph` / `dsh-tool-lens`） | 不重复造轮子 | — | — |
| XML/HTML 解析（TS 侧） | fast-xml-parser、node-html-parser | 维持现状（更易用/更轻量） | quick-xml / scraper | — |
| 图谱数据检索 | SQLite FTS5（`node:sqlite`，含不可用降级保护） | 维持 FTS5（足够） | — | — |
| 图谱内容搜索 | 上游倒排索引 + Host 层 FTS5 双轨 | 维持双轨各司其职 | — | — |
| RSS/Atom 解析 | 上游工具输出 | 不重复造轮子 | — | — |
| HTML 清洗（防 XSS） | TS 侧转义 | sanitize-html 或 DOMPurify | 手写白名单清洗（须安全审查） | — |
| 缓存淘汰 | Host 内存 LRU + SQLite 持久化 | lru crate 落地 L1（可选） | 手写 LRU（须附复杂度说明） | 容量恒定且 ≤ 2 种策略 |
| 内容去重 | 未实现 | simhash/minhash 类成熟实现评估 | URL 规范化去重先行 | — |
| 图谱布局算法 | Cytoscape.js 内置布局（force-directed / hierarchical / circle / grid） | dagre / d3-force（Wasm 可用） | 维持 Cytoscape 内置 | 仅小规模图谱 |

**参考实现借鉴（减少造轮子，增强方案 §7.2）**：图谱可视化参考 CodeSee / SourceGraph；代码搜索参考 VS Code 搜索；依赖分析参考 Sourcetrail；标注系统参考 Hypothesis——借鉴机制设计而非直接引入依赖。

**与 docs/ 的分歧登记**：

| 分歧点 | 增强方案 §7.1 表述 | 仓库实际 | 处理 |
|--------|-------------------|---------|------|
| 全文搜索适用域 | 「全文搜索 = SQLite FTS5」 | 双轨并存：Host 层 FTS5（仓库元数据检索）+ 上游工具倒排索引（代码正文检索） | 两轨各司其职，均维持；不合并 |
| HTML/XML 解析归属 | 按 TS 侧库（fast-xml-parser 等）描述 | 上游另有 Rust 侧 HTML 解析 | 各层独立评估，本插件仅用 TS 侧 |

### 5.3 复杂度预算声明模板

涉及数据转换/搜索/缓存/图谱的变更，子规划与测试报告须包含：

```text
- 关键路径：<函数/模块>
- 输入规模假设：<n 的含义与典型/最坏值>
- 时间复杂度：O(...)；空间复杂度：O(...)
- 基准数据：<Vitest 计时用例名称>
- 结论：在预算内 / 超预算 → 登记 E2/E5 评估问题
```

### 5.4 默认复杂度预算（关键路径）

| 关键路径 | 预算上限 |
|---------|---------|
| 上游数据获取（工具调用） | O(文件数)，单次调用 |
| 数据适配器转换 | O(节点数 + 边数)，单遍遍历 |
| 图谱数据去重 | O(节点数)，HashMap 均摊 |
| 倒排索引构建 | O(总词条数 × 平均词长) |
| 关键词查询 | O(命中词表合并)，禁全表扫描 |
| 图谱布局（Cytoscape.js） | O(节点数 log 节点数) 以内 |
| 缓存命中 | O(1) 均摊 |
