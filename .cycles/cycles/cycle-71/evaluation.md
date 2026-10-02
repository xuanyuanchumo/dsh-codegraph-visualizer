# Cycle-71 评估报告

**评估日期**: 2026-10-02  
**基线状态**: typecheck ✅, lint ✅, 4705 tests ✅, build ✅

---

## 综合评分

| 维度 | 评分 | P0 | P1 | P2 | P3 |
|------|------|----|----|----|----|
| 客户端 | 7.8/10 | 1 | 9 | 11 | 7 |
| Host 服务 | 7/10 | 1 | 12 | 24 | 15 |
| 测试体系 | 6.5/10 | 4 | 5 | 4 | 3 |
| **总计** | **7.1/10** | **6** | **26** | **39** | **25** |

---

## P0 问题清单（必须立即修复）

1. **VirtualViewportController.handleStructureChange 未通过 RAF 调度 updateVisibility** — 新增节点不会被索引直到下次视口变化 (`src/client/renderer/VirtualViewportController.ts`)
2. **HostVersionDetector unknown 降级失效** — 返回 `generation: 'gen2'` 而非 `'unknown'`，绕过 UNKNOWN_FLAGS 保守降级 (`src/host/compat/HostVersionDetector.ts:87-88`)
3. **组件测试 toBeTruthy 弱断言泛滥** — 39.4% (475/1206) 使用 toBeTruthy，17个文件占比>50% (`tests/component/`)
4. **FileSystemAdapter.ts 覆盖率极低** — 35.58%，核心数据通路 (`src/adapters/FileSystemAdapter.ts`)
5. **resource-exhaustion.spec.ts 4个 test.skip()** — 资源耗尽场景无实际测试 (`tests/e2e/resource-exhaustion.spec.ts`)
6. **J2 图谱浏览导航覆盖薄弱** — view-modes.spec.ts 仅5个测试，P0旅程覆盖不足 (`tests/e2e/view-modes.spec.ts`)

---

## P1 问题清单（高优先级）

### Host 服务
- dataRoutes 6个路由 handler 无 try-catch，异常时客户端永久挂起
- 后台异步操作不跟踪生命周期（controlRoutes IIFE + triggerBackgroundBuild）
- createGraphTools 无超时控制
- resolveDbPath 无安全验证，可通过 ?workspace= 读取任意路径
- tree-sitter 路由路径验证不一致
- ApiCompatLayer 无 gen3 映射

### 客户端
- GraphPanelInner 594行过于庞大
- useGraphActions 27次独立 store 订阅未使用 useShallow
- 工具栏按钮数量过多
- Worker URL 硬编码
- LeftPanelStack ruleViolations 类型不安全
- Cytoscape canvas 键盘不可访问
- ContextMenu 焦点管理缺失
- cg-collapse-fab 缺少 aria-expanded

### 测试
- routes.ts 覆盖率 44.55%
- 覆盖率门限未硬性阻断
- 缺少 setupFiles 配置
- GraphPanel.test.tsx 过度 mock

---

## 改进策略

采用 ponytail 原则：优先修复高影响、低复杂度的问题。P0 问题中 #1 和 #2 是一行代码修复，#3 是机械性替换，#4-6 需要编写测试。