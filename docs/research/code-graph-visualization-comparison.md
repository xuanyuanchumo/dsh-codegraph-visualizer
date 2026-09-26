# 代码图谱可视化开源项目对比评估报告

> 生成日期: 2026-09-26
> 评估目标: 为 dsh-codegraph-visualizer 项目提供功能对比和可借鉴特性分析

---

## 1. 研究项目概览

| 项目 | Stars | 语言 | 定位 | 渲染引擎 |
|------|-------|------|------|----------|
| **dsh-codegraph-visualizer** (本项目) | - | TypeScript | DSH 插件式代码图谱可视化 | Cytoscape.js |
| **dependency-cruiser** | 7.2k | JavaScript | 依赖验证+可视化 CLI 工具 | GraphViz dot |
| **madge** | 10.2k | JavaScript | 模块依赖图生成+循环检测 | GraphViz |
| **astexplorer** | 6.5k | JavaScript | 多解析器 AST 探索 Web 工具 | 自研树形 UI |
| **React Flow (xyflow)** | 38.5k | TypeScript | 节点式 UI 通用框架 | 自研 (DOM/SVG) |
| **graphology** | 1.7k | JavaScript/TS | 多用途 Graph 数据结构+算法库 | 无渲染层 (数据层) |
| **sigma.js** | ~5k | TypeScript | 大图 WebGL 渲染引擎 | WebGL/Canvas |
| **Understand-Anything** | - | - | AI 驱动代码理解 | - |
| **G6 (AntV)** | ~10k | TypeScript | 蚂蚁集团图可视化引擎 | Canvas/WebGL/SVG |

---

## 2. 项目对比矩阵

### 2.1 功能对比

| 功能维度 | 本项目 | dependency-cruiser | madge | astexplorer | React Flow | graphology | sigma.js | G6 |
|----------|--------|-------------------|-------|-------------|------------|------------|----------|-----|
| **依赖图可视化** | ✅ 多视图 | ✅ 核心功能 | ✅ 核心功能 | ❌ | ⚠️ 需自定义 | ❌ | ⚠️ 需自定义 | ⚠️ 需自定义 |
| **AST 可视化** | ✅ 微视图 | ❌ | ❌ | ✅ 核心功能 | ❌ | ❌ | ❌ | ❌ |
| **调用图** | ✅ callgraph 视图 | ❌ | ❌ | ❌ | ⚠️ 需自定义 | ❌ | ⚠️ 需自定义 | ⚠️ 需自定义 |
| **继承图** | ✅ inheritance 视图 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **循环依赖检测** | ✅ CycleDetector | ✅ 内置规则 | ✅ 核心功能 | ❌ | ❌ | ✅ 算法库 | ❌ | ❌ |
| **影响分析** | ✅ ImpactAnalyzer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **路径查找** | ✅ PathFinder | ❌ | ❌ | ❌ | ❌ | ✅ BFS/DFS | ❌ | ❌ |
| **规则验证** | ❌ | ✅ 核心功能 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **符号搜索** | ✅ SearchController | ❌ | ❌ | ✅ 树搜索 | ❌ | ❌ | ❌ | ❌ |
| **架构健康评分** | ✅ HealthScoreCard | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **热力图** | ✅ 4种模式 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **多语言支持** | ✅ 6种 (TS/JS/Py/Java/Rust/Go) | ✅ JS/TS/CoffeeScript | ✅ JS/TS/CSS预处理 | ✅ 20+语言 | N/A | N/A | N/A | N/A |
| **多数据源融合** | ✅ 4适配器 | ❌ 单一 | ❌ 单一 | ❌ 单一 | N/A | N/A | N/A | N/A |
| **导出能力** | ✅ PNG/SVG/JSON/Mermaid | ✅ dot/svg/html/mermaid/json/csv | ✅ SVG/DOT | ⚠️ 分享URL | ❌ | ❌ | ❌ | ✅ |
| **插件/扩展机制** | ✅ DSH 插件 | ⚠️ 自定义规则 | ❌ | ✅ 自定义解析器 | ✅ 自定义节点 | ✅ 标准库扩展 | ❌ | ✅ |

### 2.2 技术栈对比

| 技术维度 | 本项目 | dependency-cruiser | madge | astexplorer | React Flow | graphology | sigma.js | G6 |
|----------|--------|-------------------|-------|-------------|------------|------------|----------|-----|
| **核心语言** | TypeScript | JavaScript | JavaScript | JavaScript | TypeScript | JS/TS | TypeScript | TypeScript |
| **渲染方式** | Cytoscape.js (Canvas) | GraphViz (静态图) | GraphViz (静态图) | DOM 树 | DOM/SVG | 无 (数据层) | WebGL | Canvas/WebGL/SVG |
| **状态管理** | Zustand | 无 | 无 | React State | React Hooks | 内部 | 内部 | 内部 |
| **AST 解析** | web-tree-sitter WASM | acorn | dependency-tree | 多解析器 | N/A | N/A | N/A | N/A |
| **布局算法** | 7种 (cose/fcose/dagre/circle/grid/radial/tree) | dot/neato/fdp/sfdp/twopi/circo | dot/neato/fdp/sfdp/twopi/circo | 树形展开 | dagre/elk/d3-hierarchy | forceatlas2/circular/etc | forceAtlas2 | dagre/fruchterman/g6-force |
| **构建工具** | tsdown (rolldown) | npm | npm | webpack | turbo | lerna | rollup | webpack |
| **交互模式** | 实时交互 | CLI + 静态输出 | CLI + 静态输出 | 实时交互 | 实时交互 | API 调用 | 实时交互 | 实时交互 |

### 2.3 可视化交互方式对比

| 交互维度 | 本项目 | dependency-cruiser | madge | astexplorer | React Flow | sigma.js | G6 |
|----------|--------|-------------------|-------|-------------|------------|----------|-----|
| **宏观/微观视图** | ✅ 9种视图模式 | ❌ 单一视图 | ❌ 单一视图 | ❌ 单一视图 | ⚠️ 自定义 | ❌ | ⚠️ 可切换 |
| **渐进式聚类** | ✅ 4级 (dir/file/func/smart) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **按需展开** | ✅ 点击展开+预算控制 | ❌ | ❌ | ✅ shift+click | ❌ | ❌ | ✅ |
| **视口聚焦** | ✅ 邻域聚焦 | ❌ | ❌ | ❌ | ✅ fitView | ✅ | ✅ |
| **拖拽交互** | ✅ | ❌ 静态图 | ❌ 静态图 | ❌ | ✅ | ✅ | ✅ |
| **缩放/平移** | ✅ | ❌ 静态图 | ❌ 静态图 | ❌ | ✅ | ✅ | ✅ |
| **高亮联动** | ✅ 调用链高亮 | ❌ | ❌ | ✅ AST↔源码 | ✅ | ⚠️ | ✅ |
| **过滤面板** | ✅ 节点/边类型+阈值 | ✅ include/exclude | ✅ exclude | ⚠️ | ❌ | ❌ | ✅ |

### 2.4 性能优化策略对比

| 性能维度 | 本项目 | dependency-cruiser | madge | astexplorer | React Flow | sigma.js | G6 |
|----------|--------|-------------------|-------|-------------|------------|----------|-----|
| **虚拟视口** | ✅ QuadTree 空间索引 | N/A | N/A | N/A | ❌ | ✅ | ✅ |
| **懒加载/按需加载** | ✅ 渐进式聚类+预算控制 | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ |
| **Web Worker** | ✅ 布局计算卸载 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **LOD 多级细节** | ✅ 3档 (minimal/compact/full) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **增量布局** | ✅ 黄金角螺旋 | ❌ | ❌ | �/A | ❌ | ❌ | ✅ |
| **大图降级** | ✅ 自动切换布局 | ❌ | ❌ | N/A | ❌ | ✅ WebGL | ✅ WebGL |
| **缓存机制** | ✅ 4级缓存 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **预取机制** | ✅ hover 预取展开 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **批量渲染** | ✅ cy.batch() | N/A | N/A | N/A | ✅ | ✅ | ✅ |
| **边简化** | ✅ 视口隐藏+相交检测 | N/A | N/A | N/A | ❌ | ✅ | ✅ |
| **节点上限控制** | ✅ MAX_VISIBLE_NODES=1500 | ❌ | ❌ | N/A | ❌ | ❌ | ✅ |

### 2.5 数据结构设计对比

| 数据维度 | 本项目 | dependency-cruiser | madge | astexplorer | graphology |
|----------|--------|-------------------|-------|-------------|------------|
| **节点类型** | function/class/variable/module/interface/type | module | module | AST节点 (类型多样) | 通用 |
| **边类型** | call/import/extend/implement/dependency/contains/association/aggregation/composition | dependency | dependency | 父子关系 | 通用 |
| **ID 系统** | Branded 类型 (NodeId/EdgeId/RepoId) | 字符串 | 字符串路径 | 路径 | 字符串/数字 |
| **聚类结构** | ClusterNode (4级) | ❌ | ❌ | ❌ | ❌ |
| **AST 结构** | ASTNode (type/text/position/children) | ❌ | ❌ | 多解析器格式 | ❌ |
| **增量数据** | GraphDataDelta (applyDelta) | ❌ | ❌ | ❌ | ❌ |
| **元数据** | repoId/timestamp/truncated/totalCount | ❌ | ❌ | ❌ | ❌ |
| **属性扩展** | properties/tags/complexity/layer | ❌ | ❌ | ❌ | 自定义属性 |

---

## 3. 重点研究项目深度分析

### 3.1 dependency-cruiser

**核心功能**: 验证和可视化 JavaScript/TypeScript/CoffeeScript 项目的依赖关系，支持自定义规则系统

**技术架构**:
- CLI 工具，无交互式 UI
- 使用 acorn 解析 JS，支持 ES6/CommonJS/AMD
- 输出格式: dot (GraphViz)、mermaid、json、csv、html、text
- 规则系统: forbidden/allowed 规则，支持 from/to 路径匹配、正则过滤
- 集成: 可嵌入 CI/CD 流程，npm 脚本

**可借鉴特性**:
1. **规则验证引擎** — 本项目缺少架构规则验证功能，可借鉴 dependency-cruiser 的 forbidden/allowed 规则模式，实现如"禁止跨层依赖"、"禁止循环依赖"等架构约束
2. **多种输出格式** — 本项目已有 PNG/SVG/JSON/Mermaid 导出，可补充 CSV、HTML 自包含报告
3. **CI/CD 集成模式** — 可考虑增加 CLI 模式，支持在构建流程中生成图谱报告

### 3.2 madge

**核心功能**: 生成模块依赖图，检测循环依赖，支持 JavaScript (AMD/CJS/ES6) 和 CSS 预处理器

**技术架构**:
- CLI + API 双模式
- 基于 dependency-tree 和 precinct 进行模块解析
- GraphViz 作为渲染后端
- 支持 webpack/requirejs/tsconfig 别名解析
- 6 种 GraphViz 布局: dot/neato/fdp/sfdp/twopi/circo

**可借鉴特性**:
1. **CSS 预处理器支持** — madge 支持 Sass/Stylus/Less 的依赖图，本项目可扩展 CSS/SCSS 模块的依赖分析
2. **别名解析** — 支持 webpackConfig/tsConfig 的路径别名解析，本项目可增强对路径别名的处理
3. **orphans/leaves 分析** — 孤儿模块和叶子模块检测，可作为架构健康指标

### 3.3 astexplorer

**核心功能**: Web 工具，粘贴代码即可探索多种解析器生成的 AST，支持 20+ 语言和 30+ 解析器

**技术架构**:
- React Web 应用
- 双面板: 左侧代码编辑器，右侧 AST 树
- 每种语言/解析器有独立的适配模块 (src/parsers/{language})
- 支持 AST 转换器 (babel/eslint/jscodeshift/postcss)
- 可分享 URL (代码片段持久化)

**可借鉴特性**:
1. **AST↔源码双向高亮** — hover AST 节点高亮对应源码，编辑源码自动定位 AST 节点，本项目微视图可增强此交互
2. **多解析器支持** — astexplorer 支持 30+ 解析器，本项目仅使用 tree-sitter，可考虑增加 Babel/TypeScript Compiler 等解析器作为备选
3. **AST 转换器集成** — 支持在 AST 上直接运行 babel/eslint 转换，本项目可增加代码变换预览功能
4. **分享 URL** — 通过 URL 持久化代码片段，本项目可增加图谱状态分享功能

### 3.4 React Flow (xyflow)

**核心功能**: 构建节点式 UI 的通用 React/Svelte 库，38.5k Stars，最流行的节点图框架

**技术架构**:
- React 组件库，DOM/SVG 渲染
- 核心抽象: Node/Edge/Handle/Position
- 状态管理: useNodesState/useEdgesState hooks
- 布局: 外部布局算法 (dagre/elk/d3-hierarchy)
- 自定义节点/边: 通过 React 组件完全自定义渲染
- 内置: MiniMap/Controls/Background

**可借鉴特性**:
1. **自定义节点渲染** — React Flow 允许每个节点是完全自定义的 React 组件，本项目可借鉴此模式增强节点内嵌信息展示（如节点内显示代码片段、复杂度指标等）
2. **Handle 系统** — 节点的输入/输出端口抽象，可使边的连接更加语义化
3. **社区生态** — React Flow 有丰富的示例和社区组件，可参考其节点交互模式

### 3.5 graphology

**核心功能**: 多用途 Graph 数据结构库，支持有向/无向/混合图，自环，平行边，附带完整图论算法标准库

**技术架构**:
- 纯数据层库，无渲染
- Graph 类支持多种图类型
- 标准库: 图论算法 (最短路径、社区检测、中心性、生成树等)
- 事件系统: 节点/边的增删改触发事件
- 被 sigma.js 用作数据后端

**可借鉴特性**:
1. **图论算法库** — graphology 提供完整的算法库 (最短路径、社区检测、中心性计算、连通分量等)，本项目目前仅有 BFS 路径查找和 DFS 循环检测，可引入更多算法
2. **事件驱动模型** — graphology 的图变更事件系统，可作为图谱数据变更通知的标准模式
3. **多图类型支持** — 有向/无向/混合图的统一抽象

### 3.6 sigma.js

**核心功能**: 大规模图可视化 WebGL 渲染引擎，专为万级以上节点的大图设计

**技术架构**:
- WebGL 渲染 (Canvas 降级)
- graphology 作为数据后端
- 自定义节点/边渲染器
- forceAtlas2 布局算法
- 视口管理: 相机 (Camera) 抽象

**可借鉴特性**:
1. **WebGL 渲染** — sigma.js 使用 WebGL 可渲染 10万+ 节点，本项目基于 Cytoscape.js (Canvas) 在 5000+ 节点时性能下降明显，可考虑 WebGL 渲染层
2. **Camera 抽象** — 将视口控制抽象为 Camera 对象，支持平滑动画过渡
3. **自定义渲染器** — 每种节点/边类型可有独立的 WebGL 渲染程序

### 3.7 G6 (AntV)

**核心功能**: 蚂蚁集团开源的图可视化引擎，支持多种图类型和布局算法

**技术架构**:
- 多渲染器: Canvas/WebGL/SVG
- 内置 10+ 布局算法 (dagre/fruchterman/gforce/circular/radial/grid/force/concentric/mds/combo)
- Combo (聚类节点) 原生支持
- 动画系统
- 分析组件: Tooltip/Toolbar/Legend/ContextMenu

**可借鉴特性**:
1. **Combo 聚类节点** — G6 原生支持 Combo (聚类节点) 的展开/折叠，与本项目渐进式聚类类似但更成熟
2. **多渲染器切换** — Canvas/WebGL/SVG 三种渲染器可按需切换，大图自动切换 WebGL
3. **动画系统** — 内置图布局动画和过渡动画，本项目布局切换时缺少平滑过渡
4. **分析组件** — 内置 Tooltip/Toolbar/Legend/ContextMenu 等分析组件，可参考其交互设计

### 3.8 Understand-Anything

**核心功能**: AI 驱动的代码理解工具，通过 LLM 分析代码库并生成可视化解释

**可借鉴特性**:
1. **AI 辅助理解** — 使用 LLM 为代码节点生成自然语言摘要，本项目已有 `summary` 字位但未填充，可引入 AI 生成
2. **智能问答** — 基于图谱的代码问答系统，用户可提问"这个函数被谁调用"等问题

---

## 4. 特别关注领域分析

### 4.1 按需加载/懒加载实现方式

| 项目 | 策略 | 实现细节 | 适用规模 |
|------|------|----------|----------|
| **本项目** | 渐进式聚类 + 预算控制 | 4级聚类 (dir→file→func→smart)，展开预算 300，总上限 1500 | 万级节点 |
| **sigma.js** | WebGL 全量渲染 | WebGL 高性能渲染，无需懒加载 | 10万级节点 |
| **G6** | Combo 展开/折叠 + 分层加载 | 原生 Combo 聚类，支持异步加载子图 | 万级节点 |
| **React Flow** | 无内置懒加载 | 需开发者自行实现 | 千级节点 |
| **astexplorer** | shift+click 全展开 | 默认折叠，按需展开子树 | 单文件 AST |

**本项目优势**: 渐进式聚类 + 预算控制 + 预取机制是最完善的按需加载方案
**可借鉴**: G6 的异步子图加载模式，可在展开聚类节点时异步从后端拉取子图数据

### 4.2 大图性能优化策略

| 项目 | 核心策略 | 渲染技术 | 空间索引 | 降级策略 |
|------|----------|----------|----------|----------|
| **本项目** | 虚拟视口+QuadTree+LOD+Web Worker | Canvas (Cytoscape) | QuadTree | 布局自动降级 (cose→dagre→grid) |
| **sigma.js** | WebGL 全量渲染 | WebGL | 无需 (GPU 渲染) | 无需降级 |
| **G6** | 多渲染器切换+Web Worker | Canvas/WebGL/SVG | 内置 | 自动切换 WebGL |
| **React Flow** | DOM/SVG 轻量渲染 | DOM/SVG | 无 | 无 |
| **dependency-cruiser** | 静态图输出 | GraphViz | N/A | N/A |

**本项目优势**: 多层次优化 (虚拟视口+QuadTree+LOD+缓存+预取+Worker) 覆盖全面
**可借鉴**: sigma.js 的 WebGL 渲染层可作为 Cytoscape 性能瓶颈的替代方案；G6 的多渲染器自动切换策略

### 4.3 宏观与微观视图切换机制

| 项目 | 宏观视图 | 微观视图 | 切换机制 |
|------|----------|----------|----------|
| **本项目** | code/dependencies/inheritance/callgraph/package/class (6种) | cfg/flowchart/sequence (3种) | computeViewModeTransition 状态转换 |
| **G6** | 可自定义 | 可自定义 | 通过布局/节点类型切换 |
| **astexplorer** | 无 | AST 树 | 单一视图 |
| **dependency-cruiser** | 依赖图 | 无 | 单一视图 |
| **React Flow** | 自定义 | 自定义 | 开发者自定义 |

**本项目优势**: 9种视图模式 + 宏观/微观分离是所有项目中最丰富的
**可借鉴**: 可增加更多微视图类型，如数据流图 (DFD)、状态转换图 (State Chart)

### 4.4 代码图谱与 AST 的数据结构设计

| 项目 | 图谱数据结构 | AST 数据结构 | 统一性 |
|------|-------------|-------------|--------|
| **本项目** | GraphNode/GraphEdge (Branded ID) + ClusterNode/ClusterEdge | ASTNode (type/text/position/children) | 分离，通过适配器层转换 |
| **dependency-cruiser** | 模块依赖树 (对象嵌套) | 无 | 单一 |
| **madge** | 模块依赖树 (对象嵌套) | 无 | 单一 |
| **astexplorer** | 无图谱概念 | 多解析器 AST 格式 | 单一 |
| **graphology** | 通用 Graph 类 | 无 | 单一 |

**本项目优势**: Branded 类型安全 + 多数据源融合 + 聚类扩展 + 增量更新是独特的设计
**可借鉴**: graphology 的统一 Graph 抽象层可作为图谱数据结构的参考标准

---

## 5. 可借鉴特性优先级列表

### P0 — 高价值，短期内可实现

| # | 特性 | 来源项目 | 价值描述 | 实现难度 |
|---|------|----------|----------|----------|
| 1 | **架构规则验证引擎** | dependency-cruiser | 支持 forbidden/allowed 规则，如禁止跨层依赖、禁止特定路径模式 | 中 |
| 2 | **AST↔源码双向高亮** | astexplorer | 微视图中 AST 节点与源码的双向定位高亮 | 中 |
| 3 | **孤儿/叶子节点检测** | madge | 作为架构健康指标，识别无人引用的模块 | 低 |
| 4 | **图论算法扩展** | graphology | 最短路径、社区检测、中心性、连通分量等 | 低 (可引入 graphology 库) |
| 5 | **布局动画过渡** | G6 | 视图模式切换和布局变化时的平滑动画 | 中 |

### P1 — 中等价值，中期可实现

| # | 特性 | 来源项目 | 价值描述 | 实现难度 |
|---|------|----------|----------|----------|
| 6 | **WebGL 渲染层** | sigma.js | 突破 Canvas 性能瓶颈，支持 10万+ 节点 | 高 |
| 7 | **自定义节点渲染** | React Flow | 节点内嵌代码片段、复杂度指标等富信息展示 | 中 |
| 8 | **CSS/SCSS 依赖分析** | madge | 扩展 CSS 预处理器的依赖图谱 | 中 |
| 9 | **异步子图加载** | G6 | 展开聚类节点时异步从后端拉取子图 | 中 |
| 10 | **AI 辅助节点摘要** | Understand-Anything | 使用 LLM 为代码节点生成自然语言描述 | 中 |
| 11 | **图谱状态分享 URL** | astexplorer | 通过 URL 持久化和分享图谱状态 | 低 |

### P2 — 探索性，长期考虑

| # | 特性 | 来源项目 | 价值描述 | 实现难度 |
|---|------|----------|----------|----------|
| 12 | **多渲染器切换** | G6 | Canvas/WebGL/SVG 按需切换 | 高 |
| 13 | **AST 转换器集成** | astexplorer | 在图谱上直接运行 babel/eslint 转换预览 | 高 |
| 14 | **多解析器支持** | astexplorer | 除 tree-sitter 外支持 Babel/TS Compiler 等 | 中 |
| 15 | **Camera 抽象** | sigma.js | 视口控制抽象为 Camera 对象，支持平滑动画 | 中 |
| 16 | **事件驱动图谱模型** | graphology | 图变更事件系统作为标准通知机制 | 中 |

---

## 6. 本项目独特优势总结

与所有研究项目对比，dsh-codegraph-visualizer 具有以下独特优势：

1. **最丰富的视图体系** — 9种视图模式 (6宏观 + 3微观)，远超其他项目的单一或双视图
2. **最完善的大图优化** — 虚拟视口 + QuadTree + LOD + Web Worker + 4级缓存 + 预取 + 增量聚类，形成多层次优化体系
3. **多数据源融合** — 4种适配器 (CodeGraph DB/Lens/TreeSitter/Dependency) 统一接入，GraphDataMerger 去重合并
4. **渐进式聚类交互** — 4级聚类 (directory→file→function→smart) + Louvain 社区检测 + 预算控制，是所有项目中最成熟的
5. **Branded 类型安全** — NodeId/EdgeId/RepoId 编译期防混用，是代码图谱领域罕见的类型安全设计
6. **DSH 插件生态** — 作为 DSH 平台插件，具有宿主环境集成优势
7. **增量更新能力** — applyDelta 增量合并 + DiffEngine 差异引擎，支持热更新场景

---

## 7. 主要差距与改进方向

| 差距领域 | 对标项目 | 差距描述 | 改进建议 |
|----------|----------|----------|----------|
| **渲染性能** | sigma.js/G6 | Canvas 渲染在 5000+ 节点时性能不足 | 增加 WebGL 渲染层或考虑迁移到 sigma.js/G6 |
| **规则验证** | dependency-cruiser | 缺少架构规则验证引擎 | 实现 forbidden/allowed 规则系统 |
| **算法库** | graphology | 仅有 BFS/DFS，缺少社区检测、中心性等 | 引入 graphology 标准库 |
| **布局动画** | G6 | 视图切换和布局变化缺少平滑过渡 | 增加动画过渡系统 |
| **节点富信息** | React Flow | 节点展示信息有限 | 支持自定义节点渲染，内嵌代码片段/指标 |
| **CSS 支持** | madge | 不支持 CSS/SCSS 依赖分析 | 增加 CSS 预处理器适配器 |
| **AI 辅助** | Understand-Anything | 节点摘要字段未填充 | 引入 LLM 生成节点描述 |

---

## 附录: 项目链接

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — 7.2k Stars, MIT License
- [madge](https://github.com/pahen/madge) — 10.2k Stars, MIT License
- [astexplorer](https://github.com/fkling/astexplorer) — 6.5k Stars, MIT License
- [React Flow / xyflow](https://github.com/xyflow/xyflow) — 38.5k Stars, MIT License
- [graphology](https://github.com/graphology/graphology) — 1.7k Stars, MIT License
- [sigma.js](https://github.com/jacomyal/sigma.js) — ~5k Stars, MIT License
- [G6 / AntV](https://github.com/antvis/G6) — ~10k Stars, MIT License