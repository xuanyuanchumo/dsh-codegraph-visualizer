# DSH 升级研究报告：插件 API 规范、生态集成与 ORM 选型

> **⚠️ cycle-83 勘误与补正（2026-10-05）**
> 本文的**§二 2.2 特性开关**、**§二 2.4 版本检测**、**§二 2.5 兼容性检查**、**§五**、**§七**、**§九**
> 已按三棵树静态核验结果就地更正。核心勘误：
> - `spotlight` 与 `remoteWebUi` **不是 gen2 新能力，而是本项目发明的幻影服务键**（三树零命中），
>   已从代码与开关中删除，替代物分别是 `ctx.commandUi` 与 `remoteNarrow` DOM 标记。
> - `engines.dsh` 与 `dsh.manifestVersion` **是纯声明，无读取者**；唯一强制门是 peerDependencies。
> - DSH **不向插件暴露版本串**（4 个 ctx 候选 + 3 个 env 候选全 miss），
>   客户端只能按服务面定代（仅 `pluginNavigation`/`userQuestionPanels` 可区分 gen1/gen2）。
> - **不存在桌面客户端平台**；桌面端判别靠 `<html data-platform="darwin">` / `data-windows-titlebar`。
>
> **权威依据已独立成文**：`docs/research/dsh-多代API规范差异与兼容矩阵.md`（逐条带路径+行号+引用+置信度标注）。

> **研究目标**：为 dsh-codegraph-visualizer v0.2.0 升级提供决策依据
> **研究日期**：2026-10-01（cycle-83 于 2026-10-05 勘误）
> **研究方法**：context7 MCP（deepseek-harness / dsh-better-sidebar 文档库）+ WebFetch（Drizzle/Kysely 官方文档）+ 本地源码分析 + 本机 DSH 安装面静态核验
> **数据来源**：context7 `/deepseek-ai/deepseek-harness`（8118 代码片段，高声誉）、context7 `/omdsh-dev/dsh-better-sidebar`（1284 代码片段，高声誉）、Drizzle ORM 官方文档、Kysely 官方文档、本地项目源码、本机 asar 树 `<A>`/`<V>`/`<W>`

---

## 一、执行摘要

| 研究维度 | 核心结论 |
|----------|----------|
| **v0.1.7 → v0.2.0 差异** | 新增 gen2 工具（bootstrap/incremental）、workspaceRegistry、betterSidebar、multiWorkspace 4 项能力；工具名映射 + fallback 链已就绪。**⚠️ 本文原列的 `spotlight` / `remoteWebUi` 两项已在 cycle-83 被证伪为幻影服务，见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §2.3** |
| **插件生命周期** | 基于 Cordis 框架，`ctx.effect()` 注册副作用返回 disposer，`ctx.plugin()` 挂载子插件返回 Fiber，`fiber.dispose()` 手动销毁 |
| **better-sidebar 集成** | `registerTab()` 返回 disposer，通过 `inject=['betterSidebar']` + `import type {} from 'dsh-better-sidebar'` 触发类型合并；需 guard disposer 返回值 |
| **ORM 选型** | **首选 Drizzle ORM**（`drizzle-orm/node-sqlite`），可直接包裹现有 `DatabaseSync` 实例，零迁移成本，35k+ stars，v1.0 RC |
| **适配策略** | 已实现 HostVersionDetector + FeatureFlags + ApiCompatLayer 三层兼容；peerDependencies 双版本范围 `^0.1.7-rc.2 \|\| ^0.2.0-rc.2` 已就绪 |

---

## 二、DSH v0.1.7 vs v0.2.0 API 差异清单

### 2.1 版本代际划分

> **⚠️ cycle-83 更正**：本节的三代划分已收敛到单一真源 `src/shared/dshGeneration.ts`，
> 判定逻辑改为 `generationOfVersion(major, minor)`：`major >= 1` → gen3；`major !== 0` → unknown；
> `minor >= 3` → gen3；`minor === 2` → gen2；`minor === 1` → gen1；否则 unknown。
> 另新增 **gen3**（0.3.x 线，建模为 gen2 的前向兼容超集）。
> 权威判定与证据见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §3、§6。

| 代际 | 版本范围 | 判定逻辑 |
|------|----------|----------|
| **gen1** | `0.1.x`（含 0.1.7-rc.2） | `minor === 1` |
| **gen2** | `0.2.x`（含 0.2.0-rc.2） | `minor === 2` |
| **gen3** | `0.3.x` 及 `0.4.x`/`1.x`（前向兼容超集） | `minor >= 3` 或 `major >= 1` |
| **unknown** | 无法解析 / `major` 非 0 且非 1+ | 保守按 gen2 基线并扣留 `incrementalBootstrap` |

### 2.2 特性开关差异（FeatureFlags）

> **⚠️ cycle-83 更正**：`spotlight` 与 `remoteWebUi` 两个开关**已删除** —— 它们对应的服务键
> 在全机三棵树中都不存在（详见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §2.3）。
> 现状为 12 位：新增 `commandUi`（替代 `spotlight`，`ctx.commandUi` 两代都真实存在）
> 与 `remoteNarrow`（真实 `@linxin666/dsh-remote-web-ui` 的 DOM 标记）；
> `desktopPlatform` 的语义从「服务探针」改为「客户端 DOM 判定，宿主侧仅诊断转述」。

来源：`src/host/compat/FeatureFlags.ts`

| 特性开关 | gen1 (0.1.x) | gen2 (0.2.x+) | unknown | 说明 |
|----------|:-----------:|:------------:|:-------:|------|
| `incrementalBootstrap` | ❌ false | ✅ true | ❌ false | **gen2 新增**：`codegraph_bootstrap` + `codegraph_incremental` 增量构建 |
| `workspaceRegistry` | ❌ false | ✅ true | ✅ true | **gen2 新增**：多工作区注册表 API |
| `sessionsApi` | ✅ true | ✅ true | ✅ true | 会话 API（两代均有） |
| `betterSidebar` | ❌ false | ✅ true | ✅ true | **gen2 新增**：dsh-better-sidebar 深度集成 |
| ~~`spotlight`~~ | — | — | — | **cycle-83 删除（幻影）**；替代 = `commandUi` |
| ~~`remoteWebUi`~~ | — | — | — | **cycle-83 删除（幻影）**；替代 = `remoteNarrow` DOM 标记 |
| `mcpServer` | ✅ true | ✅ true | ✅ true | MCP Server（两代均有） |
| `rateLimiting` | ✅ true | ✅ true | ✅ true | 限流（两代均有） |
| `treeSitterWasm` | ✅ true | ✅ true | ✅ true | Tree-sitter WASM 解析 —— **Round 7 已从 `FeatureFlags` 删除**：本插件的解析跑在自己的宿主进程、用自家依赖 `tree-sitter-wasm`（`getWasmPath`），宿主既不能授予也不能收回该能力；该标志在每一代都写 `true` 且全仓无读取点（语义与实际相反）。取舍理由见 `docs/需求分析.md` §31.6 与 `src/host/compat/FeatureFlags.ts` 顶部注释 |
| `healthScore` | ✅ true | ✅ true | ✅ true | 架构健康评分 |
| `rulesCheck` | ✅ true | ✅ true | ✅ true | 规则引擎检测 |
| `multiWorkspace` | ❌ false | ✅ true | ✅ true | **gen2 新增**：多工作区并行 |

**gen2 破坏性新增（4 项）**：`incrementalBootstrap`、`workspaceRegistry`、`betterSidebar`、`multiWorkspace`。

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

来源：`src/host/compat/HostVersionDetector.ts`

检测优先级（三源探测，宿主侧）：
1. **ctx 属性探测**：`ctx.hostVersion` → `ctx.version` → `ctx.app.version` → `ctx.runtime.version`
2. **环境变量**：`DSH_HOST_VERSION` → `DSH_VERSION` → `CODEARTS_HOST_VERSION`
3. **工具名探测**：存在 `codegraph_incremental`/`codegraph_bootstrap` → 判定 gen2；存在 `codegraph_status`/`codegraph_graph` → 判定 gen1

> **⚠️ cycle-83 关键更正（CONFIRMED NEGATIVE）**：上述 4 个 ctx 候选键与 3 个 env 候选名
> 在 `@deepseek-ai` 全树 grep **零命中** —— DSH **不向插件 context 暴露任何版本串**，
> 且 `DSH_*` 环境变量只在宿主侧的 shell 执行层可见（浏览器半读不到 `DSH_PROFILE`）。
> 唯一权威版本源是 `@deepseek-ai/dsh/package.json` 的 `version`（由 `dsh-app-boot` 的
> `getDshRuntimeVersion()` 读取，插件侧拿不到）。
> ⇒ **运行时版本探测实际只靠第 3 条（工具名），全 miss 时降级为 `unknown` 保守表。**
> 客户端侧则只能按**服务面**定代：仅 `pluginNavigation` / `userQuestionPanels` 可区分 gen1/gen2
> （`slots`/`sidebarRightTabs`/`documentPreviews` 两代都有，不可作定代依据）。
> 证据见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §3。

### 2.5 官方兼容性检查机制

来源：`dsh-app-boot\lib\index.js:252-322 evaluatePluginCompatibility()`（本机 asar 树逐行核验）

DSH 运行时通过 `evaluatePluginCompatibility()` 检查插件 `peerDependencies`：
- 仅检查 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 模式
- `workspace:^` / `workspace:~` / `workspace:*` 解析为当前运行时版本
- 使用 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`
- 不兼容时输出警告 + `dsh plugin allow-version <package@version> --dsh-version <exact> --accept-risk` 豁免命令

> **⚠️ cycle-83 更正**：`engines.dsh` 与 `dsh.manifestVersion` **是纯声明，无人读取**
> （`dsh-package-manifest\README.md:93` 逐字「**Compatibility is declarative.**」）。
> 真正生效的**只有** peerDependencies 这一条门。
> 本项目现状（cycle-82 已清理死声明）：仅 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`、
> `@deepseek-ai/dsh-tools`、`react`、`react-dom` 五条，范围为
> `^0.1.7-rc.2 || ^0.2.0-rc.2 || ^0.3.0-rc.2`（实测拒绝 `0.1.7-rc.1`、`0.4.0`、`1.0.0`）。
> 详见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §6。

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

## 五、`@linxin666/dsh-remote-web-ui` 集成规范（cycle-83 重写）

> **本节前提已被证伪，全文重写。**
> 原文假设 DSH 提供一个名为 `remoteWebUI` 的 cordis 服务（带 `registerPanel`/`openPanel`/
> `subscribeState`/`getSnapshot`），本项目据此实现了 `RemoteWebUiIntegration.ts`。
> cycle-83 对 `<A>`（gen2）、`<V>`（gen1）、`<W>`（web profile 第三方插件树）三棵树做了
> `provide(` 静态扫描 + 真实 `ctx.get` 调用点双向确认：**`remoteWebUI` 这个键不存在**，
> 该集成是死代码，已删除。
> 权威裁决见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §2.3、§5.3。

### 5.1 真实存在的相关名字：`remoteWebUiPairing`（宿主侧）

`@linxin666/dsh-remote-web-ui\lib\index.js:697`
```js
const REMOTE_WEB_UI_PAIRING = "remoteWebUiPairing";
// Named lookup key sibling plugins pass to ctx.get.
```
消费方式（`@linxin666/dsh-client-ui-git-graph\lib\index.js:1345`、
`@linxin666/dsh-client-ui-skill-explorer\lib\index.js:60`）：
```js
const fromGet = typeof ctx.get === "function" ? ctx.get("remoteWebUiPairing", false) : void 0;
return (isPairingAccess(fromGet) ? fromGet : ctx.remoteWebUiPairing)?.isPairedDevice(request) === true;
```
⇒ 它是**宿主侧配对鉴权服务**，只回答「这个请求来自已配对设备吗」，
**没有** `registerPanel` / `openPanel` / `subscribeState` / `getSnapshot` 面。
本插件**不需要**它：图谱数据走自己的 HTTP 路由，鉴权由宿主既有中间件负责。

### 5.2 它到底提供了什么客户端面

本机安装版本 v0.4.4，路径
`C:\Users\86156\.dsh\profiles\desktop\node_modules\@linxin666\dsh-remote-web-ui\`。
其客户端半**只注册一个 slot**：
- `lib\client.js:5552` `ctx.slots.inject("sidebar.footer.action", …)`
- `lib\client.js:5556` `ctx.slots.register({…})`

`sidebar.footer.action` 是 `list` 型（`scope: 'root'`），**可叠加**：
本项目 `SlotsFallback.ts` 也注册该席位，两者**并排出现，不冲突**。
它**不提供任何 panel/tab 注册 API**，因此不存在「标签页兼容协议」可对接。

### 5.3 它对本项目的真实影响 = 版面适配（不是集成通道）

它是移动窄屏适配插件，激活时留下可探测的 DOM 标记：

| 标记 | 位置 |
|---|---|
| `const ACTIVE_CLASS = "dsh-remote-portrait";` | `lib\client.js:4155` |
| `const ADAPT_CSS_ID = "dsh-remote-web-ui/mobile-adapt.css";` | `lib\client.js:4153` |
| `` const STYLE_SELECTOR = `style[data-plugin-css="${ADAPT_CSS_ID}"]`; `` | `lib\client.js:4167` |
| `const COMPACT_CLASS = "dsh-remote-compact-picker";` | `lib\client.js:4175` |
| `const HEADER_RESERVE_VAR = "--dsh-remote-header-actions-reserve";` | `lib\client.js:4183` |

激活路径 `apply()`（`lib\client.js:4364-4375`）：
```js
if (active) return;
active = true;
forgetAbsentSelectors();
document.body.classList.add(ACTIVE_CLASS);
…
ensureAdaptStyle();
```
移动判定（`lib\client.js:4217`）：
```js
matchMedia("(orientation: portrait)").matches
  && matchMedia("(pointer: coarse)").matches
  && window.innerWidth < 1100
```

⇒ 本项目把它当作**版面维度**处理：`PlatformProbe.detectHostPlatform().isRemoteNarrow`
（读 body class 或 style 标签），并在 `responsive.css` 用 `body.dsh-remote-portrait`
三条规则做窄屏适配。**不注册任何 slot，不假设任何 API。**

### 5.4 标签页生命周期（本项目实际采用的真路径）

| 层次 | 席位 | 本项目落点 |
|---|---|---|
| 顶层会话标签栏（与「对话」「轨迹」同级） | `conversation.view`（`list` / `session`） | `ConversationViewIntegration.ts` — **J0 真机验证通过** |
| DSH 原生右侧栏标签 | `sidebar.right.pane.tab`（`keyed` / `session`） | `SidebarRightTabsIntegration.ts` |
| better-sidebar 标签 | `ctx.betterSidebar.registerTab()` | `BetterSidebarIntegration.ts` |
| 侧边栏底部动作按钮 | `sidebar.footer.action`（`list` / `root`） | `SlotsFallback.ts` |
| 宿主容器全部缺席时 | 无 | `FloatingPanelIntegration.ts`（浮动面板兜底） |

- `conversation.view` 由 `conversation.session` 条目**声明**，只在会话面板挂载时存在；
  `ctx.slots.inject` 的回调会在声明就绪后运行，**无需自己重试**。
- `sidebar.right.pane.tab` 由 `sidebarRightTabs.register()` 的 `id` 作为 key；
  `keepMounted: true` 让图表面板跨隐藏/Session 切换/停靠保留（cycle-83 已补）。
- 两代一致：`dsh-client-ui-slots` 的 `lib/index.js` 在 gen1 与 gen2 **逐字节相同**
  （SHA256 `57E1314E31A2015F30231E1E7596DA658F1BB5CB64C103C4CF13381647412C99`）。

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
| **gen2 新工具不存在于 gen1** | fallback 链降级 | `ApiCompatLayer.ts` 的 `FALLBACK_CHAINS` |
| **gen2 特性不可用于 gen1** | FeatureFlags 门控 | 调用方 `if (featureFlags.betterSidebar)` |
| **工具名变化** | ToolNameMapping 映射 | `ApiCompatLayer.ts` 的 `GEN1/GEN2/GEN3_MAPPING` |
| **版本无法检测** | 默认按 gen2 基线 + 扣留高风险特性 | `HostVersionDetector.ts` + `FeatureFlags.ts` 的 `UNKNOWN_FLAGS` |
| **peerDependencies 不满足** | 三代范围 `^0.1.7-rc.2 \|\| ^0.2.0-rc.2 \|\| ^0.3.0-rc.2` | `package.json` 的 `peerDependencies` |
| **宿主版本不兼容** | `dsh plugin allow-version` 豁免 | 官方机制，用户侧操作 |
| **网页端 vs 桌面端** | DOM 属性惰性探测（`PlatformProbe`） | `src/client/compat/PlatformProbe.ts` |
| **服务键是否存在** | 调用时探针（`ctx.get` / 属性访问），非静态假设 | `ClientCompatLayer.hasService()` |

### 7.3 升级 v0.2.0 时的适配清单（cycle-83 已执行，保留为历史记录）

> 以下 6 条在 cycle-82/83 已全部完成或明确裁决；保留以说明决策沿革。

1. ~~**peerDependencies 收窄**~~ —— **决定不收窄**：保留三代范围
   `^0.1.7-rc.2 || ^0.2.0-rc.2 || ^0.3.0-rc.2`。
   死声明（`dsh-client-connection`/`dsh-session`）已于 cycle-82 删除。

2. **devDependencies 升级**：✅ 已完成 —— 现为 `cordis 4.0.4`、`dsh-llm 0.2.0-rc.2`、`dsh-tools 0.2.0-rc.2`。

3. ~~**`dsh.hostVersion` 收窄**~~ —— 该字段**不存在**（无读取者）。真实的版本声明字段是
   `engines.dsh`（纯声明）+ `peerDependencies`（强制门），现为
   `engines.dsh = ">=0.1.7-rc.2 <0.4.0"`（与 `DSH_SUPPORTED_RANGE` 逐字相等，由测试钉死）。

4. **FeatureFlags 调整**：✅ 已完成 —— 12 位；删除幻影 `spotlight`/`remoteWebUi`，
   新增 `commandUi`/`remoteNarrow`。

5. **ToolNameMapping 调整**：✅ 已完成 —— 新增 `GEN3_MAPPING`，
   `TOOL_MAPPING_BY_GENERATION` 导出以让穷尽性被 typecheck 断言。

6. **better-sidebar 能力门控**：✅ 已完成 —— 按 `features` 数组门控（`badge`/`tabLifecycle`/
   `stateSubscription`），而非按版本号。

### 7.4 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| gen2 正式版 API 与 rc.2 不一致 | 工具名/特性可能变化 | 服务面探针 + fallback 链；不静态假设任何键存在 |
| better-sidebar registerTab 不返回 disposer | 清理时 TypeError | `typeof dispose === 'function'` guard（已记录） |
| unknown 版本误判为 gen2 | 启用不支持的特性 | `UNKNOWN_FLAGS` 保守扣留 `incrementalBootstrap` |
| 桌面端标记晚于 `apply()` 出现 | 首次渲染用错版面 | `PlatformProbe` **每次调用重读 DOM** + `observeHostPlatform` 通知（cycle-83） |
| peer 门比适配器模型更保守 | 「模型支持 gen3」被误读为「已声明支持 0.4」 | 文档如实记录语义漂移，见兼容矩阵 §6.3 |
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

> **⚠️ cycle-83 修订**：本文原结论 1 与 4 建立在「`spotlight`/`remoteWebUi` 是 gen2 新能力」
> 这一错误前提上；该前提已被三树静态核验证伪。修订后的结论如下。

1. **版本兼容架构已就绪且已去幻影**：三层兼容（检测→开关→API 映射）+ 三代 peerDependencies；
   运行时版本探测在真实 DSH 上**只剩工具名一条**（context 与 env 候选键全 miss），
   客户端只能按服务面定代（仅 `pluginNavigation`/`userQuestionPanels` 可区分 gen1/gen2）。

2. **better-sidebar 集成路径清晰**：`ctx.get('betterSidebar')` 探针 + `registerTab()` +
   disposer guard + `features` 能力门控；真实契约见 `docs/research/dsh-多代API规范差异与兼容矩阵.md` §10。

3. **ORM 选型明确**：Drizzle ORM（`drizzle-orm/node-sqlite`）可零成本包裹现有 `DatabaseSync`，
   是 DSH 插件环境下的最优选择。

4. **「兼容桌面端」的真实含义**：DSH **不存在桌面客户端平台**（`dsh.client.platform` 只有
   `'web'` 会被加载），桌面端与网页端共用同一 web 半。插件侧唯一的平台判别是
   `<html data-platform="darwin">` / `<html data-windows-titlebar>`，且必须惰性求值。

5. **后续优先级**：
   - P1：把服务面探针的经验固化为契约守卫（防再次引入不存在的服务键）
   - P2：按需引入 Drizzle ORM 包裹现有 SQLite 连接
   - P3：当上游发布 0.3.x/0.4.x 时，用真机验证 `GEN3_MAPPING` 与 `GEN3_FLAGS` 的假设