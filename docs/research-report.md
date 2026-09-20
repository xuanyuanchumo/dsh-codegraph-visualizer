# 开源代码可视化与图谱项目研究报告

> 为 DSH CodeGraph Visualizer 优化提供参考的详细研究分析

---

## 目录

1. [项目概览与对比矩阵](#1-项目概览与对比矩阵)
2. [各项目深度分析](#2-各项目深度分析)
3. [关键技术主题研究](#3-关键技术主题研究)
4. [当前项目现状评估](#4-当前项目现状评估)
5. [优化建议与实施路线](#5-优化建议与实施路线)

---

## 1. 项目概览与对比矩阵

| 项目 | Stars | 技术栈 | 规模上限 | 核心优势 | 适用场景 |
|------|-------|--------|----------|----------|----------|
| dependency-cruiser | 7.2k | JS/TS | 中型项目 | 规则验证+多格式输出 | CI/CD 依赖检查 |
| npmgraph | 787 | JS/Parcel | npm 包图 | URL API+折叠交互 | npm 包探索 |
| hpcc-js-wasm | 392 | C++/WASM | 大型图 | GraphViz WASM 引擎 | 高质量布局 |
| d3-force | 2k | JS | 中型图 | 模块化力模型 | 自定义力导向 |
| Cytoscape.js | 11.2k | JS | 数千节点 | 70+扩展+完整图论 | 通用图谱可视化 |
| vis-network | 3.6k | JS/Canvas | 数千节点 | 内置聚类+Canvas渲染 | 网络可视化 |
| Gephi | 6.7k | Java/OpenGL | 百万节点 | OpenGL引擎+多线程 | 大规模图谱分析 |
| CodeSee | - | JS/TS | 中大型代码库 | 代码地图+重构辅助 | 代码理解与入职 |
| Sourcegraph | - | Go/TS | 全企业代码 | 跨仓库搜索+代码智能 | 代码搜索导航 |

---

## 2. 各项目深度分析

### 2.1 dependency-cruiser

**架构特点：**
- 基于 AST 解析（acorn）提取依赖关系，不执行代码
- 规则引擎采用声明式配置（`forbidden`/`required`/`allowed` 规则）
- 输出格式：dot (GraphViz)、mermaid、json、csv、html、text
- 核心数据结构：依赖图（有向图），节点=模块，边=依赖关系

**关键设计模式：**
```
源码 → AST 解析 → 依赖提取 → 规则验证 → 多格式输出
                                    ↓
                              图数据结构（JSON）
```

**可借鉴方案：**
- **规则引擎设计**：声明式规则定义（`from`/`to` 路径匹配 + `severity`），本项目已有 `RuleDefinition` 类型但可扩展更多匹配模式
- **多格式导出**：支持 dot/mermaid/csv/html 等"奶奶也能看懂"的输出，本项目已有 JSON/Mermaid/PNG/SVG 导出
- **自举验证**：dependency-cruiser 用自己检查自己的依赖，体现"吃自己的狗粮"原则
- **已知违规管理**：`.dependency-cruiser-known-violations.json` 机制，允许已知技术债务存在

**本项目差距：**
- 规则引擎较简单（仅 4 种规则类型），dependency-cruiser 支持更丰富的路径匹配和条件组合
- 缺少 `--include-only`/`--exclude` 等灵活的过滤范围控制

---

### 2.2 npmgraph

**架构特点：**
- 前端单页应用，使用 Parcel 构建
- URL 参数驱动状态（`q`/`collapse`/`color`/`select`/`sizing`/`zoom`/`deps`/`hide`/`packages`）
- 实时从 npm registry 获取包信息
- 使用 D3 力导向布局

**关键交互设计：**
- **折叠子树**：`collapse=debug,http-errors` — 按模块名折叠子依赖树
- **颜色编码**：4 种维度 — `moduleType`（模块类型）、`bus`（维护者数量/巴士因子）、`outdated`（版本过时程度）、`maintenance`（npms.io 评分）
- **尺寸编码**：`sizing` 参数 — 节点大小反映 unpacked size
- **选择高亮**：`select=exact:name@version`/`name:module`/`license:MIT`/`maintainer:user`
- **自定义包注入**：通过 URL `packages` 参数注入自定义 package.json

**可借鉴方案：**
- **URL 状态持久化**：将视图状态编码到 URL，支持分享和书签。本项目目前缺少这种深度链接能力
- **多维颜色编码**：按巴士因子、维护评分等维度着色，比本项目的 heatmap 模式更丰富
- **节点尺寸编码**：根据代码行数/复杂度/影响力动态调整节点大小，增强信息密度
- **折叠子树交互**：允许用户按需折叠/展开特定子树，而非仅按目录层级聚类

**本项目差距：**
- 缺少 URL 状态持久化（当前仅依赖 zustand persist）
- 颜色编码维度有限（仅 instability/lines/complexity）
- 无节点尺寸编码

---

### 2.3 hpcc-js-wasm (GraphViz WASM)

**架构特点：**
- 将 C++ GraphViz 编译为 WebAssembly
- v3 采用 monorepo + 分包发布（`@hpcc-js/wasm-graphviz` 独立包）
- 异步加载模式：`Graphviz.load().then(graphviz => graphviz.dot(dotStr))`
- 支持 Web Worker 中运行（`index-worker.js`）

**关键性能策略：**
- WASM 执行原生 C++ 布局算法，性能远超 JS 实现
- dot 语言 → SVG 输出，一步到位
- 按需加载 WASM 模块（不阻塞首屏）
- Worker 中运行避免阻塞主线程

**可借鉴方案：**
- **WASM 布局引擎**：将 GraphViz 的 dot/neato/fdp/sfdp 布局算法通过 WASM 引入，作为现有 cytoscape 布局的补充选项
- **异步加载模式**：`await Graphviz.load()` 模式，按需加载 WASM 模块
- **Worker + WASM 组合**：在 Web Worker 中运行 WASM 布局，实现真正的非阻塞计算
- **dot 语言作为中间格式**：可将图数据序列化为 dot 语言，利用 GraphViz 全套布局算法

**本项目差距：**
- 当前 Web Worker 中运行的是 headless cytoscape（JS 实现），性能不如 WASM
- 布局算法仅限 cytoscape 扩展（cose/fcose/dagre），缺少 GraphViz 的高质量布局（sfdp 适合大规模图）
- 无 WASM 集成

---

### 2.4 d3-force

**架构特点：**
- 基于 velocity Verlet 数值积分器的物理力模拟
- 模块化力模型：`forceCenter`/`forceCollide`/`forceLink`/`forceManyBody`/`forceX`/`forceY`/`forceRadial`
- 每个 force 独立配置，可组合使用
- tick 事件驱动渲染：`simulation.on("tick", renderFunction)`

**关键算法细节：**
- **forceManyBody**：使用 Barnes-Hut 算法（四叉树加速），O(n log n) 复杂度
- **forceLink**<sup>1</sup>：弹簧力，根据连接距离约束
- **forceCollide**：碰撞检测，使用四叉树加速
- **alpha 衰减**：模拟"温度"逐渐降低，最终收敛

**可借鉴方案：**
- **Barnes-Hut 四叉树**：用于 many-body 力计算，将 O(n²) 降为 O(n log n)。本项目当前的空间索引（SpatialIndex.ts）是均匀网格，可升级为四叉树
- **模块化力组合**：允许用户自定义力模型组合，而非固定布局算法
- **alpha 衰减策略**：控制模拟收敛速度，避免过度震荡
- **增量模拟**：添加新节点时保持已有节点位置，仅对新节点进行局部力模拟

**本项目差距：**
- 当前布局完全依赖 cytoscape 内置算法，无法自定义力模型
- 空间索引使用均匀网格（cellSize=200），大规模图查询效率不如四叉树
- 无增量力模拟（当前增量布局使用黄金角分布+preset，非真正的增量力导向）

---

### 2.5 Cytoscape.js（本项目已使用）

**架构特点：**
- Core（图实例）+ Collection（元素集合）双组件架构
- Collection 不可变（immutable），支持集合论操作
- 样式表系统（类似 CSS 选择器）分离呈现与数据
- 70+ 扩展生态（布局、交互、导出等）

**关键扩展（与本项目相关）：**
| 扩展 | 功能 | 本项目使用 |
|------|------|-----------|
| cytoscape-dagre | Dagre 层次布局 | ✓ |
| cytoscape-fcose | 改进力导向布局 | ✓ |
| cytoscape-cose-bilkent | 高质量 CoSE 布局 | ✗ |
| cytoscape-cola | Cola.js 约束布局 | ✗ |
| cytoscape-elk | ELK 层次布局 | ✗ |
| cytoscape-avsdf | 径向布局 | ✗ |
| cytoscape-cise | 圆形+聚类布局 | ✗ |
| cytoscape-popper | Popper.js 定位 | ✗ |
| cytoscape-cxtmenu | 右键上下文菜单 | ✗ |
| cytoscape-edgehandles | 边创建交互 | ✗ |
| cytoscape-automove | 自动移动节点 | ✗ |
| cytoscape-compound-drag-and-drop | 复合节点拖拽 | ✗ |
| cytoscape-view-utilities | 视图工具 | ✗ |
| cytoscape-navigator | 缩略图导航 | ✗ |

**可借鉴方案：**
- **cytoscape-cose-bilkent**：比 fcose 更高质量的力导向布局，支持约束
- **cytoscape-elk**：Eclipse Layout Kernel，支持多种高质量层次布局策略
- **cytoscape-navigator**：内置缩略图导航面板，比本项目的 `getThumbnail()` 更完善
- **cytoscape-cxtmenu**：右键上下文菜单，增强交互（本项目已有 ContextMenu.tsx 但非 cytoscape 扩展）
- **cytoscape-popper**：节点 tooltip/弹出层，用于显示详细信息
- **Compound nodes**：Cytoscape 原生支持复合节点（父节点包含子节点），可用于聚类可视化

**本项目差距：**
- 未使用 compound nodes 实现聚类（当前聚类是通过替换节点为 ClusterNode 实现）
- 未使用 navigator 扩展（当前缩略图功能较简单）
- 布局扩展选择有限（仅 dagre + fcose）

---

### 2.6 vis-network

**架构特点：**
- HTML Canvas 渲染（非 SVG/HTML 元素）
- 内置物理模拟引擎（基于 Barnes-Hut 的力导向）
- DataSet 数据绑定模式（响应式数据更新）
- 内置聚类支持

**关键聚类设计：**
```javascript
// 自动聚类：节点数超过阈值时自动聚类
network.cluster(options)
// 手动聚类：选择节点进行聚类
network.clusterByConnection(nodeId, options)
// 聚类展开
network.openCluster(clusterId)
```

**可借鉴方案：**
- **Canvas 渲染**：对于大规模图（>5000节点），Canvas 渲染性能优于 SVG。Cytoscape 默认使用 Canvas，但本项目可进一步优化渲染策略
- **内置聚类 API**：vis-network 的聚类是原生功能，支持 `clusterByConnection`/`clusterByHubsize`/`clusterByData` 等多种聚类方式
- **物理引擎参数化**：所有物理参数可配置（引力、斥力、阻尼等），用户可微调布局效果

**本项目差距：**
- 聚类策略固定（目录→文件→函数三级），缺少按连接数/数据属性等维度聚类
- 物理参数不可用户调节

---

### 2.7 Gephi

**架构特点：**
- Java + OpenGL 渲染引擎，支持百万节点
- 基于 NetBeans Platform 的模块化架构（66 个模块）
- API/SPI 分离：API 提供功能，SPI 定义扩展点
- 多线程设计：图操作通过锁保护，UI 非阻塞
- Model-Controller 模式（无 View 组件）
- 核心图数据结构在独立仓库 [graphstore](https://github.com/gephi/graphstore)

**关键大规模处理策略：**

| 策略 | 实现 | 效果 |
|------|------|------|
| OpenGL 渲染 | 原生 GPU 加速 | 百万节点实时渲染 |
| 多线程 | 图锁+后台任务 | 布局/过滤/拖拽并行 |
| 空间索引 | graphstore 内置索引 | 快速查询 |
| 过滤系统 | Filter API + SPI | 实时缩小可见范围 |
| 分区/排名着色 | Appearance API | 多维视觉编码 |
| 工作区隔离 | 多 Workspace 独立模型 | 并行分析不同视图 |

**关键设计模式：**
- **Lookup 机制**：类似依赖注入，通过 `Lookup.getDefault().lookup(ServiceClass)` 获取单例，`lookupAll(SPI.class)` 发现所有实现
- **Persistence Provider**：每个模块可注册自己的持久化逻辑，项目文件格式可扩展
- **Controller/Model 分离**：Controller 是单例入口（含 setter），Model 含数据（含 getter），每 Workspace 独立

**可借鉴方案：**
- **多 Workspace 模型**：支持同时打开多个图视图，各自独立配置（布局/过滤/聚类深度）。本项目当前仅支持单一图视图
- **Appearance API 模式**：统一的"分区着色"和"排名着色"抽象，将颜色/尺寸编码与数据维度解耦。本项目的 heatmap 模式可升级为此模式
- **Filter SPI 模式**：过滤器作为可插拔扩展，用户可自定义过滤逻辑。本项目当前过滤选项固定
- **图锁机制**：在多线程环境下保证图结构一致性。本项目在 Worker 中操作 headless cytoscape 时需要类似保护
- **模块化 API/SPI**：将布局/过滤/统计/导出等功能定义为 SPI，允许插件扩展

**本项目差距：**
- 无多 Workspace 支持
- 颜色/尺寸编码维度有限，缺少统一的 Appearance 抽象
- 过滤器不可扩展
- 无 OpenGL/WebGL 渲染选项

---

### 2.8 CodeSee

**架构特点：**
- VS Code 扩展 + Web 平台
- 代码地图（Code Maps）：将代码库结构可视化为交互式地图
- 自动跟踪代码变更，映射到地图
- 支持代码审查中标注变更范围

**可借鉴方案：**
- **代码地图概念**：将代码库视为"地理地图"，使用空间隐喻帮助理解。目录=区域，文件=建筑，函数=房间
- **变更映射**：将 git diff 映射到图谱上的高亮区域，直观展示变更影响范围
- **入职导向**：为新人提供"导览路线"，按依赖顺序逐步展示代码结构

**本项目差距：**
- 无 git diff 变更映射
- 无"导览路线"功能
- 代码地图的空间隐喻不够强（当前是抽象图布局）

---

### 2.9 Sourcegraph

**架构特点：**
- 跨仓库代码搜索（基于文本索引+代码智能）
- 精确代码导航（跳转定义、查找引用）
- 代码智能（LSP 集成，支持多种语言）
- Web UI + API

**可借鉴方案：**
- **跨仓库依赖追踪**：将依赖关系扩展到仓库级别，展示微服务间的调用关系
- **精确代码导航**：在图谱中点击节点直接跳转到源码位置（本项目已有 `SourceOpenEvent` 但可增强）
- **搜索驱动导航**：搜索代码→定位到图谱中的对应节点

**本项目差距：**
- 仅支持单仓库分析
- 代码导航仅限于打开文件，缺少精确的符号级跳转

---

## 3. 关键技术主题研究

### 3.1 大规模图谱（10万-1000万节点）数据结构和算法优化策略

**Gephi 的 graphstore 核心策略：**
- **列式存储**：节点/边的属性按列存储（类似列式数据库），提高缓存命中率
- **双向索引**：节点→边和边→节点双向索引，O(1) 查找邻接关系
- **区间索引**：对数值属性建立区间索引，支持范围查询
- **写时复制**：修改操作创建副本，保证读操作一致性

**Web 端可行策略（分级处理）：**

| 节点规模 | 策略 | 技术方案 |
|----------|------|----------|
| < 2,000 | 全量渲染 | Cytoscape 直接渲染 |
| 2,000 - 10,000 | 聚类+虚拟视口 | 渐进聚类 + SpatialIndex 剔除 |
| 10,000 - 100,000 | 多级聚类+WASM布局 | 层次聚类 + GraphViz WASM |
| 100,000+ | 服务器端预处理 | 预计算布局+增量加载 |

**关键数据结构优化：**
1. **CSR (Compressed Sparse Row)**：边存储使用 CSR 格式，内存紧凑、缓存友好
2. **四叉树/八叉树**：替代均匀网格空间索引，自适应密度变化
3. **差分更新**：仅传输变更的节点/边，而非全量刷新
4. **分层 LOD 数据**：预计算不同缩放级别的图数据（宏观/中观/微观）

### 3.2 宏观与微观视图的切换和布局策略

**Gephi 的策略：**
- Overview → Filter → Zoom-in → Detail 四级交互
- 过滤器实时缩小可见范围，而非切换数据集
- 布局在过滤后的子图上运行

**npmgraph 的策略：**
- 折叠/展开子树（`collapse` 参数）
- 颜色编码区分层级（`color=moduleType`）
- 尺寸编码反映重要性（`sizing`）

**推荐策略（适用于本项目）：**

```
宏观视图（缩放 < 0.15）
  → 仅显示目录级聚类节点
  → 节点大小 = 子节点数量
  → 边粗细 = 聚合边权重
  → 颜色 = 模块类型/健康度

中观视图（0.15 < 缩放 < 0.5）
  → 显示文件级聚类节点
  → 部分展开的目录显示子文件
  → 边显示主要依赖关系

微观视图（缩放 > 0.5）
  → 显示函数/类级节点
  → 完整边信息
  → 代码详情tooltip
```

**布局切换策略：**
- 宏观：径向布局（concentric）或力导向（cose）— 展示整体结构
- 中观：层次布局（dagre）— 展示依赖方向
- 微观：增量力导向 — 保持上下文，局部调整

### 3.3 节点展开/折叠/聚类的交互设计

**各项目交互对比：**

| 项目 | 展开方式 | 折叠方式 | 聚类方式 |
|------|----------|----------|----------|
| npmgraph | 点击节点 | URL 参数 | 按子树折叠 |
| vis-network | `openCluster()` | `cluster()` | 按连接/数据 |
| Gephi | 过滤器缩小范围 | 过滤器扩大范围 | Appearance 分区 |
| Cytoscape | compound 节点展开 | compound 节点折叠 | 扩展支持 |

**推荐交互设计（适用于本项目）：**

1. **双击展开/折叠**：双击聚类节点展开显示子节点，再次双击折叠
2. **右键菜单**：提供"展开到X层"、"折叠到目录级"、"仅展开此节点"等选项
3. **拖拽聚类**：聚类节点可拖拽，子节点跟随移动（compound nodes）
4. **渐进展开动画**：展开时子节点从聚类节点位置向外扩散，有动画过渡
5. **上下文保留**：展开/折叠时保持其他节点位置不变，仅局部重新布局
6. **面包屑导航**：显示当前展开路径（`src/ > components/ > GraphPanel.tsx`）

### 3.4 LOD (Level of Detail) 策略

**本项目已有 LOD 常量：**
```typescript
LOD = {
  MINIMAL_THRESHOLD_SMALL: 0.15,   // 小图最小细节阈值
  MINIMAL_THRESHOLD_MEDIUM: 0.25,  // 中图最小细节阈值
  MINIMAL_THRESHOLD_LARGE: 0.35,   // 大图最小细节阈值
  COMPACT_THRESHOLD_SMALL: 0.4,
  COMPACT_THRESHOLD_MEDIUM: 0.55,
  COMPACT_THRESHOLD_LARGE: 0.7,
  MINIMAL_NODE_SIZE: 8,
  COMPACT_NODE_SIZE: 16,
  MINIMAL_EDGE_WIDTH: 0.5,
  COMPACT_EDGE_WIDTH: 1,
  COMPACT_FONT_SIZE: 6,
  TRANSITION_DURATION_MS: 200,
}
```

**Gephi 的 LOD 策略：**
- OpenGL LOD：根据缩放级别切换渲染细节（节点形状、标签、边）
- 标签密度控制：自动避免标签重叠，仅显示重要节点标签
- 边简化：远距离时仅显示重要边，隐藏次要边

**推荐增强：**

| 缩放级别 | 节点 | 边 | 标签 |
|----------|------|-----|------|
| < 0.1 | 8px 圆点 | 隈藏 | 隐藏 |
| 0.1 - 0.25 | 16px 圆点 | 0.5px 线 | 仅聚类节点标签 |
| 0.25 - 0.5 | 正常大小+形状 | 1px 线 | 文件级标签 |
| > 0.5 | 正常大小+形状+图标 | 完整线+箭头 | 全部标签 |

### 3.5 虚拟滚动和增量渲染技术

**本项目已有实现：**
- `VirtualViewportController`：基于 `SpatialIndex`（均匀网格）的视口剔除
- 视口变化时通过 `requestAnimationFrame` 节流更新
- 节点/边的 `display` 属性切换（`element`/`none`）

**改进方向：**

1. **四叉树空间索引**：替换均匀网格
   - 当前：`SpatialIndex` 使用固定 cellSize=200 的均匀网格
   - 改进：使用四叉树，自适应节点密度
   - 效果：密集区域细分查询，稀疏区域粗略查询

2. **增量数据加载**：仅加载视口内+预加载区域的数据
   - 当前：全量数据加载到 cytoscape，仅控制 display 属性
   - 改进：分批加载/卸载数据，减少内存占用
   - 效果：支持更大图（10万+节点）

3. **离屏 Canvas 预渲染**：将即将进入视口的节点预渲染到离屏 Canvas
   - 效果：减少首次进入视口时的渲染延迟

4. **WebGL 渲染层**：对于超大规模图，使用 WebGL 替代 Canvas 2D
   - 效果：GPU 加速，支持 10万+节点实时渲染

### 3.6 布局算法选择

**各项目布局算法对比：**

| 算法 | 来源 | 适用规模 | 特点 | 本项目支持 |
|------|------|----------|------|-----------|
| CoSE | Cytoscape | < 500 | 力导向，简单快速 | ✓ |
| fCoSE | iVis-at-Bilkent | < 2000 | 改进力导向，约束支持 | ✓ |
| CoSE-Bilkent | iVis-at-Bilkent | < 2000 | 高质量力导向 | ✗ |
| Dagre | dagre.js | < 5000 | 层次布局（TB/LR） | ✓ |
| ELK | Eclipse | < 10000 | 多策略层次布局 | ✗ |
| Cola | Cola.js | < 2000 | 约束力导向 | ✗ |
| sfdp | GraphViz | < 100000 | 多级力导向（大规模） | ✗ |
| OpenOrd | Gephi | < 1000000 | 优化大规模力导向 | ✗ |
| Yifan Hu | Gephi | < 1000000 | 多级力导向+合并 | ✗ |

**推荐布局选择策略：**

```
节点数 < 50       → CoSE（快速力导向）
节点数 50-200     → fCoSE（高质量力导向）
节点数 200-500    → fCoSE 或 Dagre（视图模式决定）
节点数 500-2000   → Dagre（层次）或 Grid fallback
节点数 2000-5000  → Grid fallback 或 sfdp (WASM)
节点数 > 5000     → sfdp (WASM) 或多级聚类+局部布局
```

**本项目当前策略（LayoutController.ts）：**
- `> GRID_FALLBACK_NODE_THRESHOLD (5000)` → Grid 布局
- `> LARGE_NODE_THRESHOLD (500)` 且 cose/fcose → 降级为 dagre
- 这与推荐策略基本一致，但缺少 sfdp 等大规模布局选项

### 3.7 颜色编码和视觉层次

**各项目颜色编码维度：**

| 项目 | 维度1 | 维度2 | 维度3 | 维度4 |
|------|-------|-------|-------|-------|
| npmgraph | 模块类型 | 巴士因子 | 版本过时 | 维护评分 |
| Gephi | 分区（类别） | 排名（数值） | 自定义 | - |
| 本项目 | 节点类型 | 不稳定性 | 代码行数 | 复杂度 |

**推荐颜色编码体系：**

1. **节点类型色**（已有）：function/class/variable/module/interface/type 各有颜色
2. **健康度色**（已有）：instability/lines/complexity heatmap
3. **社区/聚类色**（新增）：按社区检测结果着色，展示模块边界
4. **变更状态色**（新增）：git diff 状态（新增/修改/删除/未变）
5. **层级深度色**（新增）：按目录深度渐变着色

**视觉层次策略：**
- **尺寸编码**：节点大小 ∝ fan-in/fan-out 度数（影响力大的节点更大）
- **边粗细**：边粗细 ∝ 调用频率/依赖强度
- **透明度**：次要节点/边降低透明度，突出主要结构
- **形状编码**：不同节点类型使用不同形状（已有：rectangle/diamond/ellipse/hexagon）

### 3.8 性能优化策略

**各项目性能策略对比：**

| 策略 | Gephi | Cytoscape | vis-network | 本项目 |
|------|-------|-----------|-------------|--------|
| GPU 加速 | OpenGL | Canvas 2D | Canvas 2D | Canvas 2D |
| 多线程 | Java 线程 | - | - | Web Worker |
| WASM | - | - | - | ✗ |
| 空间索引 | graphstore | - | Barnes-Hut | 均匀网格 |
| 增量渲染 | ✓ | ✓ | ✓ | ✓ (虚拟视口) |
| 布局加速 | 多级算法 | - | Barnes-Hut | Worker+headless |
| 缓存 | - | - | - | DiagramCache+ClusterCache |

**推荐性能优化路线：**

**短期（1-2周）：**
1. 空间索引升级：均匀网格 → 四叉树
2. 布局 Worker 增强：增加超时恢复、多 Worker 并行
3. 边聚合优化：减少聚合边的计算量

**中期（1-2月）：**
1. WASM 布局引擎集成（hpcc-js-wasm GraphViz）
2. 增量数据加载（视口驱动的数据分批加载/卸载）
3. WebGL 渲染层（对于 >5000 节点的场景）

**长期（3-6月）：**
1. 服务器端预计算布局（对于 >10万节点）
2. 多 Worker 并行布局（将图分区，各 Worker 处理一部分）
3. 差分更新协议（仅传输变更数据）

---

## 4. 当前项目现状评估

### 4.1 已有优势

| 能力 | 实现质量 | 对标项目 |
|------|----------|----------|
| 渐进聚类 | ★★★★☆ | Gephi 的多级聚类 |
| 社区检测 | ★★★☆☆ | Gephi 的 Statistics API |
| 虚拟视口 | ★★★☆☆ | vis-network 的 Canvas 剔除 |
| Web Worker 布局 | ★★★☆☆ | hpcc-js-wasm 的 Worker+WASM |
| 多视图模式 | ★★★★★ | 独有优势（9种视图模式） |
| 热图编码 | ★★★☆☆ | npmgraph 的多维颜色编码 |
| 路径查找 | ★★★★☆ | Gephi 的 Tools API |
| 循环检测 | ★★★★☆ | dependency-cruiser 的规则验证 |
| 影响分析 | ★★★★☆ | CodeSee 的变更映射 |
| 图表缓存 | ★★★☆☆ | Gephi 的 Workspace 模型 |

### 4.2 主要差距

| 差距 | 严重程度 | 对标项目 | 改进方向 |
|------|----------|----------|----------|
| 无 WASM 布局引擎 | 中 | hpcc-js-wasm | 集成 GraphViz WASM |
| 空间索引效率 | 中 | d3-force Barnes-Hut | 升级为四叉树 |
| 无 compound nodes | 高 | Cytoscape.js 原生 | 使用复合节点实现聚类 |
| 无多 Workspace | 低 | Gephi | 多图视图并行 |
| 无 URL 状态持久化 | 中 | npmgraph | 深度链接支持 |
| 颜色编码维度有限 | 中 | npmgraph/Gephi | 扩展 Appearance API |
| 无 WebGL 渲染 | 中 | Gephi OpenGL | WebGL 渲染层 |
| 无增量数据加载 | 高 | - | 视口驱动分批加载 |
| 无 ELK 布局 | 低 | Cytoscape ELK 扩展 | 添加 cytoscape-elk |
| 无缩略图导航 | 低 | Cytoscape navigator | 添加 navigator 扩展 |

---

## 5. 优化建议与实施路线

### 5.1 高优先级（P0）

#### 5.1.1 Compound Nodes 聚类重构

**现状**：聚类通过替换节点为 `ClusterNode` 对象实现，展开/折叠时需要重建图数据。

**改进**：使用 Cytoscape 原生 compound nodes（父节点包含子节点），实现：
- 展开/折叠仅切换 `display` 属性，无需重建数据
- 聚类节点可拖拽，子节点跟随移动
- 子节点位置在聚类节点内自动布局

**实施步骤**：
1. 修改 `DataController.updateData()` 将聚类节点创建为 compound parent
2. 修改 `ProgressiveClusterStrategy` 输出 compound 结构而非 ClusterNode 替换
3. 展开/折叠通过 `node.children()` 的 display 切换实现
4. 聚类节点内自动布局使用 `cose` 或 `grid`

#### 5.1.2 四叉树空间索引

**现状**：`SpatialIndex.ts` 使用固定 cellSize=200 的均匀网格。

**改进**：实现自适应四叉树，密集区域细分、稀疏区域粗分。

**实施步骤**：
1. 实现四叉树数据结构（insert/query/remove/update）
2. 替换 `VirtualViewportController` 中的 `SpatialIndex`
3. 添加节点密度自适应分裂阈值
4. 性能测试对比

#### 5.1.3 增量数据加载

**现状**：全量数据加载到 Cytoscape，仅通过 `display` 属性控制可见性。

**改进**：视口驱动的数据分批加载/卸载，支持 10万+ 节点。

**实施步骤**：
1. 将原始图数据存储在 `graphStore`（不在 Cytoscape 中）
2. `VirtualViewportController` 监听视口变化，计算可见范围
3. 仅将可见范围+预加载区域的节点/边添加到 Cytoscape
4. 视口移出时移除不可见节点（保留位置缓存）
5. 添加数据加载/卸载的动画过渡

### 5.2 中优先级（P1）

#### 5.2.1 WASM 布局引擎集成

**改进**：集成 `@hpcc-js/wasm-graphviz`，提供 GraphViz 布局选项（dot/neato/sfdp/fdp）。

**实施步骤**：
1. 安装 `@hpcc-js/wasm-graphviz` 依赖
2. 在 `LayoutController` 中添加 WASM 布局路径
3. 将图数据序列化为 dot 语言格式
4. 调用 `Graphviz.load().then(g => g.dot(dotStr))` 获取 SVG
5. 解析 SVG 提取节点位置，应用到 Cytoscape
6. 在 Worker 中运行 WASM 布局

**适用场景**：
- sfdp 布局：适合 1000-100000 节点的大规模力导向
- dot 布局：适合层次结构展示
- neato 布局：适合中等规模力导向

#### 5.2.2 URL 状态持久化

**改进**：将视图状态编码到 URL hash，支持分享和书签。

**URL 参数设计**：
```
#view=dependencies&layout=dagre&cluster=2&expand=src__components&focus=node123&theme=dark&heatmap=instability
```

**实施步骤**：
1. 定义 URL 参数 schema
2. 在 `graphStore` 中添加 URL 序列化/反序列化
3. 监听 `hashchange` 事件同步状态
4. 状态变更时更新 URL hash

#### 5.2.3 扩展颜色编码体系

**改进**：增加社区/聚类着色、变更状态着色、层级深度着色。

**实施步骤**：
1. 在 `HeatmapMode` 类型中添加 `community`/`diff`/`depth` 模式
2. 在 `StyleController` 中实现新的着色逻辑
3. 社区着色：使用 `detectCommunities` 结果分配颜色
4. 变更着色：集成 git diff 数据
5. 深度着色：按目录深度渐变

#### 5.2.4 cytoscape-elk 布局扩展

**改进**：添加 ELK 布局扩展，提供更高质量的层次布局。

**实施步骤**：
1. 安装 `cytoscape-elk` 依赖
2. 在 `LayoutController.buildLayoutOptions()` 中添加 ELK 选项
3. 在 `LayoutType` 中添加 `'elk'` 类型
4. 配置 ELK 布局参数（layered/square/stress/mrtree 等算法）

### 5.3 低优先级（P2）

#### 5.3.1 cytoscape-navigator 缩略图导航

**改进**：使用 `cytoscape-navigator` 扩展替代当前简单的 `getThumbnail()` 实现。

#### 5.3.2 多 Workspace 支持

**改进**：支持同时打开多个图视图，各自独立配置。

#### 5.3.3 WebGL 渲染层

**改进**：对于超大规模图（>5000节点），使用 WebGL 渲染替代 Canvas 2D。

#### 5.3.4 规则引擎增强

**改进**：扩展 `RuleDefinition` 类型，支持更丰富的路径匹配和条件组合（借鉴 dependency-cruiser）。

---

## 附录：项目技术栈对比

| 维度 | 本项目 | Cytoscape | Gephi | vis-network | d3-force |
|------|--------|-----------|-------|-------------|----------|
| 语言 | TS | JS | Java | JS | JS |
| 渲染 | Canvas 2D | Canvas 2D | OpenGL | Canvas 2D | 用户定义 |
| 布局 | cose/fcose/dagre | 70+扩展 | 10+算法 | Barnes-Hut | Verlet |
| 聚类 | 渐进三级 | compound | Appearance | 内置API | - |
| 空间索引 | 均匀网格 | - | graphstore | Barnes-Hut | 四叉树 |
| Worker | ✓ headless cy | - | Java线程 | - | - |
| WASM | ✗ | - | - | - | - |
| 缓存 | Diagram+Cluster | - | Workspace | - | - |
| 状态管理 | zustand | - | Model | DataSet | - |
| 框架 | React | 无 | NetBeans | 无 | 无 |

---

*报告生成时间：2026-09-20*
*基于对各项目 GitHub 仓库、官方文档和架构文件的深度分析*