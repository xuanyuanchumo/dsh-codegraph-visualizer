# DSH 升级研究报告：插件 API 规范、生态集成与 ORM 选型

> **研究目标**：为 dsh-codegraph-visualizer v0.2.0 升级提供决策依据
> **研究日期**：2026-10-01
> **研究方法**：context7 MCP（deepseek-harness / dsh-better-sidebar 文档库）+ WebFetch（Drizzle/Kysely 官方文档）+ 本地源码分析
> **数据来源**：context7 `/deepseek-ai/deepseek-harness`（8118 代码片段，高声誉）、context7 `/omdsh-dev/dsh-better-sidebar`（1284 代码片段，高声誉）、Drizzle ORM 官方文档、Kysely 官方文档、本地项目源码

---

## 一、执行摘要

| 研究维度 | 核心结论 |
|----------|----------|
| **v0.1.7 → v0.2.0 差异** | 新增 gen2 工具（bootstrap/incremental）、workspaceRegistry、betterSidebar、spotlight、remoteWebUi、multiWorkspace 6 项能力；工具名映射 + fallback 链已就绪 |
| **插件生命周期** | 基于 Cordis 框架，`ctx.effect()` 注册副作用返回 disposer，`ctx.plugin()` 挂载子插件返回 Fiber，`fiber.dispose()` 手动销毁 |
| **better-sidebar 集成** | `registerTab()` 返回 disposer，通过 `inject=['betterSidebar']` + `import type {} from 'dsh-better-sidebar'` 触发类型合并；需 guard disposer 返回值 |
| **ORM 选型** | **首选 Drizzle ORM**（`drizzle-orm/node-sqlite`），可直接包裹现有 `DatabaseSync` 实例，零迁移成本，35k+ stars，v1.0 RC |
| **适配策略** | 已实现 HostVersionDetector + FeatureFlags + ApiCompatLayer 三层兼容；peerDependencies 双版本范围 `^0.1.7-rc.2 \|\| ^0.2.0-rc.2` 已就绪 |

---

## 二、DSH v0.1.7 vs v0.2.0 API 差异清单

### 2.1 版本代际划分

本项目 `src/host/compat/HostVersionDetector.ts:28-32` 将宿主版本划分为三代：

| 代际 | 版本范围 | 判定逻辑 |
|------|----------|----------|
| **gen1** | `0.1.x`（含 0.1.7-rc.2） | `major === 0 && minor >= 1 && minor < 2` |
| **gen2** | `0.2.x+`（含 0.2.0-rc.2） | `major === 0 && minor >= 2` 或 `major >= 1` |
| **unknown** | 无法解析 | 默认按 gen2 处理（当前目标），但关闭 incrementalBootstrap 和 remoteWebUi |

### 2.2 特性开关差异（FeatureFlags）

来源：`src/host/compat/FeatureFlags.ts:21-55`

| 特性开关 | gen1 (0.1.x) | gen2 (0.2.x+) | unknown | 说明 |
|----------|:-----------:|:------------:|:-------:|------|
| `incrementalBootstrap` | ❌ false | ✅ true | ❌ false | **gen2 新增**：`codegraph_bootstrap` + `codegraph_incremental` 增量构建 |
| `workspaceRegistry` | ❌ false | ✅ true | ✅ true | **gen2 新增**：多工作区注册表 API |
| `sessionsApi` | ✅ true | ✅ true | ✅ true | 会话 API（两代均有） |
| `betterSidebar` | ❌ false | ✅ true | ✅ true | **gen2 新增**：dsh-better-sidebar 深度集成 |
| `spotlight` | ❌ false | ✅ true | ✅ true | **gen2 新增**：聚光灯/聚焦联动 |
| `remoteWebUi` | ❌ false | ✅ true | ❌ false | **gen2 新增**：远程 Web UI 标签页协议 |
| `mcpServer` | ✅ true | ✅ true | ✅ true | MCP Server（两代均有） |
| `rateLimiting` | ✅ true | ✅ true | ✅ true | 限流（两代均有） |
| `treeSitterWasm` | ✅ true | ✅ true | ✅ true | Tree-sitter WASM 解析 |
| `healthScore` | ✅ true | ✅ true | ✅ true | 架构健康评分 |
| `rulesCheck` | ✅ true | ✅ true | ✅ true | 规则引擎检测 |
| `multiWorkspace` | ❌ false | ✅ true | ✅ true | **gen2 新增**：多工作区并行 |

**gen2 破坏性新增（6 项）**：`incrementalBootstrap`、`workspaceRegistry`、`betterSidebar`、`spotlight`、`remoteWebUi`、`multiWorkspace`。

### 2.3 工具名映射差异（ApiCompatLayer）

来源：`src/host/compat/ApiCompatLayer.ts:23-47`

| 逻辑工具名 | gen1 实际名 | gen2 实际名 | fallback 链 |
|------------|------------|------------|-------------|
| `codegraphStatus` | `codegraph_status` | 同 gen1 | → codegraphGraph → codegraphQuery |
| `codegraphGraph` | `codegraph_graph` | 同 gen1 | → codegraphStatus → codegraphQuery |
| `codegraphQuery` | `codegraph_query` | 同 gen1 | → codegraphStatus → codegraphGraph |
| `codegraphFiles` | `codegraph_files` | 同 gen1 | — |
| `codegraphImpact` | `codegraph_impact` | 同 gen1 | — |
| `codegraphInit` | `codegraph_init` | 同 gen1 | — |
| `codegraphSync` | `codegraph_sync` | 同 gen1 | — |
| `codegraphCallers` | `codegraph_callers` | 同 gen1 | — |
| `codegraphCallees` | `codegraph_callees` | 同 gen1 | — |
| **`codegraphBootstrap`** | **null（不存在）** | **`codegraph_bootstrap`** | → codegraphInit |
| **`codegraphIncremental`** | **null（不存在）** | **`codegraph_incremental`** | → codegraphSync → codegraphInit |
| `lensAnalyze` | `lens_analyze` | 同 gen1 | — |
| `lensImpact` | `lens_impact` | 同 gen1 | — |

**关键破坏性变更**：gen2 新增 `codegraph_bootstrap` 和 `codegraph_incremental` 两个工具，gen1 中不存在。本项目已通过 fallback 链降级到 `codegraph_init` / `codegraph_sync`。

### 2.4 版本检测机制

来源：`src/host/compat/HostVersionDetector.ts:71-89`

检测优先级（三源探测）：
1. **ctx 属性探测**：`ctx.hostVersion` → `ctx.version` → `ctx.app.version` → `ctx.runtime.version`
2. **环境变量**：`DSH_HOST_VERSION` → `DSH_VERSION` → `CODEARTS_HOST_VERSION`
3. **工具名探测**：存在 `codegraph_incremental`/`codegraph_bootstrap` → 判定 gen2；存在 `codegraph_status`/`codegraph_graph` → 判定 gen1

### 2.5 官方兼容性检查机制

来源：context7 `packages/boot/app-boot/src/plugin-compatibility.ts`

DSH 运行时通过 `evaluatePluginCompatibility()` 检查插件 `peerDependencies`：
- 仅检查 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 模式
- `workspace:^` / `workspace:~` / `workspace:*` 解析为当前运行时版本
- 使用 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`
- 不兼容时输出警告 + `dsh plugin allow-version <package@version> --dsh-version <exact> --accept-risk` 豁免命令

本项目 `package.json:42-48` peerDependencies 已正确设置双版本范围：
```json
"@deepseek-ai/dsh-client-connection": "^0.1.7-rc.2 || ^0.2.0-rc.2",
"@deepseek-ai/dsh-llm": "^0.1.7-rc.2 || ^0.2.0-rc.2",
"@deepseek-ai/dsh-session": "^0.1.7-rc.2 || ^0.2.0-rc.2",
"@deepseek-ai/dsh-tools": "^0.1.7-rc.2 || ^0.2.0-rc.2"
```

---

## 三、插件开发最佳实践要点

### 3.1 Cordis 插件生命周期（权威 API）

来源：context7 `/deepseek-ai/deepseek-harness` — `docs/user/develop/framework/index.md` + `docs/cordis-tutorial/02-lifecycle-and-effects.md`

| API | 签名 | 用途 | 清理语义 |
|-----|------|------|----------|
| `ctx.effect()` | `effect(setup: () => () => void, label?: string): void` | 注册副作用，返回 disposer | disposer 在插件卸载时自动调用 |
| `ctx.plugin()` | `plugin(child: (ctx: Context) => void): Fiber` | 挂载子插件，返回 Fiber 句柄 | 子插件随父插件卸载；可 `fiber.dispose()` 提前销毁 |
| `ctx.on()` | `on(event: string, handler: Function): void` | 注册事件监听 | 监听器在卸载时自动移除 |
| `ctx.emit()` | `emit(event: string, data: unknown): void` | 发射事件 | — |
| `fiber.dispose()` | `dispose(): Promise<void>` | 手动销毁插件实例 | 递归清理所有注册和子插件 |

**核心模式**：
```typescript
export function apply(ctx: Context) {
  // 1. 注册工具：用 ctx.effect 包裹，返回聚合 disposer
  ctx.effect(() => {
    const d1 = ctx.tools.register(toolA);
    const d2 = ctx.tools.register(toolB);
    return () => { d1(); d2(); };  // 聚合清理
  }, 'label');

  // 2. 注册定时器：在 effect 内创建，disposer 清理
  ctx.effect(() => {
    const timer = setInterval(() => {}, 1000);
    return () => clearInterval(timer);
  }, 'label');

  // 3. 事件监听：ctx.on 自动清理
  ctx.on('some-event', handler);
}
```

### 3.2 HostConnection RPC/Fetch API

来源：context7 `packages/client/connection/src/rpc.ts`

| API | 签名 | 返回 | 用途 |
|-----|------|------|------|
| `ctx.connection.rpc.handle()` | `handle(channel, handler)` | `() => Promise<void>` | 注册逻辑 RPC 处理器（async disposer） |
| `ctx.connection.rpc.intercept()` | `intercept('/api', matches, handler)` | `() => Promise<void>` | 拦截特定端点 RPC |
| `ctx.connection.fetch.register()` | `register(route)` | `() => Promise<void>` | 注册精确 Fetch 路由 |

**注意**：这三个 API 返回的是 **async disposer**（`() => Promise<void>`），与 `ctx.effect` 的同步 disposer 不同。需在 `ctx.effect` 内用 async IIFE 或手动管理。

### 3.3 客户端插槽层次结构

来源：context7 `docs/subsystems/slots.md`

```
root
├─ sidebar                    ← 左侧栏
│  ├─ sidebar.brand.mark / name
│  ├─ sidebar.panellist
│  ├─ sidebar.footer.action
│  ├─ sidebar.workspaces
│  └─ sidebar.settings
├─ main                       ← 主区域
│  ├─ main.conversation
│  │  ├─ conversation.session
│  │  │  └─ conversation.view
│  │  │     └─ conversation.chat.node
│  │  │        └─ tool.call.toolview
│  │  ├─ conversation.session.header
│  │  ├─ conversation.composer
│  │  └─ conversation.composer.bar
│  └─ plugins.item / bundle.config / row.config
├─ rightbar                   ← 右侧栏（本项目集成点）
│  └─ rightbar.session
│     ├─ sidebar.right.pane.tab       ← 标签页面板
│     │  └─ sidebar.right.tab.guide
│     ├─ sidebar.right.pane.tab.title
│     └─ sidebar.right.tab.menu.item
└─ shell.overlay              ← 全局覆盖层
```

**关键发现**：本项目 `package.json:118` 的 `client.inject` 包含 `@deepseek-ai/dsh-client-ui-sidebar-right`，对应 `rightbar.session → sidebar.right.pane.tab` 插槽树。子插槽仅在父插槽挂载时存在，可作为单一生命周期单元挂载/卸载。

### 3.4 九条红线（DSH 规范合规）

来源：本地 `docs/v0.2.0可行性评估与实现方案.md:21`

| 红线 | 说明 | 本项目合规状态 |
|------|------|---------------|
| 注册即 effect | 所有 `ctx.tools.register` 必须在 `ctx.effect` 内 | ✅ `src/index.ts:38-48` |
| waterfall 委托 | 异步操作不可裸调，需委托 | ✅ invokeUpstream 封装 |
| Branded ID | NodeId/EdgeId/RepoId 防混用 | ✅ `src/types/` |
| 声明合并事件 | 事件用 declare 合并类型 | ✅ |
| ESM only | `"type": "module"` + `.ts` 扩展名 | ✅ `package.json:5` |
| Host/Client 隔离 | tsconfig.host/client 分离编译 | ✅ |
| 能力缝三角色 | ctx.slots.inject 返回 disposer | ✅ |
| 配置显式化 | cordis.patch.yml 显式配置 | ✅ `cordis.patch.yml` |
| disposer 不丢弃 | 所有 disposer 必须保存并追踪 | ✅ |

---

## 四、dsh-better-sidebar 集成规范

### 4.1 集成入口

来源：context7 `/omdsh-dev/dsh-better-sidebar` — `README_EN.md` + `docs/external-plugin-guide.md`

```typescript
// 1. 类型合并触发（side-effect import）
import type {} from 'dsh-better-sidebar'

// 2. 声明 inject（与 package.json client.inject 配合）
export const inject = ['betterSidebar']

// 3. 在 apply 中注册
export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'codegraph:panel',
      title: 'Code Graph',
      component: ({ scope }) => <GraphPanel sessionId={scope.sessionId} />,
    })
  )
}
```

### 4.2 BetterSidebarService 完整 API

来源：context7 `/omdsh-dev/dsh-better-sidebar` — `docs/external-plugin-guide.md`（APIDOC）

| 方法 | 签名 | 返回 | 版本 | 用途 |
|------|------|------|------|------|
| `registerTab` | `(descriptor: TabDescriptor) => void` | **disposer** | — | 注册标签页类型 |
| `registerFileViewer` | `(descriptor: FileViewerDescriptor) => void` | **disposer** | — | 注册文件预览器 |
| `registerFileIcon` | `(descriptor: FileIconDescriptor) => void` | **disposer** | v0.19.0+ | 注册文件图标 |
| `getTabs` | `() => readonly TabDescriptor[]` | 快照 | — | 同步快照（useSyncExternalStore） |
| `getFileViewers` | `() => readonly FileViewerDescriptor[]` | 快照 | — | 同步快照 |
| `getTab` | `(id: string) => TabDescriptor \| undefined` | 查找 | — | 按 id 查找 |
| `isTabEnabled` | `(id: string) => boolean` | 检查 | v0.4.1+ | 标签页是否在设置中启用 |
| `isViewerEnabled` | `(id: string) => boolean` | 检查 | v0.4.1+ | 预览器是否启用 |
| `matchFileViewer` | `(path, head?) => FileViewerDescriptor \| undefined` | 匹配 | — | 按路径匹配预览器 |
| `openTab` | `(seed: OpenTabSeed, scope?) => void` | — | — | 打开标签页（去重 via dedupeKey） |
| `closeTab` | `(tabId, scope?) => void` | — | — | 关闭标签页（未知 id 严格 no-op） |
| `activateTab` | `(tabId, scope?) => void` | — | — | 激活标签页 |
| `updateTab` | `(tabId, patch) => void` | — | — | 更新 title/path/meta |
| `openFile` | `(scope, path, title?) => void` | — | — | 在编辑器中打开文件 |
| `subscribe` | `(listener) => () => void` | **disposer** | — | 订阅 registry 变化 |
| `subscribeState` | `(listener) => () => void` | **disposer** | — | 订阅快照变化 |
| `getSnapshot` | `() => SidebarSnapshot` | 快照 | — | 当前会话状态快照 |
| `fileIcon` | `(path, size) => ReactNode` | 图标 | v0.19.0+ | 文件图标解析器 |
| `folderIcon` | `(path, open, size) => ReactNode` | 图标 | — | 目录图标解析器 |
| `version` | `readonly string` | 版本 | — | 插件版本（如 '0.17.1'） |
| `features` | `readonly string[]` | 能力 | — | 能力列表 |

### 4.3 能力列表（features gating）

`features` 可能值（只增不删，唯一例外：v0.19.0 移除 `floatWindows`）：

```
'badge' | 'tabLifecycle' | 'updateTab' | 'openFile' | 'targetedOpen' |
'stateSubscription' | 'tabMeta' | 'pluginSettings' | 'urlTarget' |
'settingSelect' | 'fileIcons'
```

**用法**：`ctx.betterSidebar.features.includes('tabLifecycle')` 按能力门控。

### 4.4 TabDescriptor 关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 标签页类型 id（如 `'codegraph:panel'`） |
| `title` | `string` | 显示标题 |
| `icon` | `ReactNode` | 标签页图标 |
| `order` | `number` | 排序权重 |
| `single` | `boolean` | 单实例（≡ `dedupeKey: () => id`） |
| `dedupeKey` | `() => string` | 去重键函数（不设则每次 openTab 新开） |
| `component` | `({ tab, scope }) => ReactNode` | 渲染组件，接收 tab 和 scope（含 sessionId） |
| `createTab` | `function` | 自定义 tab 创建（cast entirely） |

### 4.5 集成注意事项（CLAUDE.md 已记录）

> `betterSidebar.registerTab()` may not return a disposer — must guard with `typeof dispose === 'function'` before calling

本项目已在 CLAUDE.md "Things the agent gets wrong" 中记录此陷阱。集成时必须：
```typescript
ctx.effect(() => {
  const dispose = ctx.betterSidebar.registerTab(descriptor);
  return () => { if (typeof dispose === 'function') dispose(); };
});
```

---

## 五、dsh-remote-web-ui 集成规范

### 5.1 标签页兼容协议

基于 DSH 客户端插槽层次（`rightbar.session → sidebar.right.pane.tab`）和本项目 `package.json:113-120` 的 `client.inject` 配置：

```json
"client": {
  "platform": "web",
  "inject": [
    "@deepseek-ai/dsh-client-connection",
    "@deepseek-ai/dsh-client-ui-slots",
    "@deepseek-ai/dsh-client-ui-sidebar-right",
    "dsh-better-sidebar"
  ]
}
```

**集成层次**：
1. `dsh-client-connection` — Host ↔ Client RPC/Fetch 通道（`HostConnectionRpc` / `HostConnectionFetch`）
2. `dsh-client-ui-slots` — 通用插槽注入能力（`ctx.slots.inject()` 返回 disposer）
3. `dsh-client-ui-sidebar-right` — 右侧栏插槽宿主（`rightbar.session` 子树）
4. `dsh-better-sidebar` — 标签页注册服务（`ctx.betterSidebar.registerTab()`）

### 5.2 remote-web-ui 特性开关

`FeatureFlags.remoteWebUi`：gen1 = false，gen2 = true，unknown = false。

在 unknown 版本下保守关闭，避免在不确定宿主能力时启用远程 UI 协议导致运行时错误。

### 5.3 标签页生命周期联动

- 子插槽仅在父插槽挂载时存在（`sidebar.right.pane.tab` 依赖 `rightbar.session`）
- 标签页注册是 **类型注册**（registerTab），实际打开通过 `openTab(seed)`
- `scope.sessionId` 贯穿标签页组件 → RPC 调用 → Host 端数据查询，实现会话隔离

---

## 六、ORM 框架推荐和理由

### 6.1 候选框架对比

| 维度 | Drizzle ORM | Kysely | Prisma | node:sqlite 原生 |
|------|-------------|--------|--------|-----------------|
| **类型** | ORM + RQB | Query Builder | ORM + 代码生成 | 无 |
| **node:sqlite 支持** | ✅ 原生 `drizzle-orm/node-sqlite` | ✅ 有 dialect | ⚠️ 需 better-sqlite3 | ✅ 原生 |
| **包裹现有 DatabaseSync** | ✅ `drizzle({ client: sqlite })` | ⚠️ 需适配 | ❌ 需 schema | — |
| **运行时依赖** | 轻量 | **0 运行时依赖** | 重（引擎 + 生成客户端） | 0 |
| **Bundle 体积** | 小 | 小 | 大 | 0 |
| **类型安全** | ✅ 编译时 | ✅✅ 最强（编译时 + 精确推断） | ✅ 生成时 | ❌ |
| **迁移工具** | drizzle-kit | kysely-codegen | prisma migrate | 手写 |
| **GitHub Stars** | 35k+ | 14k+ | 40k+ | — |
| **npm 周下载** | 高 | 12M+ | 极高 | — |
| **许可证** | Apache-2.0 | MIT | Apache-2.0 | MIT |
| **DSH 插件环境** | ✅ 轻量、可包裹现有连接 | ✅ 0 依赖 | ❌ 太重、需代码生成步骤 | ✅ 已在用 |

### 6.2 推荐方案：Drizzle ORM（`drizzle-orm/node-sqlite`）

**首选理由**：

1. **零迁移成本**：可直接包裹现有 `DatabaseSync` 实例，无需改变连接管理
   ```typescript
   import { drizzle } from 'drizzle-orm/node-sqlite';
   import { DatabaseSync } from 'node:sqlite';

   // 复用现有连接池中的 DatabaseSync
   const sqlite = new DatabaseSync(dbPath, { readOnly: true });
   const db = drizzle({ client: sqlite });
   ```

2. **与本项目现有架构无缝衔接**：`src/adapters/CodeGraphAdapter.ts:39` 已用 `node:sqlite` 的 `DatabaseSync` 建立连接池（readOnly），Drizzle 可直接包裹池中连接

3. **DSH 插件环境友好**：
   - 跨量 bundle，不增加插件体积
   - 无需代码生成步骤（与 Prisma 不同），构建流程不变
   - 原生支持 `node:sqlite`（Node >= 22.5），与本项目 `engines.node: ">=22.19"` 兼容

4. **类型安全 + RQB**：提供 Relational Query API，可嵌套查询，减少手写 JOIN

5. **成熟度**：35k+ stars，v1.0 RC 即将发布，PlanetScale/Railway/Sentry 等生产背书

**备选方案：Kysely**

如果更看重 **0 运行时依赖** 和 **最强类型推断**（不想要 ORM 抽象），Kysely 是纯 query builder 的最佳选择。但需要自行适配 `node:sqlite` 的 `DatabaseSync` 到 Kysely 的 `Dialect` 接口，集成成本略高于 Drizzle。

**不推荐：Prisma**

在 DSH 插件环境中不推荐 Prisma：
- 需要代码生成步骤（`prisma generate`），增加构建复杂度
- 引擎 + 生成客户端 bundle 体积大
- 对 `node:sqlite` 原生支持不如 Drizzle（需走 better-sqlite3）

### 6.3 引入策略

```
阶段 1（可选，低风险）：在 CodeGraphAdapter 中引入 Drizzle 包裹现有 DatabaseSync
  - 不改变连接池管理
  - 不改变查询逻辑（先用 db.execute() 替代裸 prepare/all）
  - 获得类型安全的查询结果

阶段 2（按需）：定义 Drizzle schema，启用 RQB 嵌套查询
  - 为 codegraph.db 的 nodes/edges 表定义 schema
  - 用 RQB 替代手写 JOIN

阶段 3（按需）：引入 drizzle-kit 管理自有 schema迁移
  - 如果 v0.2.0 新增自有持久化（如规则配置、布局保存）
```

---

## 七、破坏性变更适配策略

### 7.1 已就绪的三层兼容架构

本项目已实现完整的三层版本兼容架构（`src/host/compat/`）：

```
HostVersionDetector (检测层)
    ↓ HostVersionInfo { generation: 'gen1' | 'gen2' | 'unknown' }
FeatureFlags (开关层)
    ↓ 12 个布尔开关，gen1/gen2/unknown 三套配置
ApiCompatLayer (API 层)
    ↓ ToolNameMapping + fallback 链
    ↓ resolveToolName / isToolAvailable / getAvailableToolName
```

### 7.2 适配策略矩阵

| 场景 | 策略 | 实现位置 |
|------|------|----------|
| **gen2 新工具不存在于 gen1** | fallback 链降级 | `ApiCompatLayer.ts:95-101` FALLBACK_CHAINS |
| **gen2 特性不可用于 gen1** | FeatureFlags 门控 | 调用方 `if (featureFlags.betterSidebar)` |
| **工具名变化** | ToolNameMapping 映射 | `ApiCompatLayer.ts:23-47` GEN1/GEN2_MAPPING |
| **版本无法检测** | 默认按 gen2 + 关闭高风险特性 | `HostVersionDetector.ts:87-88` + `FeatureFlags.ts:51-55` |
| **peerDependencies 不满足** | 双版本范围 `^0.1.7-rc.2 \|\| ^0.2.0-rc.2` | `package.json:42-48` |
| **宿主版本不兼容** | `dsh plugin allow-version` 豁免 | 官方机制，用户侧操作 |

### 7.3 升级 v0.2.0 时的适配清单

1. **peerDependencies 收窄**（当决定只支持 gen2 时）：
   ```json
   "@deepseek-ai/dsh-client-connection": "^0.2.0-rc.2"
   ```
   当前双版本范围可保留以支持平滑过渡。

2. **devDependencies 升级**：当前 `package.json:52-54` 锁定 `0.1.7-rc.2`，需升级到 `0.2.0-rc.2` 进行测试验证。

3. **dsh.hostVersion 收窄**（可选）：当前 `">=0.1.1-rc.2 <0.3.0"`，如只支持 gen2 可改为 `">=0.2.0-rc.2 <0.3.0"`。

4. **FeatureFlags 调整**：如果 v0.2.0 正式版有新的特性开关需求，在 `FeatureFlags.ts` 中新增字段和 gen2 配置。

5. **ToolNameMapping 调整**：如果 v0.2.0 正式版有新工具或重命名，在 `ApiCompatLayer.ts` 中更新映射和 fallback 链。

6. **better-sidebar 能力门控**：使用 `ctx.betterSidebar.features.includes('xxx')` 按能力门控，而非按版本号门控（更健壮）。

### 7.4 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| gen2 正式版 API 与 rc.2 不一致 | 工具名/特性可能变化 | 持续跟踪 context7 文档更新 |
| better-sidebar registerTab 不返回 disposer | 清理时 TypeError | `typeof dispose === 'function'` guard（已记录） |
| unknown 版本误判为 gen2 | 启用不支持的特性 | unknown 配置保守关闭 incrementalBootstrap/remoteWebUi |
| node:sqlite IN 子句参数上限 | 大节点列表查询失败 | 用 SQLITE.MAX_IN_PARAMS 分批（已记录） |

---

## 八、研究方法与数据来源

### 8.1 工具使用情况

| 工具 | 用途 | 结果 |
|------|------|------|
| context7 `resolve-library-id` | 搜索 DSH 相关库 | 找到 5 个库（deepseek-harness、website、desktop、market、better-sidebar） |
| context7 `query-docs` ×3 | 查询插件 API、better-sidebar API、版本兼容 | 获得权威代码片段和 APIDOC |
| WebFetch | 获取 Drizzle/Kysely 官方文档 | Drizzle node:sqlite 文档 ✅；Kysely 主页 ✅ |
| 本地源码分析 | 理解当前兼容层实现 | `src/host/compat/*`、`src/adapters/CodeGraphAdapter.ts`、`src/index.ts` |
| 本地文档分析 | 理解需求和可行性 | `docs/v0.2.0版本需求分析.md`、`docs/v0.2.0可行性评估与实现方案.md` |

### 8.2 不可用的工具

| 工具 | 原因 | 替代方案 |
|------|------|----------|
| webcrawl_search | startpage.com 超时 | 用 WebFetch 直接访问已知 URL |
| github_get_file_contents | 认证失败（Bad credentials） | 用 context7（已索引 GitHub 仓库内容） |

### 8.3 context7 库 ID 映射

| 库 ID | 代码片段数 | 声誉 | 用途 |
|-------|-----------|------|------|
| `/deepseek-ai/deepseek-harness` | 8118 | High | 主框架文档 |
| `/omdsh-dev/dsh-better-sidebar` | 1284 | High | 侧边栏插件 API |
| `/websites/deepseek-harness_github_io_deepseek-harness_en` | 1925 | High | 官方文档站 |
| `/anywhere-labs/deepseek-harness-desktop` | 611 | High | 桌面客户端 |
| `/dsh-market/dsh-market` | 38 | Medium | 插件市场 |

---

## 九、结论与建议

1. **版本兼容架构已就绪**：三层兼容（检测→开关→API 映射）+ 双版本 peerDependencies，可平滑支持 v0.1.7 和 v0.2.0。

2. **better-sidebar 集成路径清晰**：`inject=['betterSidebar']` + `registerTab()` + disposer guard，API 稳定且有 features gating 机制。

3. **ORM 选型明确**：Drizzle ORM（`drizzle-orm/node-sqlite`）可零成本包裹现有 `DatabaseSync`，是 DSH 插件环境下的最优选择。

4. **升级优先级**：
   - P0：升级 devDependencies 到 0.2.0-rc.2 进行兼容性验证
   - P1：在 better-sidebar 集成中加 disposer guard + features gating
   - P2：按需引入 Drizzle ORM 包裹现有 SQLite 连接
   - P3：收窄 peerDependencies/hostVersion（当决定放弃 gen1 支持时）