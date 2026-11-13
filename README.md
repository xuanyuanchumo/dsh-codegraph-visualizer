# DSH CodeGraph Visualizer

> DeepSeek Harness (DSH) 代码图谱可视化插件 — 将 `dsh-codegraph` 与 `dsh-tool-lens` 数据源聚合为交互式代码关系图谱

[![CI](https://github.com/xuanyuanchumo/dsh-codegraph-visualizer/actions/workflows/ci.yml/badge.svg)](https://github.com/xuanyuanchumo/dsh-codegraph-visualizer/actions/workflows/ci.yml)
[![Release](https://github.com/xuanyuanchumo/dsh-codegraph-visualizer/actions/workflows/release.yml/badge.svg)](https://github.com/xuanyuanchumo/dsh-codegraph-visualizer/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-orange)](https://pnpm.io/)

## 概述

DSH CodeGraph Visualizer 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 生态插件，填补了代码关系图谱可视化领域的空白。它将 `dsh-codegraph`（CodeGraph CLI 封装工具）和 `dsh-tool-lens`（AST 代码图谱与拓扑分析）两个数据源的输出聚合、转换，并通过 [Cytoscape.js](https://cytoscape.org/) 渲染为交互式代码关系图谱面板，嵌入 DSH Web UI 侧边栏。

### 核心能力

- **多数据源融合** — 同时接入 `dsh-codegraph` 与 `dsh-tool-lens`，自动合并去重
- **渐进式层级聚合** — 渐进式聚类 + 增量聚类 + Louvain 社区检测
- **7 种布局引擎** — Cose（力导向）、fCose（改进力导向）、Dagre（层次）、Circle（环形）、Grid（网格）、Radial（辐射）、Tree（树形）
- **交互式分析** — 符号搜索、调用链追踪、循环依赖检测、影响分析、继承层次
- **交互式图例** — 点击图例行切换节点/边类型可见性（v0.3.0）
- **调用链流动动画** — 高亮调用链的边以虚线流动呈现数据流向（v0.3.0）
- **实时增量更新** — 文件监听 + 事件驱动，代码变更后图谱自动刷新
- **导出能力** — PNG / SVG / JSON / Mermaid 四格式导出
- **图谱管理面板** — 图指标（密度/聚类/PageRank/介数）、索引覆盖范围、限流观测、诊断四态（ready/degraded/disabled）+ 修复指引问题码
- **可观测性数据面** — 管线耗时占比、缓存命中率、ETag 决策分布、AST 预算用量、限流白盒快照
- **声明式配置** — Schemastery `Config` schema 导出，宿主设置 UI 可编辑、加载期校验（v0.3.0）
- **跨项目隔离** — 按 workspace 隔离图谱数据与缓存，多工作区切换互不污染
- **中英双语 i18n** — 完整国际化支持
- **主题切换** — 深色/浅色主题，自动适配 DSH 环境变量

## 安装

### 前置条件

- Node.js >= 22.19 或 >= 24
- pnpm >= 9
- DSH Web 环境（`dsh web`）

### 通过 DSH 插件管理安装（推荐）

```bash
# 安装插件（两种方式均可）
dsh plugin --profile web add github:xuanyuanchumo/dsh-codegraph-visualizer
dsh plugin --profile web add xuanyuanchumo/dsh-codegraph-visualizer

# 卸载插件
dsh plugin --profile web remove dsh-codegraph-visualizer
```

安装完成后启动 DSH Web 即可在侧边栏看到 "Code Graph" 标签页：

```bash
dsh web
# → http://localhost:3080，点击侧边栏 "Code Graph" 标签页
```

### 从源码构建（开发者）

```bash
git clone https://github.com/xuanyuanchumo/dsh-codegraph-visualizer.git
cd dsh-codegraph-visualizer
pnpm install
pnpm run build

# 将构建产物安装到 DSH
dsh plugin --profile web add /path/to/dsh-codegraph-visualizer
```

## 快速开始

### 开发模式

```bash
# 启动自包含的 dev server（模拟 DSH Web Shell + 模拟数据）
pnpm run dev
# → http://localhost:3080
```

### 运行测试

```bash
pnpm run test           # 单元 + 组件（5,900+ 用例，以实跑为准）
pnpm run test:e2e       # E2E（需先启动 dev server）
pnpm run typecheck      # 三面类型检查（host / client / test）
pnpm run lint           # oxlint
```

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     DSH Web UI Shell                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              CodeGraph Visualizer Plugin              │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│  │  │  Host Layer │  │  Data Layer  │  │ Client Layer│  │  │
│  │  │             │  │              │  │             │  │  │
│  │  │ • routes    │  │ • CodeGraph  │  │ • GraphPanel│  │  │
│  │  │ • watcher   │  │   Adapter    │  │ • Toolbar   │  │  │
│  │  │ • config    │  │ • LensAdapter│  │ • Cytoscape │  │  │
│  │  │ • security  │  │ • GraphData  │  │   Renderer  │  │  │
│  │  │ • prereqs   │  │   Merger     │  │ • Store     │  │  │
│  │  │             │  │              │  │ • i18n      │  │  │
│  │  └─────────────┘  └──────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/
├── index.ts                  # Host 端插件入口（re-export 聚合）
├── tools.ts                  # 11 个工具：graph_status/data/symbol/impact/path_find/path_enumerate/cycles/query/health/rules_check/focus
├── types/                    # Branded 类型、GraphData、事件声明合并
├── adapters/                 # 数据源适配器
│   ├── CodeGraphAdapter.ts   #   dsh-codegraph 数据源
│   ├── LensAdapter.ts        #   dsh-tool-lens 数据源
│   ├── DependencyAdapter.ts  #   依赖图谱数据源
│   ├── TreeSitterAdapter.ts  #   TreeSitter AST 解析适配器
│   └── IAdapter.ts           #   适配器接口定义
├── merger/
│   ├── GraphDataMerger.ts    # 多数据源融合器（去重 + 合并）
│   └── DiffEngine.ts         # 图谱差异引擎
├── graphUtils.ts             # 图谱工具函数
├── host/                     # Host 端模块
│   ├── config.ts             #   配置定义与校验
│   ├── routes.ts             #   HTTP 路由注册（19 条）
│   ├── routes/               #   六个域分区路由文件
│   ├── compat/               #   多代适配层（ApiCompatLayer/FeatureFlags/能力探针/版本探测/快照防缩水）
│   ├── watcher.ts            #   文件监听与事件监听
│   ├── incrementalUpdate.ts  #   文件级增量 diff 更新层
│   ├── security.ts           #   路径安全校验
│   ├── prerequisites.ts      #   前置条件检测
│   ├── McpServer.ts          #   MCP 协议服务器
│   ├── HttpHelpers.ts        #   HTTP 辅助函数
│   ├── RateLimiter.ts        #   速率限制器
│   └── cli.ts                #   CLI 工具
├── client/                   # Client 端模块（浏览器渲染）
│   ├── index.ts              #   Client 端插件入口
│   ├── GraphPanel.tsx        #   主面板 UI 组件
│   ├── api/                  #   HTTP API helpers
│   ├── components/           #   UI 组件（Toolbar, SearchBar, ImportPanel, ...）
│   ├── renderer/             #   渲染引擎
│   │   ├── CytoscapeRenderer.ts  # Cytoscape.js 渲染器
│   │   ├── IRenderer.ts      #     渲染器接口
│   │   ├── LayoutController.ts   # 布局控制器
│   │   ├── VirtualViewportController.ts # 虚拟视口控制器
│   │   ├── OverlapRemover.ts #     碰撞检测与重叠消除
│   │   ├── QuadTree.ts       #     四叉树空间索引
│   │   ├── AdjacencyCache.ts #     邻接缓存
│   │   └── styles/           #     主题样式
│   ├── store/                #   状态管理
│   │   ├── graphStore.ts     #     Zustand 全局状态
│   │   └── cluster/          #     聚类策略模块
│   │       ├── types.ts      #       ClusterLevel/ClusterNode/ClusterEdge
│   │       ├── index.ts      #       策略注册表
│   │       ├── progressiveCluster.ts  # 渐进式聚类
│   │       ├── incrementalCluster.ts  # 增量聚类
│   │       ├── louvainDetection.ts    # Louvain 社区检测
│   │       ├── communityDetection.ts  # 社区检测辅助
│   │       ├── ProgressiveClusterStrategy.ts # 渐进式策略
│   │       └── ClusterStrategy.ts     # 策略接口
│   ├── diagram/              #   微视图图表组装器
│   │   ├── CFGAssembler.ts   #     控制流图汇编器
│   │   ├── FlowchartAssembler.ts  # 流程图汇编器
│   │   ├── SequenceAssembler.ts   # 时序图汇编器
│   │   └── HierarchicalAssembler.ts # 层次图汇编器
│   ├── cache/                #   图谱缓存
│   ├── history/              #   历史管理
│   ├── i18n/                 #   国际化（中/英）
│   ├── hooks/                #   React Hooks
│   └── worker/               #   Web Worker（布局计算）
├── generated/                # 自动生成的代码（版本号等）
├── xuanji/                   # 璇玑图算法库（零宿主依赖，可提取为独立包）
│   ├── ops/                  #   Booth 最小旋转 / 滚动哈希 / 环存在性 / 不变量 I1-I5
│   ├── core/                  #   图空间 / 路径规则与组合代数 / 路径条目 / 长度 NFA
│   ├── index/                #   路径索引 / 增量引擎 / 局部重组
│   ├── query/                #   枚举 / 查询回退 / Top-K
│   └── registry/             #   规则注册与版本热替换
└── shared/                   # Host/Client 共享模块
    ├── Logger.ts             #   日志工具
    ├── constants.ts          #   常量定义
    ├── viewModeUtils.ts      #   视图模式工具
    ├── layoutUtils.ts        #   布局间距计算
    ├── pathUtils.ts          #   路径工具
    ├── astUtils.ts           #   AST 工具
    ├── CFGTypes.ts           #   CFG 类型定义
    └── analysis/             #   分析算法
        ├── AdjacencyList.ts  #     邻接表
        ├── GraphBFS.ts       #     BFS 遍历
        ├── XuanjiAdapter.ts  #     璇玑图库的宿主适配层（GraphData ⇄ GraphSpace）
        ├── batchReach.ts     #     SCC + bitset 批量可达计数
        └── modulePath.ts     #     模块路径分析
```

### 其它顶层目录

| 路径 | 作用 |
|---|---|
| `docs/agents/` | **权威开发文档族**：01 插件开发规范 / 02 宿主 API / 03 客户端 API / 04 架构设计 / 05 官方规范检索证据 / 06 dsh-anic 规范 / **07 界面与功能域规划** / **08 质量属性与评审标准** / **09 破坏性变更与兼容策略** |
| `docs/research/` | 研究报告（多代 API 差异、璇玑图、Graphify、本轮规范与破坏性变更） |
| `site/plugin-market/` | 本地插件市场索引（`index.json` + `icons/`），由 `scripts/plugin-market-index.mjs` 生成 |
| `dsh-anic/` | 仓库内的**独立兄弟工程**（ANIC 工作流可视化），与本插件源码零依赖 |
| `.dsh/skills/` | 仓库内技能库（`ai-native-iteration-cycle` 等） |
| `.cycles/` | 迭代循环工件（评估报告、门禁台账、子规划、测试报告） |

### 聚类策略

采用 **渐进式聚类 + 增量聚类 + Louvain 社区检测** 三层聚类体系：

| 模块 | 策略 | 行为 |
|------|------|------|
| `progressiveCluster` | 渐进式聚类 | 按聚类深度逐步展开，目录 → 文件 → 函数层级递进 |
| `incrementalCluster` | 增量聚类 | 新增节点增量聚类，保留已有聚类结构不变 |
| `louvainDetection` | Louvain 社区检测 | 基于模块度的社区检测算法，自动发现代码社区结构 |
| `communityDetection` | 社区检测辅助 | 高连接度节点选择、社区质量评估 |

**渐进式层级展开**：在渐进式聚类模式下，展开一个聚类节点会显示下一层级的聚类节点。用户可以逐层展开直到看到原始函数/类/变量节点。增量聚类确保新增节点被合理分配到已有聚类中，不会破坏现有聚类结构。

## DSH 插件规范合规

本项目遵循 DSH 插件开发规范九条红线：

- [x] 插件入口 `src/index.ts` 使用 Cordis 4 原生模式（`export const name` + `export const inject` + `export async function apply`）注册
- [x] `dsh.bundle.patch` 指定 Cordis 补丁文件
- [x] `dsh.client.platform` 为 `"web"`
- [x] `dsh.client.inject` 声明运行时注入依赖
- [x] `peerDependencies` 声明 Cordis / dsh-tools / dsh-llm / React
- [x] `exports` 字段正确导出 host（`.`）与 client（`./client`）入口，并导出 `./locale/*.json`
- [x] `files` 字段只包含运行时需要的产物：`dist`、`cordis.patch.yml`、`locale`、`assets`、`README.md`
- [x] `engines` 声明 Node/pnpm/DSH 版本要求；其中 `engines.dsh` 是宿主**真正读取**的兼容门
- [x] `packageManager` 字段指定 pnpm 版本
- [x] 不含无读取者的元数据（`dsh.displayName` / `category` / `permissions` 等一律不写，由 `tests/unit/manifest.test.ts` 守卫）

## 插件市场

本仓库同时维护一份**可用于自建插件市场的索引**，它不进 npm 包，而是作为静态资源发布。

### 市场怎么收录一个插件

- **npm 包只在声明了 `dsh.bundle` 时才会被索引收录**。本项目的声明在 `package.json` 的
  `dsh.bundle.patch = "./cordis.patch.yml"`——没有这一条，`keywords` 写得再好也不会出现。
- **搜索命中面**：名称、作者、`keywords`，以及**所有语言**的标题/描述/分类/标签。
  本项目的 18 个 `keywords`（`dsh`、`dsh-plugin`、`dsh-market`、`codegraph`、`call-graph`、
  `impact-analysis`、`ast`、`tree-sitter` …）就是搜索入口。
- **多语言显示文案**来自 `locale/en.json` + `locale/zh.json`（`LocalizedText` 要求至少含 `en`），
  而不是 `package.json.description`。
- **图标**：`assets/icon.svg`，索引里以相对路径 `icons/icon.svg` 引用——相对图标**相对索引 URL 解析**，
  所以索引和 `icons/` 目录必须一起发布。

### 本地生成索引

```bash
node scripts/plugin-market-index.mjs            # 生成 site/plugin-market/index.json + icons/
node scripts/plugin-market-index.mjs --offline  # 不访问 npm registry（离线可复现）
node scripts/plugin-market-index.mjs --check    # 只校验是否最新，过期退出码 1（CI 用）
```

索引格式为 `format: 1` 的 JSON，每个插件条目含 `name` / `title` / `description` / `icon` /
`author` / `homepage` / `repository` / `metadata`（分类、标签、排序键）/ `versions`
（`version` + `publishTimestamp` + `source` + 可选 `engines.dsh`）。

### 发布

把 `site/plugin-market/` 整个目录放到任意静态主机（GitHub Pages、对象存储均可）即可；
要求 UTF-8 JSON、2xx 直出且不经过重定向。DSH 侧在「插件 → 实验性插件 → 自定义插件市场」里
添加该 `index.json` 的 URL 后，就能在「发现」标签页搜索与安装。

> 格式的权威说明见本地知识库 `dsh-plugin-dev-kb` 的 `site/guide/plugin-market.md`。

## 质量门禁与兼容承诺

### 门禁（每条都能在本地一条命令复验）

| 门禁 | 阈值 / 口径 | 命令 |
|---|---|---|
| 类型 | 三面零错误（host / client / test） | `pnpm run typecheck` |
| Lint | 0 warnings / 0 errors | `pnpm run lint` |
| 测试 | 全绿；用例数不得低于已提交基线 | `pnpm run test` |
| 覆盖率 | 语句/分支/函数/行 **四维均 ≥ 86%** | `pnpm run test:coverage` |
| 构建 | exit 0；client ≤ 3 MB、host ≤ 512 KB | `pnpm run build && pnpm run perf-gate` |
| 复杂度 | 单文件 ≤ 100（`band-detector` 预算，超带即 `OVER_BUDGET`） | `node .dsh/skills/ai-native-iteration-cycle/scripts/band-detector.mjs . --threshold 0.15` |
| 依赖安全 | `critical = 0`、`high = 0`（**必须**显式 registry，镜像无 bulk audit 端点） | `pnpm audit --json --registry=https://registry.npmjs.org` |
| 卫生 | 消费面/死代码检查 | `pnpm run hygiene` |

逐条判据（场景 → 阈值 → 用例 → 当前状态）在 [`docs/agents/08-质量属性与评审标准.md`](docs/agents/08-质量属性与评审标准.md)；
哪里**只有人工评审能发现**，也在那份文档里显式列出（不假装有保护）。

### 兼容承诺

| 项 | 值 | 是不是真承诺 |
|---|---|---|
| `engines.dsh` | `">=0.2.0-rc.2 <0.4.0-0"` | **是。宿主 `dsh-app-boot` 的 `unmetRequirements()` 读它，且单独决定——声明了它，peer 范围就不再被检查** |
| `peerDependencies`（`@deepseek-ai/dsh-*`） | `"^0.2.0-rc.2 \|\| ^0.3.0-rc.2"` | 仅在 `engines.dsh` 缺席时才生效（对本项目是「备份声明」） |
| `dsh.manifestVersion` | `1` | **不是**。零读取者（宿主 asar 内只有 6 处命中，全是 README 正文） |
| 已验证运行宿主 | `0.2.1-rc.3`（Windows 桌面端） | 这是「跑通过」的事实，**不是**下限；下限是 `0.2.0-rc.2` |
| gen3（`0.3.0-rc.2`） | 在声明窗口内 | **未真机验证**，只保证不被安装门拒绝 |

为什么「peer 范围才是真承诺」这个流行说法在本项目**不成立**、以及 `0.4.0-rc.1` 曾被放行的完整证据链，
见 [`docs/agents/09-破坏性变更与兼容策略.md`](docs/agents/09-破坏性变更与兼容策略.md) §1 与 §3.2。

## 开发

### 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript 5.7+ |
| 框架 | React 19 + Cordis 4 |
| 渲染 | Cytoscape.js 3.26 + cytoscape-dagre |
| 状态 | Zustand 5 |
| 构建 | tsdown (rolldown) |
| 测试 | Vitest 3 + Playwright 1.62 |
| Lint | oxlint |
| 包管理 | pnpm 9 |

### 常用命令

```bash
pnpm run build          # 完整构建（host + client）
pnpm run build:client   # 仅构建 client bundle
pnpm run dev            # 启动自包含 dev server（模拟 Web Shell + 桩数据）
pnpm run test           # 单元 + 组件测试
pnpm run test:coverage  # 覆盖率（四维 86% 阈值）
pnpm run test:e2e       # E2E 测试（需先启动 dev server）
pnpm run typecheck      # 三面类型检查（host / client / test）
pnpm run lint           # oxlint
pnpm run perf-gate      # 体积 + 用例数门禁
pnpm run hygiene        # 消费面 / 死代码检查
```

### 真机验证

真机（Electron 桌面宿主 / Web 宿主）的启动、认证 URL 获取与进程收敛统一走
`node scripts/start-dsh-test.mjs`，**不要自己写第二套启动脚本**——历史事故都来自两套脚本漂移。
该脚本在 cycle-110 修了三处启动缺陷：Electron 垫片解析、认证 URL 等待窗口、桌面宿主进程名白名单。
步骤与断言点见 `docs/用户旅程.md` 的 J0 段，以及 `.cycles/cycles/cycle-110/subplans/` 下的旅程清单。

> 改过 HOST 路由后必须**重启宿主进程**（只重建不够：运行中的进程持有旧 bundle）。

### CI/CD

项目使用两个独立的 GitHub Actions 工作流：

| 工作流 | 文件 | 触发条件 | 职责 |
|--------|------|----------|------|
| CI | `ci.yml` | push/PR to master | lint + typecheck + test + build |
| Release | `release.yml` | push tag `v*` | build + GitHub Release + npm publish |

### 测试覆盖

分层与命令（准确数字以实跑为准，`pnpm run test` 会打印；用例数下限由 `pnpm run perf-gate` 棘轮守住）：

| 层 | 位置 | 命令 |
|---|---|---|
| L1 单元 + L2 组件 | `tests/unit/**`、`tests/component/**`（jsdom） | `pnpm run test` |
| L3 契约守卫（源码形态扫描） | `tests/unit/*Contract.test.ts` | 同上 |
| L4 E2E | `tests/e2e/**`（23 个 spec：用户旅程、混沌、按需加载、条件请求、键盘、i18n、视图分层…） | `pnpm run test:e2e` |
| L4 视觉 | `tests/e2e/visual-screenshots.spec.ts`（逐图预算 + 硬上限） | `pnpm run test:visual` |
| L4 性能 | `tests/e2e/performance.spec.ts` | `pnpm run test:performance` |

覆盖率、体积与用例数的真实基线见 `.cycles/cycles/*/test-reports/test-report.md` 与 `scripts/perf-baseline.json`。

## 更新日志

### 0.3.1（2026-11-13）

- **命令窗口结果呈现增强**：15 个图谱工具全部接入 `presentationMeta` 投影 + `presentResult` 内容摘要（模型/UI 双通道彻底分离，UI 卡片直接可读结果要点，isError 有失败摘要、空投影诚实省略）。
- **工具注册崩溃安全化**：逐工具 try/catch 降级 + 注册结果白盒快照——单个注册失败（同名冲突/宿主拒绝）不再拖垮其余 14 个工具，热更新撤销互不影响。
- **图交互增强**：Shift 框选（cytoscape boxend 并入多选镜像）、右键菜单 4 新动作（从此展开/收起到这里/固定节点/复制符号 ID，全项 `data-action-id`）、面板栈 768/480 两档容器查询响应式。
- **CSS 纪律门禁化**：新增 color-mix fallback 契约守卫（每处用法必须有对应 fallback 条目），补齐 node-detail 8 处缺口（浅/深双变体）。
- **真实缺陷修复**：小地图悬浮提示 inline style 多余右括号（border/shadow 恢复生效）；StatusBar 等三处类型收窄。
- 测试基线 7055 → **7178**（+123：presentResultSummary 78 / 崩溃安全回归 3 / colorMixFallbackContract 3 / FBX-02 4 / FBX-03 5 / 键盘提示 2 / panelStackResponsiveContract 5 / 既有断言同步）。
- 联动上游：dsh-anic 技能三缺陷修复（init-cycle 号源三源取最大 / Merkle 缓存纳入 CSS / auto-fix-loop ENOBUFS 伪装超时根因修复）。

### 0.3.0（2026-11-07）

- **声明式配置**：导出 Schemastery `Config` schema（Standard Schema 接口）——宿主设置 UI 可编辑插件配置，cordis 加载期校验 + 默认值填充；与 `resolveConfig` 双防线同形状（契约测试钉死单一真源）。
- **诊断四态**：`/status` 新增 `diagnosis` 字段（`ready`/`degraded`/`disabled` + 稳定问题码），管理面板按问题码渲染修复指引（对齐 dsh-ops diagnose 模式）。
- **限流可观测**：`/manage/metrics` 新增 `rateLimiter` 白盒快照（活跃桶/配额/窗口剩余），限流从黑盒行为变成数据面。
- **交互式图例**：点击图例行切换节点/边类型可见性，与筛选面板共享同一状态源；最后一个可见类型防呆不可关闭。
- **调用链流动动画**：高亮调用链的边以虚线流动呈现（cytoscape 原生 line-dash-offset 补间），动画句柄生命周期与高亮类严格对齐（无 RAF 泄漏）。
- 测试基线 7041 → **7055**（+14：configSchemaContract 5 / diagnosisContract 6 / rateLimiterSnapshot 4 / Legend 组件 6 / 流动动画 4 − 既有 routes 断言更新 9）。

### 0.2.0

- 原生 SQLite 索引通道（上游缺席时毫秒级分页读取）、Π 时序/所有权视图、图谱管理面板（图指标 14 项 + 索引覆盖 + 索引删除）、介数采样上界（8393 节点 65.4s → 2.7s）、命令窗口显示修复（windowsHide 纪律）。

## 许可证

[MIT](LICENSE)

## 致谢

- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) — Agent 运行时框架
- [Cytoscape.js](https://cytoscape.org/) — 图可视化引擎
- [dsh-codegraph](https://github.com/jiangzhenguo/dsh-codegraph) — CodeGraph CLI 数据源
- [dsh-tool-lens](https://github.com/trench-xinxin/dsh-tool-lens) — AST 代码图谱数据源
