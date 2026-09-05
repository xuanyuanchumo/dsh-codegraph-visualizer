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
- **渐进式层级聚合** — 目录级 → 文件级 → 函数级 三层聚类，逐层展开
- **4 种布局引擎** — Cose（力导向）、Dagre（层次）、Circle（环形）、Grid（网格）
- **交互式分析** — 符号搜索、调用链追踪、循环依赖检测、影响分析、继承层次
- **实时增量更新** — 文件监听 + 事件驱动，代码变更后图谱自动刷新
- **导出能力** — PNG / SVG / JSON 三格式导出
- **中英双语 i18n** — 完整国际化支持
- **主题切换** — 深色/浅色主题，自动适配 DSH 环境变量

## 安装

### 前置条件

- Node.js >= 22.19 或 >= 24
- pnpm >= 9
- DSH Web 环境（`dsh web`）

### 通过 DSH 插件管理安装（推荐）

```bash
# 安装插件（直接从 GitHub 仓库拉取）
dsh plugin --profile web add github:xuanyuanchumo/dsh-codegraph-visualizer

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
pnpm run test           # 单元测试（320 tests）
pnpm run test:e2e       # E2E 测试（需先启动 dev server）
pnpm run typecheck      # 类型检查
pnpm run lint           # Lint
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
├── tools.ts                  # 4 个工具定义（graph_status/data/symbol/impact）
├── types/                    # Branded 类型、GraphData、事件声明合并
├── adapters/                 # 数据源适配器
│   ├── CodeGraphAdapter.ts   #   dsh-codegraph 数据源
│   └── LensAdapter.ts        #   dsh-tool-lens 数据源
├── merger/
│   └── GraphDataMerger.ts    # 多数据源融合器（去重 + 合并）
├── host/                     # Host 端模块
│   ├── config.ts             #   配置定义与校验
│   ├── routes.ts             #   HTTP 路由注册
│   ├── watcher.ts            #   文件监听与事件监听
│   ├── security.ts           #   路径安全校验
│   └── prerequisites.ts      #   前置条件检测
├── client/                   # Client 端模块（浏览器渲染）
│   ├── index.ts              #   Client 端插件入口
│   ├── GraphPanel.tsx        #   主面板 UI 组件
│   ├── api/                  #   HTTP API helpers
│   ├── components/            #   UI 组件（Toolbar, SearchBar, ImportPanel, ...）
│   ├── renderer/             #   渲染引擎
│   │   ├── CytoscapeRenderer.ts  # Cytoscape.js 渲染器
│   │   ├── IRenderer.ts      #     渲染器接口
│   │   └── styles/           #     主题样式
│   ├── store/                #   状态管理
│   │   ├── graphStore.ts     #     Zustand 全局状态
│   │   └── cluster/          #     聚类策略模块
│   │       ├── types.ts      #       ClusterLevel/ClusterNode/ClusterEdge
│   │       ├── index.ts      #       策略注册表
│   │       ├── directoryCluster.ts  # 目录级聚类
│   │       ├── fileCluster.ts       # 文件级聚类
│   │       ├── functionCluster.ts  # 函数级（透传）
│   │       └── smartCluster.ts     # 智能聚类（标签传播）
│   ├── i18n/                 #   国际化（中/英）
│   ├── hooks/                #   React Hooks
│   └── utils/                #   工具函数
├── push/                     # 推送通知模块
└── shared/                   # Host/Client 共享模块
```

### 聚类策略

采用 **策略模式（Strategy Pattern）** 实现 4 级聚类：

| 级别 | 策略 | 行为 |
|------|------|------|
| `directory` | DirectoryClusterStrategy | 按顶级目录聚合，展开后显示文件级聚类节点 |
| `file` | FileClusterStrategy | 按文件聚合，展开后显示函数/类/变量节点 |
| `function` | FunctionClusterStrategy | 透传，不做聚类 |
| `smart` | SmartClusterStrategy | 标签传播社区检测算法 |

**渐进式层级展开**：在目录级模式下，展开一个目录聚类节点会显示该目录下的文件级聚类节点（而非所有原始节点）。用户可以继续展开文件级聚类节点来查看函数级原始节点。

## DSH 插件规范合规

本项目遵循 DSH 插件开发规范九条红线：

- [x] 插件入口 `src/index.ts` 使用 `definePlugin()` 注册
- [x] `dsh.bundle.patch` 指定 Cordis 补丁文件
- [x] `dsh.client.platform` 为 `"web"`
- [x] `dsh.client.inject` 声明运行时注入依赖
- [x] `peerDependencies` 声明 Cordis/DSP-Tools/React
- [x] `exports` 字段正确导出 host/client 入口
- [x] `files` 字段仅包含 `dist` 和 `cordis.patch.yml`
- [x] `engines` 字段声明 Node/pnpm 版本要求
- [x] `packageManager` 字段指定 pnpm 版本

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
pnpm run dev            # 启动 dev server
pnpm run test           # 单元测试
pnpm run test:e2e       # E2E 测试
pnpm run typecheck      # 三面类型检查
pnpm run lint           # Lint
pnpm run lint:fix       # Lint 自动修复
```

### CI/CD

项目使用两个独立的 GitHub Actions 工作流：

| 工作流 | 文件 | 触发条件 | 职责 |
|--------|------|----------|------|
| CI | `ci.yml` | push/PR to master | lint + typecheck + test + build |
| Release | `release.yml` | push tag `v*` | build + GitHub Release + npm publish |

### 测试覆盖

- **320 单元测试** — 覆盖 adapters, tools, plugin, graphStore, validators, i18n, logger, pathSecurity, services, deriveName
- **53 E2E 测试** — 覆盖 J1-J14 用户旅程（5 个 skip 为 dev mode 不支持的功能）

## 许可证

[MIT](LICENSE)

## 致谢

- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) — Agent 运行时框架
- [Cytoscape.js](https://cytoscape.org/) — 图可视化引擎
- [dsh-codegraph](https://github.com/jiangzhenguo/dsh-codegraph) — CodeGraph CLI 数据源
- [dsh-tool-lens](https://github.com/trench-xinxin/dsh-tool-lens) — AST 代码图谱数据源
