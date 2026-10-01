# Intent — dsh-codegraph-visualizer v0.2.0 增强迭代

## 目标

对 dsh-codegraph-visualizer 插件进行全方位升级增强，聚焦工具栏整合重构、多代适配器架构、响应式布局、代码重构和生态兼容性。

## 背景与动机

- 项目当前版本 v0.2.0，4173 单元测试全部通过，构建成功
- Toolbar.tsx 有 443 行，右侧分析组有 14 个按钮平铺，UX 差且屏幕空间浪费
- graphStore.ts 1331 行、routes.ts 1209 行，职责过多需拆分
- 需要兼容 DSH v0.1.7 和 v0.2.0（多代适配器架构）
- 需要兼容网页端与桌面端
- 需要兼容 Better Sidebar 和 dsh-remote-web-ui 标签页

## 范围

### 本次循环包含

1. **工具栏按钮整合重构** — 分析组 14 个按钮整合为分组下拉菜单，响应式折叠
2. **多代适配器架构增强** — 版本检测 + API 差异适配层
3. **响应式布局增强** — 窄屏/标签页/侧边栏适配
4. **graphStore.ts 拆分** — 按功能域拆分为多个 slice
5. **routes.ts 拆分** — 按功能域拆分路由模块
6. **dsh-remote-web-ui 兼容性** — 标签页兼容协议适配

### 本次循环不包含

- WebGL 渲染层（中期升级方向，本次不涉及）
- 新数据库构建（已有 SQLite + IndexedDB 足够）
- 3D 视图（P2 优先级，本次不涉及）
- AI 辅助解读（依赖 LLM 能力，本次不涉及）

## 约束

- ESM only，`.ts` 扩展名导入
- Host/Client 双端隔离
- Branded Types 防止 ID 混用
- Zustand + persist 状态管理
- Cytoscape.js 渲染引擎
- scoped() logger，不直接 console
- i18n via t()
- cg- CSS 前缀
- 测试覆盖率 >= 85%
- 兼容 DSH v0.1.7 和 v0.2.0

## 成功标准

- 所有现有测试继续通过
- 新增代码有对应测试
- typecheck 和 lint 零错误
- 构建成功
- 工具栏按钮数量减少 50%+（通过分组整合）
- 窄屏（<768px）下工具栏可用
- Chrome DevTools MCP 视觉验证通过