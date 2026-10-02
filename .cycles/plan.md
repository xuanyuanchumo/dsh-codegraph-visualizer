# 计划文档 (Plan.md) — dsh-codegraph-visualizer v0.2.0

## 1. 任务清单

### 1.1 高优先级任务 (P0)

| ID | 任务 | 预估时间 | 依赖 | 验证方法 |
|----|------|----------|------|----------|
| T01 | 工具栏按钮整合重构 | 2h | 无 | 视觉验证 |
| T02 | 多代适配器架构增强 | 1.5h | 无 | 单元测试 |
| T03 | 测试 mock 修复 | 1h | 无 | pnpm run test |
| T04 | 响应式布局优化 | 1.5h | T01 | 视觉验证 |

### 1.2 中优先级任务 (P1)

| ID | 任务 | 预估时间 | 依赖 | 验证方法 |
|----|------|----------|------|----------|
| T05 | graphStore.ts 拆分 | 2h | 无 | 单元测试 |
| T06 | routes.ts 拆分 | 1.5h | 无 | 集成测试 |
| T07 | drizzle-orm 引入 | 1h | T06 | 构建验证 |

### 1.3 低优先级任务 (P2)

| ID | 任务 | 预估时间 | 依赖 | 验证方法 |
|----|------|----------|------|----------|
| T08 | 用户旅程验证 | 1h | T01-T04 | E2E 测试 |
| T09 | 文档更新 | 0.5h | 无 | 文档审查 |

---

## 2. 实施步骤

### 2.1 工具栏整合重构 (T01)

#### 步骤 1: 创建 ToolbarDropdown 组件
**文件**: `src/client/components/toolbar/ToolbarDropdown.tsx`
```typescript
interface ToolbarDropdownProps {
  items: DropdownItem[];
  triggerContent: React.ReactNode;
  triggerClassName?: string;
}
```

#### 步骤 2: 重构 Toolbar.tsx
**文件**: `src/client/components/Toolbar.tsx`
- 将 14 个分析/质量按钮整合为 3 个下拉菜单
- 添加响应式折叠逻辑
- 保持常驻按钮 ≤12 个

#### 步骤 3: 更新工具栏配置
**文件**: `src/client/components/toolbarConfig.ts`
- 添加分组配置
- 添加响应式断点配置

#### 验证
- 视觉验证：工具栏按钮数量 ≤12
- 功能验证：所有下拉菜单正常工作
- 响应式验证：窄屏下自动折叠

---

### 2.2 多代适配器架构 (T02)

#### 步骤 1: 扩展 FeatureFlags
**文件**: `src/host/compat/FeatureFlags.ts`
```typescript
export interface FeatureFlags {
  supportsSlotsApi: boolean;
  supportsSidebarRightTabs: boolean;
  supportsRemoteWebUi: boolean;
  supportsBetterSidebar: boolean;
  // 新增
  supportsWebServerV2: boolean;
  supportsWorkspaceRegistryV2: boolean;
}
```

#### 步骤 2: 更新 ApiCompatLayer
**文件**: `src/host/compat/ApiCompatLayer.ts`
- 添加 v0.2.0 API 适配
- 添加类型差异处理

#### 步骤 3: 更新 package.json
**文件**: `package.json`
- 确保 peerDependencies 支持多版本

#### 验证
- 单元测试：FeatureFlags 测试
- 集成测试：DSH v0.1.7/v0.2.0 兼容测试

---

### 2.3 测试 mock 修复 (T03)

#### 步骤 1: 更新 GraphPanel.test.tsx
**文件**: `tests/component/GraphPanel.test.tsx`
- 添加缺失的 mock 导出
- 使用 `importOriginal` 模式

#### 步骤 2: 运行测试验证
```bash
pnpm run test
```

#### 验证
- 测试通过率 ≥95%
- 无 mock 相关错误

---

### 2.4 响应式布局优化 (T04)

#### 步骤 1: 更新 tokens.css
**文件**: `src/client/styles/tokens.css`
```css
:root {
  --cg-breakpoint-compact: 640px;
  --cg-breakpoint-narrow: 768px;
  --cg-breakpoint-medium: 1024px;
}
```

#### 步骤 2: 更新 layout.css
**文件**: `src/client/styles/layout.css`
- 添加容器查询
- 添加断点适配

#### 步骤 3: 更新 GraphPanel.tsx
**文件**: `src/client/GraphPanel.tsx`
- 添加响应式尺寸检测
- 添加布局适配逻辑

#### 验证
- 视觉验证：侧边栏/标签页/全屏模式
- 响应式验证：不同断点下布局正确

---

### 2.5 graphStore.ts 拆分 (T05)

#### 步骤 1: 创建 slices 目录
**文件**: `src/client/store/slices/`
- `graphDataSlice.ts`
- `viewModeSlice.ts`
- `sessionSlice.ts`
- `expandSlice.ts`
- `workspaceSlice.ts`
- `pathFocusSlice.ts`
- `filterSlice.ts`
- `analysisSlice.ts`
- `panelLodSlice.ts`

#### 步骤 2: 更新 graphStore.ts
**文件**: `src/client/store/graphStore.ts`
- 导入所有 slices
- 保持向后兼容

#### 验证
- 单元测试：所有 slices 测试
- 集成测试：Store 功能测试

---

### 2.6 routes.ts 拆分 (T06)

#### 步骤 1: 创建 routes 目录
**文件**: `src/host/routes/`
- `dataRoutes.ts`
- `analysisRoutes.ts`
- `statusRoutes.ts`
- `controlRoutes.ts`
- `shared.ts`

#### 步骤 2: 更新 index.ts
**文件**: `src/index.ts`
- 导入拆分后的路由

#### 验证
- 集成测试：路由功能测试
- 构建验证：无导入错误

---

### 2.7 drizzle-orm 引入 (T07)

#### 步骤 1: 创建 schema.ts
**文件**: `src/host/db/schema.ts`
- 定义 nodes 表
- 定义 edges 表
- 定义索引

#### 步骤 2: 更新 GraphRepository.ts
**文件**: `src/host/db/GraphRepository.ts`
- 使用 drizzle-orm 查询
- 保持 SQLite 兼容

#### 验证
- 构建验证：无类型错误
- 单元测试：查询功能测试

---

### 2.8 用户旅程验证 (T08)

#### 步骤 1: 运行 E2E 测试
```bash
pnpm run test:e2e
```

#### 步骤 2: 验证旅程覆盖率
- J1-J45 覆盖率 100%
- 视觉效果验证

#### 验证
- E2E 测试全部通过
- 无视觉回归

---

## 3. 时间线

| 阶段 | 任务 | 开始 | 结束 | 状态 |
|------|------|------|------|------|
| Build | T01 工具栏整合 | 10-02 | 10-02 | 待开始 |
| Build | T02 适配器架构 | 10-02 | 10-02 | 待开始 |
| Build | T03 测试修复 | 10-02 | 10-02 | 待开始 |
| Build | T04 响应式布局 | 10-02 | 10-02 | 待开始 |
| Build | T05 Store 拆分 | 10-02 | 10-02 | 待开始 |
| Build | T06 Routes 拆分 | 10-02 | 10-02 | 待开始 |
| Build | T07 drizzle-orm | 10-02 | 10-02 | 待开始 |
| Test | T08 旅程验证 | 10-02 | 10-02 | 待开始 |

---

## 4. 风险缓解

| 风险 | 缓解措施 |
|------|----------|
| 工具栏变更影响 UX | 提供引导 Tour，渐进式发布 |
| DSH 版本兼容问题 | 多代适配器架构，特征标志 |
| 测试失败 | 及时修复 mock，保持测试覆盖 |
| 性能退化 | 性能门禁，持续监控 |

---

## 5. 交付清单

- [ ] intent.md 已创建
- [ ] spec.md 已创建
- [ ] plan.md 已创建
- [ ] 工具栏整合完成
- [ ] 多代适配器架构完成
- [ ] 测试修复完成
- [ ] 响应式布局完成
- [ ] graphStore 拆分完成
- [ ] routes 拆分完成
- [ ] drizzle-orm 引入完成
- [ ] 用户旅程验证完成
- [ ] 构建成功
- [ ] lint 通过
- [ ] 测试通过
- [ ] 文档更新
- [ ] 代码提交

---

## 6. 验证命令

```bash
# 类型检查
pnpm run typecheck

# 构建
pnpm run build

# Lint
pnpm run lint

# 测试
pnpm run test

# E2E 测试
pnpm run test:e2e

# 性能门禁
pnpm run perf-gate
```