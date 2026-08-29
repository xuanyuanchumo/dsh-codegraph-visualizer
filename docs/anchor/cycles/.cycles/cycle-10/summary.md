# Cycle-10: DSH Client Bundle 集成 + 现代化 UI + 性能优化

## 目标

将 dsh-codegraph-visualizer 插件从 host-only 工具插件升级为完整的 DSH web 集成插件：
1. 实现 DSH 官方 `dsh.client` 声明，让 GraphPanel 出现在 DSH web UI 中
2. 优化可视化交互页面为现代化美观界面，适配 DSH 主题
3. 性能优化：批量更新、requestAnimationFrame、增量渲染
4. 保证与 DSH 官方规范和热门插件兼容

## 技术决策

### DSH Client Bundle 机制

通过研究 DSH 官方包（dsh-client-ui-theme, dsh-client-ui-conversation, dsh-client-modules），确认了 client bundle 的声明和构建方式：

- **`dsh.client` 声明**：在 `package.json` 的 `dsh` 字段下声明 `{ platform: "web", inject: [...], immediately?: true }`
- **`exports["./client"]`**：必须用 `"default"` 键（不是 `"import"`），指向构建好的 client bundle
- **Slot 注册**：`ctx.slots.register(key, spec)` 注册到 SlotMap key
- **`shell.overlay`**：`kind: 'list'`, `scope: 'root'` 的 additive 浮层，可以注册多个条目

### 主题系统

DSH 使用 `--dsw-*` CSS 变量作为主题 token，支持 light/dark/system 三种模式。我们通过 `--cg-*` 自定义变量映射到 `--dsw-*`，并提供 fallback 值。

### 性能优化

- **CytoscapeRenderer**：`cy.batch()` 包装批量操作、`requestAnimationFrame` 延迟布局、增量添加/移除元素（替代全量 `cy.json()`）
- **GraphPanel**：`React.memo` 包装、`useMemo` 缓存计算值、`useCallback` 稳定回调

## 变更清单

### package.json
- 添加 `dsh.client` 声明（`platform: "web"`, `inject: ["@deepseek-ai/dsh-client-runtime"]`）
- 添加 `exports["./client"]`（`"default": "./dist/client/index.js"`）
- 添加 `build:client` 脚本（tsdown 构建 client bundle，外部化 react/react-dom/cordis）
- 更新 `build` 脚本（包含 client 构建）
- 更新 `typecheck` 脚本（包含 client typecheck）

### src/client/index.ts（重写）
- 从骨架升级为真正的 client 入口
- 注册 GraphPanel 到 `shell.overlay` slot（additive 浮层）
- 监听 `codegraph/graph/updated` 事件触发 store 更新
- 本地声明合并 `ctx.slots`（兼容无 dsh-client-runtime 类型的环境）

### src/client/styles.css（新建）
- DSH `--dsw-*` 主题变量映射（`--cg-*` 自定义变量 + fallback）
- 现代化 UI：玻璃态背景、圆角、阴影、过渡动画
- 完整的组件样式：工具栏、搜索栏、布局按钮、过滤器、导出菜单
- 节点详情面板样式
- 折叠/展开 FAB 样式
- Loading/error/empty 状态样式

### src/client/renderer/CytoscapeRenderer.ts（优化）
- **批量更新**：所有多元素操作用 `cy.batch()` 包装
- **rAF 布局**：`applyLayout` 用 `requestAnimationFrame` 延迟执行，取消未完成的 rAF
- **增量更新**：`updateData` 改为增量添加/移除元素（维护 `currentNodes`/`currentEdges` Map），替代全量 `cy.json()`
- **CSS 变量主题**：`getThemeColors()` 从 DOM 读取 `--cg-*` CSS 变量，支持动态主题切换
- **`updateTheme()`**：运行时主题切换，无需重建 Cytoscape 实例
- **`getSelectedNodeData()`**：获取选中节点的完整数据
- **文本换行**：节点标签 `text-wrap: 'wrap'`, `text-max-width: '80px'`
- **清理**：`destroy()` 取消 rAF、清空 Map

### src/client/GraphPanel.tsx（优化）
- **React.memo**：包装组件避免不必要重渲染
- **useMemo**：缓存 `statsText` 和 `panelClassName`
- **节点详情面板**：点击节点显示详情（类型、文件、行号、ID）
- **折叠/展开**：可折叠为 48x48 圆形 FAB
- **主题切换**：调用 `renderer.updateTheme()` 实现运行时切换
- **接口类型过滤**：添加 interface 类型选项
- **样式导入**：导入 `./styles.css`

## 验证结果

### typecheck
- Host typecheck：✅ 通过
- Client typecheck：✅ 通过

### 单元测试
- 34 tests：✅ 全部通过

### Lint
- oxlint：✅ 无 warning/error

### 构建
- Host bundle：`dist/index.js` 10.57 kB
- Client bundle：`dist/client/index.js` 18.36 kB + `dist/client/index.css` 7.96 kB

### E2E 验证
- DSH web 启动：✅ 成功（`dsh web: http://127.0.0.1:3082`）
- `dsh.client` 声明识别：✅ 页面中包含 `codegraph-visualizer/client.js?rev=219a3b09fb6a`
- Client bundle URL 注入：✅ `__DSH_BOOT__.entries` 中包含我们的 client 模块
- 插件配置正确：✅ `dsh --dump-config` 显示 `dsh-codegraph-visualizer` 在配置树中

## 代码图谱分析

用 `codegraph index` 索引本项目：166 nodes, 329 edges, 22 files。

关键调用链：
```
apply (src/index.ts) → createGraphTools (src/tools.ts) → summarizeGraph (src/tools.ts)
```

## 下一步

- 在浏览器中验证 GraphPanel 的实际渲染（需要 DSH 进程持续运行）
- 实现 ConversationNode 集成（在对话流中渲染图谱）
- 添加更多布局算法（concentric, breadthfirst）
- 实现图谱缩略图和小地图
- 添加拖拽和缩放交互优化