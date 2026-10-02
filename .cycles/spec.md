# 规格文档 (Spec.md) — dsh-codegraph-visualizer v0.2.0

## 1. 架构概览

### 1.1 当前架构

```
src/
├── index.ts                    # Host 入口
├── client/
│   ├── index.ts                # Client 入口
│   ├── GraphPanel.tsx          # 主面板组件
│   ├── components/
│   │   ├── Toolbar.tsx         # 工具栏 (443行)
│   │   ├── toolbarConfig.ts    # 工具栏配置
│   │   └── ...
│   ├── store/
│   │   └── graphStore.ts       # Zustand Store (1331行)
│   └── hooks/                  # React Hooks
├── host/
│   ├── routes.ts               # 路由 (1209行)
│   ├── compat/                 # 多代适配器
│   └── db/                     # 数据库层
└── adapters/                   # 数据适配器
```

### 1.2 目标架构

```
src/
├── index.ts                    # Host 入口 (简化)
├── client/
│   ├── index.ts                # Client 入口
│   ├── GraphPanel.tsx          # 主面板组件
│   ├── components/
│   │   ├── toolbar/
│   │   │   ├── Toolbar.tsx     # 精简工具栏
│   │   │   ├── ToolbarConfig.tsx # 配置分离
│   │   │   └── ToolbarDropdown.tsx # 下拉菜单
│   │   └── ...
│   ├── store/
│   │   ├── graphStore.ts       # 主 Store (精简)
│   │   ├── slices/
│   │   │   ├── graphDataSlice.ts
│   │   │   ├── viewModeSlice.ts
│   │   │   ├── sessionSlice.ts
│   │   │   └── ...
│   │   └── selectors/          # 选择器
│   └── hooks/
├── host/
│   ├── routes/
│   │   ├── dataRoutes.ts       # 数据路由
│   │   ├── analysisRoutes.ts   # 分析路由
│   │   └── statusRoutes.ts     # 状态路由
│   ├── compat/
│   │   ├── ApiCompatLayer.ts   # API 兼容层
│   │   ├── FeatureFlags.ts     # 特征标志
│   │   └── HostVersionDetector.ts
│   └── db/
│       ├── schema.ts           # drizzle-orm schema
│       └── GraphRepository.ts  # 数据仓库
└── adapters/
    ├── CodeGraphAdapter.ts
    └── drizzle/                # drizzle 配置
```

---

## 2. 功能规格

### 2.1 工具栏整合重构

#### 当前状态
- 右侧分析组：14 个按钮平铺
- 总按钮数：20+
- 问题：视觉拥挤，新用户学习曲线陡峭

#### 目标状态
- 常驻按钮：≤12 个
- 分组下拉菜单：
  - **分析组**: 调用链、循环检测、影响分析、继承分析、路径查找
  - **质量组**: 健康评分、规则检测、热点分析、God Module、核心函数、死代码
  - **视图组**: 缩略图、图例、导入、搜索、过滤面板、Tour

#### UI 规格
```
[工作区选择器] | [节点统计] | [布局] | [视图模式] | [层级] | [更多▼] | [主题] | [刷新]
```

### 2.2 多代适配器架构

#### 版本检测
```typescript
interface HostVersionInfo {
  version: string;
  major: number;
  minor: number;
  patch: number;
  isPreview: boolean;
}
```

#### API 差异适配
| API | v0.1.7 | v0.2.0 | 适配策略 |
|-----|--------|--------|----------|
| webServer | `ctx.webServer` | `ctx.webServer` | 类型差异处理 |
| workspaceRegistry | 可选 | 必选 | 条件注入 |
| slots | 直接访问 | 需要注入 | 适配层 |

#### 特征标志
```typescript
interface FeatureFlags {
  supportsSlotsApi: boolean;
  supportsSidebarRightTabs: boolean;
  supportsRemoteWebUi: boolean;
  supportsBetterSidebar: boolean;
}
```

### 2.3 响应式布局

#### 断点定义
```css
/* tokens.css */
--cg-breakpoint-compact: 640px;
--cg-breakpoint-narrow: 768px;
--cg-breakpoint-medium: 1024px;
```

#### 布局适配
| 集成入口 | 容器尺寸 | 布局策略 |
|----------|----------|----------|
| 侧边栏 | 300-500px | 垂直压缩，工具栏折叠 |
| 标签页 | 800-1200px | 标准布局 |
| 全屏 | 1200px+ | 完整布局 |

### 2.4 数据库层优化 (drizzle-orm)

#### Schema 定义
```typescript
// src/host/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  path: text('path'),
  // ...
});

export const edges = sqliteTable('edges', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  target: text('target').notNull(),
  type: text('type').notNull(),
  // ...
});
```

#### 查询优化
- 分页查询使用 `limit/offset`
- 批量查询使用 `where in` 分批处理
- 缓存层保持不变

---

## 3. 测试规格

### 3.1 测试分层

| 层 | 类型 | 工具 | 覆盖率目标 |
|----|------|------|-----------|
| 单元 | 服务/适配器 | vitest | ≥90% |
| 组件 | UI 组件 | vitest + RTL | ≥80% |
| 集成 | DSH 宿主 | vitest | ≥85% |
| E2E | 真实环境 | Playwright | 100% 旅程 |

### 3.2 Mock 维护策略

#### 问题
测试文件中的 mock 经常缺失新导出，导致测试失败

#### 解决方案
使用 `vi.mock` 的 `importOriginal` 模式，自动合并缺失的 mock：
```typescript
vi.mock('../../src/client/hooks/index.ts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // 只 mock 需要自定义的方法
    useGraphRenderer: vi.fn(() => ({ ... })),
  };
});
```

### 3.3 用户旅程验证

| 旅程 | 优先级 | 验证方法 |
|------|--------|----------|
| J1 仓库导入 | P0 | E2E |
| J2 图谱浏览 | P0 | E2E |
| J3 符号搜索 | P0 | E2E |
| J4 调用链追踪 | P0 | E2E |
| J9 实时更新 | P0 | E2E |
| J12 异常恢复 | P0 | E2E |
| J13 插件生命周期 | P0 | E2E |

---

## 4. API 规格

### 4.1 工具栏 API

```typescript
interface ToolbarProps {
  // 布局配置
  layout: LayoutType;
  dagreRankDir: RankDir;
  clusterDepth: number;
  
  // 视图配置
  viewMode: ViewMode;
  graphType: GraphType;
  filterType: GraphNode['type'] | 'all';
  
  // 面板控制
  panelControls: PanelControls;
  
  // 回调
  onExport: (format: ExportFormat) => void;
  onThemeToggle: () => void;
  onRefresh: () => void;
}
```

### 4.2 适配器 API

```typescript
interface ApiCompatLayer {
  // 版本检测
  detectHostVersion(ctx: Context): HostVersionInfo;
  
  // 特征标志
  createFeatureFlags(version: HostVersionInfo): FeatureFlags;
  
  // API 适配
  adaptWebServer(ctx: Context): WebServerService;
  adaptWorkspaceRegistry(ctx: Context): WorkspaceRegistry;
  
  // 路由适配
  adaptRoute(path: string, handler: RouteHandler): RouteHandler;
}
```

---

## 5. 数据规格

### 5.1 状态结构

```typescript
interface GraphState {
  // 数据层
  nodes: GraphNode[];
  edges: GraphEdge[];
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  
  // 视图层
  layout: LayoutType;
  viewMode: ViewMode;
  theme: ThemeType;
  
  // 交互层
  selectedNodeId: NodeId | null;
  highlightedNodeIds: NodeId[];
  expandedNodeIds: Set<string>;
  
  // 分析层
  ruleViolations: RuleViolation[];
  healthScore: HealthScore | null;
}
```

### 5.2 数据库 Schema

```sql
-- nodes 表
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  repo_id TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- edges 表
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  type TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_nodes_repo ON nodes(repo_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
```

---

## 6. UI/UX 规格

### 6.1 视觉设计

- **工具栏高度**: 40px（紧凑模式）/ 48px（标准模式）
- **按钮尺寸**: 32x32px（图标按钮）/ 自动宽度（下拉菜单）
- **间距**: 4px（小）/ 8px（中）/ 16px（大）

### 6.2 交互规范

- **悬停**: 显示 tooltip
- **点击**: 触发操作
- **双击**: 展开/聚焦
- **右键**: 上下文菜单

### 6.3 可访问性

- 所有按钮有 `aria-label`
- 下拉菜单有 `aria-haspopup="menu"`
- 键盘导航支持
- 焦点管理

---

## 7. 性能规格

### 7.1 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 首屏 TTI | <1s | Lighthouse |
| 图谱渲染 FPS | ≥30 @ 1000节点 | Playwright |
| 搜索响应 | <500ms | vitest |
| 内存占用 | <200MB | Chrome DevTools |

### 7.2 优化策略

- **按需加载**: 节点/边分页加载
- **缓存**: LRU + IndexedDB
- **增量布局**: 只计算新增节点
- **虚拟化**: 大图视口裁剪

---

## 8. 兼容性规格

### 8.1 DSH 版本兼容

| 版本 | API 差异 | 适配方式 |
|------|----------|----------|
| v0.1.7 | 旧类型 | 适配器 |
| v0.2.0 | 新类型 | 适配器 |

### 8.2 浏览器兼容

| 浏览器 | 版本 | 支持 |
|--------|------|------|
| Chrome | 90+ | ✅ |
| Edge | 90+ | ✅ |
| Firefox | 90+ | ✅ |
| Safari | 15+ | ✅ |

### 8.3 插件兼容

| 插件 | 关系 | 兼容方式 |
|------|------|----------|
| dsh-better-sidebar | 注入依赖 | 标签页兼容 |
| dsh-remote-web-ui | 可选 | 标签页协议 |
| dsh-codegraph | 可选前置 | optionalPlugins |
| dsh-tool-lens | 可选前置 | optionalPlugins |