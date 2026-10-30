# 03 · 客户端 API 参考

> 面向改 `src/client/**` 的开发者。
> 文档族版本 1.2.0 · 适用插件版本 0.2.0
> cycle-110 更新：新增 §2.5「顶部标签注册的三态可观测性」；组件 **45 → 47**、hooks **39 → 38**、
> CSS **18 → 19**（三个数字原为估计值，已按 `find` 实测重取）。

---

## 1. 客户端入口 `src/client/index.ts`

```ts
export const name = 'dsh-codegraph-visualizer-client';   // :30
export const inject = ['slots'];                          // :44 —— 唯一硬依赖
export function init(container: HTMLElement, initialData?: GraphData): () => void;  // :46
export function apply(ctx: Context): void;                // :71
```

### 1.1 `init()` —— 独立挂载（测试 / 嵌入用）

```ts
const root = ReactDOM.createRoot(container);
if (initialData) useGraphStore.getState().setGraphData(initialData.nodes, initialData.edges, initialData.metadata.repoId, initialData.metadata);
root.render(<GraphErrorBoundary><GraphPanel /></GraphErrorBoundary>);
return () => root.unmount();
```

> ⚠️ `init()` **不调用 `apply(ctx)`**，因此 bootstrap / 恢复路径完全不运行。
> dev-server 页面就是这样注入初始数据的——不要在这里断言「首屏零请求」以外的启动行为。

### 1.2 `apply()` —— 集成顺序**即优先级**（`src/client/index.ts:71-102`）

```
conversation.view          （顶层标签，slot 系统）      ← 最完整
  → sidebar.right.pane.tab （DSH 原生右侧栏）
    → better-sidebar tab   （第三方侧边栏）
      → sidebar.footer.action （页脚按钮）
        → 浮动面板           （兜底）
```

`integrateCommandUi` 与通道**正交**（贡献斜杠命令，不占席位），无条件尝试。

> `apply()` 的六个集成调用按**固定顺序**排列（`src/client/index.ts:80-85`），
> 随后是 7 个 runtime setup（`:87-93`）。顺序即优先级，不要重排——
> 见 [01-插件开发规范.md](./01-插件开发规范.md) §4.4 的优先级反转事故。

先注册者把 `state.navButtonRegistered` 置真，后续通道据此让位——
**DSH 的 slot/tab 注册表对重复 id 是抛错语义，不是覆盖语义**
（`dsh-client-ui-sidebar-right/lib/client.js:8690` 的 `if (this.ids.has(id)) throw new Error(...)`）。

随后 7 个 runtime setup（顺序无关）：

| # | 函数 | 文件 |
|---|---|---|
| 1 | `setupPrerequisitePolling(ctx)` | `runtime/PrerequisitePolling.ts` |
| 2 | `setupWorkspaceBootstrap(ctx)` → `{ scanInProgress }` | `runtime/WorkspaceBootstrap.ts:10` |
| 3 | `setupSSEEvents(ctx)` | `runtime/SSEEvents.ts` |
| 4 | `setupWindowEvents(ctx)` | `runtime/WindowEvents.ts` |
| 5 | `setupThemeObserver(ctx)` | `runtime/ThemeObserver.ts` |
| 6 | `setupPanelEventBridge(ctx)` | `runtime/PanelEventBridge.ts` |
| 7 | `setupRejectionHandler(ctx)` | `runtime/RejectionHandler.ts` |

清理（`ctx.effect` 标签 `'codegraph: client cleanup'`）：
`scanInProgress.value = false` → `disposeStore()` → `resetI18nListeners()` → `resetLoggerListeners()`。

---

## 2. 标签页注册（objective #4 的核心）

### 2.1 五个通道与实现文件

| 优先级 | 通道 | 文件 | 席位 |
|---|---|---|---|
| 1 | conversation.view | `integrations/ConversationViewIntegration.ts` | `conversation.view` |
| 2 | sidebar-right | `integrations/SidebarRightTabsIntegration.ts` | `sidebar.right.pane.tab` |
| 3 | better-sidebar | `integrations/BetterSidebarIntegration.ts` | `betterSidebar.openTab` |
| 4 | slots fallback | `integrations/SlotsFallback.ts` | `sidebar.footer.action` |
| 5 | floating | `integrations/FloatingPanelIntegration.ts` | 无席位（自绘） |
| — | command-ui（**正交**） | `integrations/CommandUiIntegration.ts` | 不占席位，贡献斜杠命令 |

> 五个通道**互斥**（共同竞争 `navButtonRegistered`），必须留在同步优先级链里；
> command-ui 是**叠加型**贡献面，与通道正交。

### 2.5 顶部标签注册的三态可观测性（cycle-110）

标签注册「成功 / 失败 / 降级」在屏幕上可能看起来一样（都没出现），因此状态被写成
**DOM 标记 + 有界历史 + 事件** 三件套（`src/client/integrations/topTabObservability.ts`）：

| 导出 | 行 | 作用 |
|---|---|---|
| `TOP_TAB_ATTR` = `'data-cg-top-tab'` | `:58` | 当前状态的 DOM 标记（写在 `<html>` 上） |
| `TOP_TAB_REASON_ATTR` = `'data-cg-top-tab-reason'` | `:60` | 该状态的原因，便于断言「为什么降级」 |
| `TOP_TAB_EVENT` = `'codegraph-visualizer/top-tab-state'` | `:62` | 状态变更事件 |
| `recordTopTab(state, reason, channel)` | `:86` | 记录一次状态迁移（有界历史） |
| `getTopTabState()` / `getTopTabHistory()` | `:71` / `:76` | 读取当前状态 / 历史 |
| `resetTopTabObservability()` | `:113` | 清理（dispose 与测试用） |

> 为什么需要它：环境里「元素没出现」和「根本没请求」在截图上**完全一致**，
> 只有记录式探针能区分。这与 E2E 的计数契约同源（`page.on('request')` 记录而非 `page.route()` 打桩）。

### 2.2 `conversation.view` 席位契约（逐行核验自 `@deepseek-ai/dsh-client-ui-conversation`）

- `lib/types/client/contract/slots.d.ts`：
  `'conversation.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps; }`
  —— **`list` 型即可叠加**，多个注册项并排成多个标签，而不是互相遮蔽
  （对比 `single` 型的 `'root'`，在那里注册会顶掉整个 AppFrame）。
- `lib/types/client/contract/views.d.ts`：标签是 `conversation.view` 注册项的投影，
  `label` 缺席时回落为条目 id。
- 同席位既有注册者：`dsh-client-ui-chat`（id `chat` → 「对话」）、
  `dsh-client-ui-trajectory`（id `trajectory` → 「轨迹」）。本插件是**第三个**。
- 该席位由 `conversation.session` 条目**声明**，故只在会话面板挂载时才存在；
  `ctx.slots.inject` 的回调会在声明就绪后才运行，**无需自己重试**。

**跨代一致性**：`dsh-client-ui-slots` 的 `lib/index.js` 在 gen1（0.1.7-rc.1）与
gen2（0.2.0-rc.2）**逐字节相同**（SHA256 `57E1314E…`，均 23 461 B），故这条注册路径跨代通用。
gen1 另有一条 `ctx.uiConversation.views.register` 旧并行入口，**本项目不采用**——
slot 才是标签投影的真源。

### 2.3 注册代码形状（`ConversationViewIntegration.ts:40-69`）

```ts
const injectDisposer = ctx.slots.inject('conversation.view', () => {
  const regResult = ctx.slots.register(
    { name: 'conversation.view', id: PLUGIN_SLOT_ID, order: 100, label: () => t('nav.title') },
    (props: { ctx?: unknown; visible?: boolean }) => {
      const visible = props?.visible ?? true;
      state.panelVisible = visible;
      useGraphStore.getState().setPanelVisible(visible);
      return React.createElement('div', {
        className: 'cg-conversation-view-wrapper',
        'data-cg-conversation-view': 'true',
        'data-cg-visible': String(visible),
      }, React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)));
    },
  );
  if (typeof regResult === 'function') state.slotDisposers.push(regResult);
  state.navButtonRegistered = true;
  useGraphStore.getState().setIntegrationMode('conversation-view');
  log.info('conversation.view slot registration succeeded');
});
if (typeof injectDisposer === 'function') state.trackSlotDisposer(injectDisposer);
```

**要点**：
1. `label` 是**函数**（`() => t('nav.title')`），支持语言热切换；
2. `order: 100` 决定标签在原生标签之后的排列；
3. 注册结果**必须**存进 `state.slotDisposers`（DSH 的 `register` **可能不返回 disposer**，
   故用 `typeof x === 'function'` 守卫）；
4. 组件只**如实转述** `props.visible` 回 store——可见性由宿主决定（同一时刻只有一个 view 被渲染）。

### 2.4 真机验证结果（cycle-92，objective #7）

accessibility 快照实测：`tab "对话"` / `tab "轨迹"` / **`tab "代码图谱"`** 并排。
点击后 `[data-cg-conversation-view]` 的 `data-cg-visible="true"`，rect `[280,76,824,472]`。
控制台有 `[codegraph:client] conversation.view slot registration succeeded`。

---

## 3. 兼容层 `src/client/compat/ClientCompatLayer.ts`

### 3.1 类型

```ts
export type SidebarIntegrationMode = 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating' | 'conversation-view';  // :18

export interface ClientFeatureFlags {   // :20-35
  sidebarRightTabs: boolean;   // DSH 原生右侧栏 tab 注册表（两代都有）
  betterSidebar: boolean;      // 第三方 dsh-better-sidebar tab 服务（0.2 线）
  slots: boolean;              // 唯一硬依赖
  conversationView: boolean;   // conversation.view 顶层标签席位
  commandUi: boolean;          // ctx.commandUi.register（两代都有）
  desktopPlatform: boolean;    // Electron 外壳（DOM 标记判定，非服务探测）
  remoteNarrow: boolean;       // @linxin666/dsh-remote-web-ui 的 DOM 标记
}
```

接口方法（`:37-51`）：`detectMode` / `detectFlags` / `detectVersion` / `detectPlatform` /
`hasFlag` / `isGen1` / `isGen2` / `isGen3`。

### 3.2 关键实现约束

**`hasService` 必须传 `strict = false`**（`:175-179`）：

```ts
function hasService(ctx: Context, key: string): boolean {
  return safeCheck(() => {
    const value = ctx.get(key, false);   // ← strict=false
    return value !== null && value !== undefined;
  }, false);
}
```

理由（源码 `:152-173` 长篇注释）：`ctx.get(name, strict = true)` 只返回**提供者 fiber 当前活跃**
（`fiber.state === 2`）的实现。而 `apply()` 是**同步一次性**执行的——真机实测此时
`commandUi` / `pluginNavigation` / `sidebarRightTabs` / `betterSidebar` 的提供者 fiber
都还停在 state 1（loading），只有装载更早的 `slots` 已 active。

> **历史事故**：strict 探测把它们全判成 false，`integrateCommandUi` 在第 34 行早退，
> **5 条斜杠命令一条都没注册**（真机 `/` 弹层 35 条全是技能、零命令）。

`strict = false` 的语义 = 「该服务**已被 provide 且未被撤回**」，正是能力探测想要的粒度：
`provide` 的 disposer 会从 store 删除条目，故已卸载插件的服务依然读不到。
但它**读不到尚未 provide 的服务**——那一半由响应式 `ctx.inject` 兜住。

**`isGen2()` 含 gen3**（`:123`）：gen3 是 gen2 的前向兼容超集
（与宿主侧 `ApiCompatLayer` 的 `GEN3_MAPPING = { ...GEN2_MAPPING }` 策略一致）。

**平台检测**（`detectHostPlatform`）：读 `<html>` 的 `data-platform` / `data-windows-titlebar`
与 `--dsh-frame-*` CSS 变量，**每次调用重新读 DOM**，用 `MutationObserver` 重求值。
**不要**用 `process.versions.electron`（`@deepseek-ai` 全部 JS 里零命中）。

---

## 4. 集成状态台账 `src/client/integrations/IntegrationState.ts`

```ts
export class IntegrationState {
  panelVisible = false;
  navButtonRegistered = false;
  betterSidebarApi: Context['betterSidebar'] | undefined;
  betterSidebarTabId: string | undefined;
  slotDisposers: Array<() => void> = [];
  renderFloating: () => void = () => {};

  constructor(public ctx: Context, public flags: ClientFeatureFlags);

  trackSlotDisposer(d: (() => void) | void): void;   // :49
  trackDisposer(d: (() => void) | void): void;       // :53
  get/set sidebarStateDisposer;
}
```

**两条清理台账**（`:16-20`）：
- `slotDisposers` —— slot/tab 注册返回的 disposer，**先清**（它们持有 DOM 席位）；
- `allDisposers` —— 其余 disposer（状态订阅等），**后清**（单个失败不阻断其余）。

构造器注册 `ctx.effect(..., 'codegraph: slot registrations cleanup')` 按此顺序释放并清空数组，
**使重复调用成为幂等操作**。

**标识符** `integrations/integrationIds.ts`：
```ts
export const PLUGIN_SLOT_ID = 'dsh-codegraph-visualizer';   // 全局唯一，不能与其他插件撞车
export const PLUGIN_TAB_KIND = 'codegraph-visualizer';
```

---

## 5. 状态管理 `src/client/store/`

### 5.1 结构

| 文件 | 作用 |
|---|---|
| `graphStore.ts` | store 创建 + persist 中间件 + `migrate` |
| `internals.ts` | 内部辅助 |
| `types.ts` | `GraphState` 全字段 + 全部 action 签名 |
| `viewModeTransition.ts` | 视图模式切换时的状态搬迁 |
| `cluster/`（8 文件） | 聚类节点/边模型 |
| `slices/`（10 文件） | `panelLod` / `pathFocus` / `viewMode` / `filter` / `analysis` / `session` / `workspace` / `graphData` / `expand` / `edge` |
| `slices/`（⟨待 T3⟩ +1） | 关键词检索切片（`loading` / `error` / `result`）。**当前不存在**；任务书要求「组件内不留业务状态」，见 [11](./11-图检索与关键词查询.md) §6.4 |

### 5.2 `GraphState` 关键字段（`types.ts`）

**图数据**：`nodes` / `edges`（`GraphNode | ClusterNode` 联合）、`rawNodes` / `rawEdges`、
`savedRawNodes` / `savedRawEdges`、`repoId`、`truncated`、`totalNodeCount` / `totalEdgeCount`

**视图**：`layout` / `dagreRankDir` / `theme` / `searchQuery` / `selectedNodeId` /
`highlightedNodeIds` / `filterType` / `graphType` / `viewMode` / `diagramData` /
`currentLayer` / `clusterDepth` / `hierarchyLevel`

**HTTP 校验器**：`graphEtag: string | null`（`:73`）

> 与 `lastUpdated` **刻意分开**：`lastUpdated` 是展示用的时间（`Date.now()` 与服务端
> `metadata.timestamp` 混写，供 StatusBar 显示"最后更新于"），而 `graphEtag` 是 HTTP 校验器域。
> 把展示时钟当校验器用会同时造成两种错：时钟域不同导致 **304 永不命中**（每次全量重取），
> 或身份不同导致**假 304 静默吞掉一次真实更新**（P0-R16-02）。
> `null` 表示"没有可用校验值"，此时不带 `if-none-match`。**不持久化**（不在 `partialize` 白名单里）。

**按需加载**：
- `expandedNodeIds` / `expandedNodeIdsByViewMode` / `loadedChildrenByNodeId` / `prefetchedNodeIds`
- `loadErrorsByNodeId: Map<string,string>` / `pendingRequests: Map<string, AbortController>`
- `nodeEdgesByNodeId` / `nodeEdgeTotals` / `nodeEdgeCursors` / `loadingEdgeNodeIds`（`:94-100`）
- `detailEdgeNodeIds: Set<string>`（`:111`）—— 「用户明确要了明细」的**粘性**状态。
  `/edges` 会把稠密文件邻域折叠成每对文件一条合成边，且该聚合页**无法翻页**
  （`hasMore: false`）；用户一旦要明细，之后每页都必须继续要未聚合的边。
- `astPageByNodeId: Map<string, AstPageInfo>`（`:120`）—— `AstPageInfo { loaded, total, hasMore, cursor }`（`:20-29`）

**面板可见性**（`AnalysisPanelKey` 共 **18** 个，`src/shared/viewModeUtils.ts:100-106`）：`showSearch` / `showPathFind` /
`showHealthScore` / `showRules` / `showImport` / `showFilterPanel` / `showCallChain` /
`showCycles` / `showImpact` / `showInheritance` / `showHotspot` / `showGodModule` /
`showCoreFunction` / `showDeadCode` / `showRuntime` / **`showDiff`** / `showMiniMap` / `showLegend`

> **文档修正记录（cycle-111 实测）**：本节原写「共 17 个」且列表里**没有 `showDiff`**，
> 与源码不符。按 `src/shared/viewModeUtils.ts:100-106` 的联合类型逐个计数，真实值是
> **18**（补上 `showDiff`）。复验：
>
> ```bash
> node -e "const s=require('fs').readFileSync('src/shared/viewModeUtils.ts','utf8');const m=s.match(/export type AnalysisPanelKey =([\s\S]*?);/);console.log([...m[1].matchAll(/'([a-zA-Z]+)'/g)].map(x=>x[1]).length)"  # → 18
> ```
>
> 三层的可用集合（同一命令可复验）：`STRUCTURAL_PANELS` **10**、`BEHAVIORAL_PANELS` **13**、
> `RUNTIME_PANELS` **3**（`viewModeUtils.ts:119`/`:126`/`:146`）。三集合**不是**对
> `AnalysisPanelKey` 的划分（`showMiniMap`/`showLegend` 三层都有，`showDiff` 在
> structural 与 behavioral 两层都有）——**不要**用「某 key 只属于一层」做判断。

### 5.3 全部 action（60 个，`types.ts:161-241`）

```
setGraphData / setBootstrapData / setLayout / setDagreRankDir / setTheme / setSearchQuery
setSelectedNode / setHighlightedNodes / setFilterType / setGraphType / setViewMode / setLayer
setClusterDepth / setHierarchyLevel / setLoading / setError / clearGraph / setPrerequisites
setIntegrationMode / setPanelVisible / setInitStatus / setIndexStatus / setWatchEnabled
expandNode / loadNodeChildren / loadBootstrap / collapseNode / collapseAll
setCurrentWorkspace / addWorkspace / removeWorkspace
setPathStart / setPathEnd / setPathResult / setFocusDepth / setFocusMode / setPathFilter
setCallChainDepth / setFanInThreshold / setFanOutThreshold / setVisibleNodeTypes / setVisibleEdgeTypes
setHeatmapMode / setTodoMarkerMode / setHealthScore / setRules / setRuleViolations
setDeadCodeResult / setDeadCodeModeActive / setSelectedFunction
setPanelSize / resetPanelSize / addDegradation / clearDegradations / setLODLevel / setLODEnabled
pinNode / loadNodeEdges / loadMoreAst / applyGraphDelta
```

### 5.4 `setGraphData` 与 ETag 缓存的绑定

`setGraphData(nodes, edges, repoId, metadata?)` 的 `metadata` 可含 `etag`。
**所有整图替换点都必须调 `clearEtagCache()`**（5 处）：

| 函数 | 位置 |
|---|---|
| `setGraphData` | `slices/graphDataSlice.ts` |
| `setBootstrapData` | 同上 |
| `applyGraphDelta` | 同上 |
| `clearGraph` | 同上 |
| `disposeStore` | `store/internals.ts` |

> 原因：304 只承诺**服务端副本**未变。这些函数会整体替换 `rawNodes` 并通过
> `emptyEdgeState()` 重置派生容器，丢弃已合并的 outline / AST / children——
> **载荷生命周期与校验器生命周期必须对齐**。

### 5.5 分片/展开的令牌纪律

- `expandGeneration` 回答「图变了吗」，**不能**当请求所有权用。
  按节点分页需 per-key 单调令牌（`astRequestSeq`，形状同 `edgeRequestSeq`）。
- 部分页**绝不进**「完整结果」缓存：写入门是 `!hasMore && cursor === 0`。
- 明细模式**跳过**缓存读与写（`!append && !detail` / `!data.hasMore && !detail`）——
  缓存里那份 payload **正是用户点开的聚合视图**。

---

## 6. 视图分层 `src/shared/viewModeUtils.ts`

```ts
export type ViewLayer = 'structural' | 'behavioral' | 'runtime';     // :7

export const LAYOUT_ORDER: readonly LayoutType[] = Object.freeze([   // :30
  'cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree',
]);   // ← 唯一权威顺序表；顺序即 UI/键盘/命令循环顺序，不要按字母序重排

export const VIEW_MODE_LAYOUT: Record<ViewMode, LayoutType>;         // :34
export function isLayeredViewMode(mode: ViewMode): boolean;          // :49
export function getViewLayer(mode: ViewMode): ViewLayer;             // :68

export const STRUCTURAL_VIEW_MODES = ['code'];                                     // :88
export const BEHAVIORAL_VIEW_MODES = ['dependencies','inheritance','callgraph','package','class'];  // :89
export const BEHAVIORAL_MICRO_VIEW_MODES = ['cfg','flowchart','sequence'];         // :90
export const RUNTIME_VIEW_MODES = ['runtime'];                                     // :99

export type AnalysisPanelKey = /* 17 个 */;                          // :100
export const STRUCTURAL_PANELS: Set<AnalysisPanelKey>;               // :107
export const BEHAVIORAL_PANELS: Set<AnalysisPanelKey>;               // :113
export const RUNTIME_PANELS: Set<AnalysisPanelKey>;                  // :132
export function getAvailablePanels(layer: ViewLayer): Set<AnalysisPanelKey>;  // :137
```

### 6.1 三条铁律

1. **`LAYOUT_ORDER` 是 7 项布局的唯一来源**。曾有 4 份互相独立的副本
   （`components/toolbarConfig.ts`、`integrations/CommandUiIntegration.ts`、
   `store/graphStore.ts` 的 `migrate`、`hooks/usePanelKeyboard.ts`），
   漏改后果**静默**：工具栏能选、命令循环跳过、持久化当脏值回退、键盘永远轮不到。
   `tests/unit/layoutOrderContract.test.ts` 用源码守卫锁死。
   `Object.freeze` 是运行期保险（`readonly` 只在编译期生效）。
2. **`getAvailablePanels` 的三层可用集合必须同构**：`RUNTIME_PANELS` 曾是内联的
   `new Set([...])`，每次调用新建对象，于是
   `getAvailablePanels('runtime') === getAvailablePanels('runtime')` 为 false。
3. **能力守卫与状态写入的方向必须先查**：`useViewModePanelGuard` 关闭当前层不可用的面板，
   而 `GraphPanel` 在 `viewMode === 'runtime'` 时打开 runtime 面板——
   把 `showRuntime` 加进守卫的列表会让两个 effect **互相回滚**
   （与 cycle-84「能力守卫回滚写入」同形）。
   另：`panel.setShowCallChain(true)` 在 `showCallChain` 不在该层
   `getAvailablePanels` 里时会被**同一次 update 回滚**，状态永远读回 false 且**无报错**。

---

## 7. Hooks `src/client/hooks/`（2026-10-28 实测 39 文件；`find src/client/hooks -type f | wc -l`）

统一从 `src/client/hooks/index.ts` 具名导出。分组：

| 组 | hooks |
|---|---|
| 渲染 | `useGraphRenderer`、`useVisibleNodeCount`、`useLODZoom`、`useMiniMapSync` |
| 面板 | `usePanelResize`、`usePanelSizeApply`、`usePanelVisibility`、`usePanelState`、`usePanelKeyboard`、`useViewModePanelGuard`、`useViewMode`、`useAncestorResize` |
| 交互 | `useNodeInteraction`、`useNodeSearch`、`useSearchInteraction`、`useKeyboardShortcut`、`useDismissable`、`useFocusMode`、`useDebounce` |
| 数据 | `useGraphDerivedValues`、`useGraphSelectors`（含 10 个细粒度 selector hook）、`useAdjacencyMap`、`useNodeEdgeList`、`useExpandedFunctionBodyCount`、`useGraphCache`、`useWorkspaceCache` |
| 工作区 | `useWorkspaceHandlers`、`useWorkspaceEventListener`、`useUrlExpandSync`、`useAutoBootstrap` |
| 主题 | `useThemeSync`、`useElementWidth` |
| 分析 | `useAnalysisPanels`、`useDeadCodeMarker`、`useHistory`、`useSymbolSelectListener` |

另有 `usePolling(callback, interval, enabled = true)`（`index.ts:33`）——
`setInterval` 封装，`document.hidden` 时跳过。

> `useGraphRenderer` 的边界规范：**必需回调必须声明为必需接口字段**，
> 不要用 `Record<string, (...args) => void>`。在 `noUncheckedIndexedAccess` 下每次索引
> 都会变成 `| undefined`，逼出 `?.` 并**静默地把「hook 忘了转发这个回调」变成通过的测试**。
> 该 hook 把每个可选 `RendererCallbacks` 成员包成具体箭头函数（`useGraphRenderer.ts:124-141`），
> 故在那一层每个回调必然存在。

---

## 8. 渲染抽象 `src/client/renderer/IRenderer.ts`

```ts
interface RendererCallbacks {   // 9 个可选回调
  onNodeTap?; onEdgeTap?; onNodeDoubleTap?; onNodeHover?; onNodeHoverPrefetch?;
  onNodeHoverOut?; onEdgeHover?; onEdgeHoverOut?; onNodeContextTap?;
}

interface RendererOptions extends RendererCallbacks {
  container: HTMLElement;
  theme: ThemeType;
}

interface IRenderer {   // 约 30 个方法
  init / updateData / setRawNodes
  applyLayout / setDagreRankDir / applyIncrementalLayout
  isWorkerLayoutAvailable / applyLayoutWithWorker / applyWorkerLayout
  enableVirtualScroll / disableVirtualScroll / isVirtualScrollEnabled / shouldEnableVirtualScroll
  highlightNodes / selectNode / hideNode / showAllNodes / getVisibleNodeCount
  filterByType / filterByGraphType / applyConnectionFilters
  search / focusOnNode / revealNode
}
```

**Cytoscape 选择器陷阱**（务必记住）：

| 写法 | 实际语义 |
|---|---|
| `[isCluster="true"]` | **只匹配字符串 `"true"`**，而写入端存的是真布尔 ⇒ 匹配不到任何东西 |
| `[flag=true]` | **抛错** `The selector '[flag = true]' is invalid` |
| `[?flag]` | **真值判断**，不是严格等于 `true`：`"false"` 与 `1` 都会命中 |
| `[clusterHue="3"]` | 只匹配字符串 `"3"`，而写入端存 `Math.abs(hash) % 12`（数字） |
| `[parentCount = 0]` | 匹配 `0`、`1` **和** `""` |

⇒ **死样式规则对任何行为测试都不可见**（元素照常渲染，只是颜色/边框/z-index 错）。
只有两种办法能看见它：真实样式读回（`el.style("z-index")`）或**源码形态守卫**。
当前守卫：`tests/unit/styleSelectorContract.test.ts`（同时扫**写入侧**——
否则把 `isFragment: true` 改成 `'true'` 仍会通过）。

---

## 9. API 客户端 `src/client/api/index.ts`

### 9.1 条件请求（ETag）API

```ts
export interface EtagSink {          // :61
  etag: string | null;
  notModified: boolean;
  key: string | null;
}
export function createEtagSink(): EtagSink;                    // :74
export function commitEtag(sink: EtagSink): void;              // :86
export function clearEtagCache(): void;                        // :127
```

**`commitEtag` 的语义**（`:86`）：`if (sink.notModified || !sink.key) return;` ——
把注册时机从「响应收到」移到「**载荷已应用**」。

> **这是整个机制的正确性支点**：早期实现在每个 200 都 `rememberEtag`，包括调用方随后因
> 代际/令牌检查而**丢弃**的响应。下一次请求带上那个校验值 → 收到 304 →
> 客户端**从未应用过那份载荷** → 面板永久空白且无可见错误。

**304 与网络失败必须区分**：四个按需 fetcher 返回 `T | null`，而 `null` 已被「失败」占用。
`res.ok` 对 304 是 `false`，故复用 `if (!res.ok) return null` 会把
「服务端说什么都没变」变成「客户端没有数据」并静默清空面板。
`EtagSink.notModified` 是唯一的区分手段。

**调用点形状**（`store/slices/expandSlice.ts` 三处 + `edgeSlice.ts` 一处）：

```ts
const sink = createEtagSink();
// …请求…
if (generation !== currentGeneration) return;   // 代际/令牌守卫
if (sink.notModified) return;                   // 304：服务端说没变
applyPayload(data);                             // 先应用
commitEtag(sink);                               // 后登记
```

缓存：`etagByRequestKey: Map` + `MAX_ETAG_ENTRIES = 256`（LRU）。

> 缓存失效方向**刻意不对称**：校验值编码了 (resource, workspace, revision, request key)，
> 因此陈旧值只可能**不匹配**而得到 200，绝不会错误匹配到更新的 revision。
> 「多送一次」是安全方向，所以缓存不需要工作区切换失效列表，也不可能成为跨工作区污染通道。

### 9.2 全部 fetcher

| 函数 | 行 | 返回 |
|---|---|---|
| `fetchWithTimeout(url, options?, timeoutMs?)` | `:30` | `Promise<Response>` |
| `fetchBootstrap(signal?, workspace?)` | `:173` | `BootstrapData \| null` |
| `fetchNodeChildren(...)` | `:201` | `NodeChildrenData \| null` |
| `fetchStatus()` | `:228` | `{ codegraph, lens, builtin }` |
| `fetchWorkspace()` | `:246` | `WorkspaceInfo` |
| `requestScan(path, maxNodes?)` | `:260` | `{ success, nodes, edges, metadata? } \| null` |
| `requestInit(path)` | `:272` | `{ success, message } \| null` |
| `fetchGraphDataIncremental(...)` | `:312` | `IncrementalGraphResult` |
| `requestWatch(enabled, path)` | `:338` | `boolean` |
| `fetchFileOutline(...)` | `:353` | `FileOutlineData \| null` |
| `fetchSymbolAST(...)` | `:395` | `SymbolASTData \| null` |
| `fetchAst(filePath, signal?, workspace?)` | `:437` | `ASTNode \| null` |
| `fetchEdges(fromId, scope?, cursor?, limit?, signal?, workspace?, detail?, sink?)` | `:539` | `EdgesData \| null` |
| `fetchGraphDiff(from, to, signal?, workspace?)` | `:364` | `DiffGraphData \| null` |

> `fetchSymbolAST` **刻意省略**等于 `'.'` 的 `workspace` 参数——
> 写断言时必须读分支，不能按语义「应该」的样子写。

### 9.3 `fetchGraphDiff` 与版本对比（cycle-104）

`fetchGraphDiff` 是**唯一**调用 `POST /api/v1/codegraph/diff` 的客户端入口。它返回
`DiffGraphData`（`{ nodes, edges, from, to }`），其中 `nodes`/`edges` 是**只含变更项**的
子图，每个元素的 `properties.diffStatus` 取 `'added' | 'modified' | 'removed'`。

三条不能违反的契约：

1. **返回类型刻意不是 `GraphData`**。把它交给 `setGraphData` 会把画布替换成一张只有
   变更项的残图；独立类型让这个误用在编译期就不可能。
2. **失败返回 `null`，不返回空 diff**。空 diff 会被面板渲染成「两个引用之间没有图结构
   变更」——那是把一次失败说成事实。`null` 与 `{nodes:[],edges:[]}` 在 UI 上必须不同。
3. **端点不在本次负载里的边会被丢弃**。留着会让 cytoscape 抛
   `edge endpoint not found` 并整块渲染失败。

配套模块（纯函数与编排分离，可各自单测）：

| 模块 | 职责 |
|---|---|
| `src/shared/diffStatus.ts` | `DiffStatus` 联合、`DIFF_STATUS_CLASS` 类名常量、`buildDiffIndex`、`summarizeDiff` |
| `src/client/hooks/useDiffComparison.ts` | 编排：取数 → 落 store → 让渲染器加 class；请求归属令牌 + 图变更重放 |
| `src/client/components/DiffPanel.tsx` | 面板：两个 ref 输入、三态计数、「已标记/未渲染」披露、失败块 |
| `src/client/renderer/HighlightController.ts` | `applyDiffMarkers(index)` / `clearDiffMarkers()`（只加 class，不改数据） |

**状态生命周期**（`diffResult` 在哪些地方被清空，缺一处就会留下指向旧图的标记）：

| 触发点 | 位置 | 理由 |
|---|---|---|
| 整图替换（4 处） | `graphDataSlice.ts` 的 `...emptyDiffState()` | diff 索引相对「发起对比时那张图」 |
| 工作区切换 / 新增 | `workspaceSlice.ts` `setCurrentWorkspace` / `addWorkspace` | 换图即换 id 空间 |
| 删除当前工作区 | `workspaceSlice.ts` `removeWorkspace`（仅 `removingActive`） | 与 `graphEtag` 同一条判断 |
| 面板关闭 | `DiffPanel` 的 onClose → `diff.clear()` | 关闭即结束这次对比 |
| 切到运行时层 | `useViewModePanelGuard` 的自动关闭清单 | 该层没有图可标 |

守卫：`tests/unit/diffStatusContract.test.ts` 双向扫描——样式侧与渲染侧都不得出现
裸 `diff-added` 类名字面量，且宿主 `DiffEngine` 写入的词汇表必须与 `DIFF_STATUSES` 完全一致。

---

## 10. i18n `src/client/i18n/`

```ts
export type Lang = 'zh' | 'en';                                       // :5
export function getLang(): Lang;                                      // :23
export function setLang(lang: Lang): void;                            // :25
export function toggleLang(): void;                                   // :34
export function useLang(): Lang;                                      // :45
export function t(key: string, params?: Record<string, string | number>): string;   // :49
export function useT(): (key: string, params?: ...) => string;        // :59
export function resetI18nListeners(): void;                           // :63
```

词典：`dicts/zh.ts`（487 键）/ `dicts/en.ts`。键按前缀分组：
`panel.*` / `toolbar.*` / `clusterDepth.*` / `filter.*` / `graphType.*` / `search.*` /
`state.*` / `nav.*` …

**新增用户可见文本**：必须在 `zh.ts` 与 `en.ts` **同时**加键，再经 `t()` 引用。

---

## 11. 日志 `src/shared/Logger.ts`

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';   // :7
export interface LogEntry { ... }                              // :9
export const logger = new LoggerImpl();                        // :61
export function scoped(scope: string);                         // :64
export function resetLoggerListeners(): void;                  // :72
```

用法：`const log = scoped('client');` → `log.info('...')` / `log.warn(msg, e)`。
**不要**直接 `console.*`。

真机上的日志前缀形如 `[codegraph:client:compat] client feature flags resolved`。

---

## 12. 样式 `src/client/styles/`（2026-10-28 实测 19 个 CSS；`find src/client/styles -name '*.css' | wc -l`）

全部由 `src/client/GraphPanel.tsx:56-61` **集中 import**（顺序即层叠顺序）：

```
tokens → layout → overlays → graph → node-detail → import-workspace
→ path-finder → health-score-card → rule-config-panel → hotspot-godmodule-panel
→ impact-panel → cycle-panel → tour-panel → responsive → misc → runtime-panel
```

（另有 `color-mix-fallback.css` 与 `deadcode-panel.css` 按需引入）

### 12.1 主题桥接 `tokens.css`

```css
:root {
  --cg-bg: var(--dsw-bg, #ffffff);
  --cg-surface: var(--dsw-surface, #f9fafb);
  --cg-border: var(--dsw-border, rgba(0,0,0,0.04));
  --cg-text: var(--dsw-fg, #0f1115);
  --cg-text-secondary: var(--dsw-fg-secondary, #61666b);
  --cg-text-tertiary: var(--dsw-fg-tertiary, #4d5156);
  --cg-accent: var(--dsw-accent, #263148);
  /* --cg-accent-hover / --cg-accent-soft / --cg-on-accent */
  /* 自有色：--cg-success #10b981 / --cg-warning #f59e0b / --cg-error #ef4444
     --cg-info #3b82f6 / --cg-cycle-highlight #e74c3c */
}
```

> `DSH does not expose CSS custom properties`——fallback 字面量是**实测的 computed value**
> （经 DevTools 量得），由 `tests/unit/tokensContract.test.ts` 钉死。
> 改 fallback 必须同步改该测试。

画布节点色（死代码）经 `readCssVarCached('--cg-deadcode-node…')`
（`src/client/renderer/styles/ThemeStylesheet.ts`）读取：
`--cg-deadcode-node`(#9ca3af) / `-node-border`(#6b7280) /
`-node-suspected`(#d1d5db) / `-node-suspected-border`(#9ca3af)。

### 12.2 兼容性规则

- `color-mix()` **每个用法**都要在 `color-mix-fallback.css` 里有对应回退项；
- `@container`（CSS Container Queries）需要 `@supports not (container-type: inline-size)` 回退。

---

## 13. 组件清单 `src/client/components/`（2026-10-28 实测 49 文件；`find src/client/components -type f \( -name '*.tsx' -o -name '*.ts' \) | wc -l`）

| 组 | 组件 |
|---|---|
| 根 | `GraphPanel`（`src/client/GraphPanel.tsx`）、`ErrorBoundary`、`Portal` |
| 工具栏 | `Toolbar`、`toolbar/ToolbarWorkspace`、`toolbar/ToolbarActions`、`toolbar/ToolbarViewMode`、`toolbar/ToolbarSettings`、`toolbarConfig`、`toolbarTypes` |
| 面板栈 | `PanelStack`、`LeftPanelStack`、`RightPanelStack`、`FloatingUI`、`AnalysisPanelShell` |
| 分析 | `HealthScoreCard`、`HotspotPanel`、`GodModulePanel`、`ImpactPanel`、`CoreFunctionPanel`、`CyclePanel`、`DeadCodePanel`、`RuleConfigPanel`、`RuntimePanel` |
| 交互 | `Dropdown`、`ContextMenu`、`GraphTooltip`、`SearchBar`、`FilterPanel`、`KeyboardHelp`、`OverlayBar` |
| 信息 | `StatusBar`、`StatsPanel`、`Legend`、`NodeDetail`、`NodeEdgeList`、`MicroViewBar`、`PathBar`、`FocusModeBar` |
| 流程 | `EmptyState`、`LoadingOverlay`、`ErrorOverlay`、`ImportPanel`、`WorkspaceSelector`、`TourPanel`、`Icons` |
| 检索（⟨待 T3⟩） | `KeywordQueryPanel` + `styles/keyword-query-panel.css` —— **当前不存在**（`ls src/client/components/ \| grep -i keyword` = 空）。契约见 [11](./11-图检索与关键词查询.md) §6 |

### 13.1 工具栏入口的承载点（改入口前必读）

结构化入口不是散落在 `Toolbar.tsx` 里的 JSX，而是由 `toolbarConfig.ts` 的常量驱动：

| 常量 | 行 | 内容 | 渲染者 |
|---|---|---|---|
| `ANALYSIS_ITEMS` | `:89-93` | `showCallChain` / `showCycles` / `showImpact` / `showInheritance` / `showPathFind` | `ToolbarViewMode` / 更多菜单 |
| `QUALITY_ITEMS` | `:97-102` | `showHealthScore` / `showRules` / `showHotspot` / `showGodModule` / `showCoreFunction` / `showDeadCode` | 同上 |
| `RUNTIME_ITEMS` | `:118` | `showRuntime` | 同上 |
| `DIFF_ITEMS` | `:132` | `showDiff` | 同上 |
| **`PANEL_DROPDOWN_SECTIONS`** | `:135-140` | 把上面四组按**段**组装：`toolbar.analysis` / `toolbar.quality` / `toolbar.runtimeSection` / `toolbar.diffSection` | `toolbar/moreMenu.ts` → `ToolbarSettings` |

**新增一个面板入口的最小改动**（三步，不是一步）：

1. 在对应的 `*_ITEMS` 里加一条（`{ panel, Icon, key, btnClass, toggle }`）；
2. 若需要新段，加进 `PANEL_DROPDOWN_SECTIONS`（`labelKey` 必须同步到 `zh`/`en` 字典）；
3. `panel` 字段必须是 `AnalysisPanelKey` 的成员（**18** 个，见 §5.2）——**不是**随便一个字符串。
   加新 key 要同时改 `src/shared/viewModeUtils.ts:100` 的联合类型**与**
   `STRUCTURAL_PANELS`/`BEHAVIORAL_PANELS`/`RUNTIME_PANELS` 三个集合（`setPanelVisible`
   的白名单由 `getAvailablePanels` 的层决定，不是独立白名单）。

**空段自动隐藏**：`moreMenu.ts:149-151` 的 `hasMoreMenu(sections)` 判据是
「至少一段有 item」；`ToolbarSettings` 在无内容时**不渲染触发器**（`:147` 注释原文：
*"触发器应当隐藏而不是打开一个空白面板"*）。⇒ 新增段但忘记加 item 时，
你不会看到空面板，你会**看不到入口**——症状是「加了没生效」。

**⟨待 T3 落地后回填⟩**：关键词检索的入口落在哪一段。T3 的写域包含
`toolbarConfig.ts`（只允许追加 item，不允许重排），且**不得改 `Toolbar.tsx`**
（Lead 独占）。若发现 `toolbarConfig.ts` 无法承载（需要新段 / 新 `panel` key），
T3 必须在报告里给出最小 diff 建议而不是直接改。

> `Dropdown` 的定位规范：`position: fixed` + viewport 坐标 ⇒ **必须**有 `scroll` 监听，
> 且必须用 `capture: true`（滚动祖先的 `scroll` 事件**不冒泡**到 `window`）。
> 历史事故：只监听 `resize` 时，100 px 滚动把间隙从 6 px 变成 106 px 而触发器已走开。

---

## 14. 存储工具 `safeStorage`（cycle-111 / T2 已落地）

### 14.1 为什么需要它（修前的缺陷）

`src/client/store/graphStore.ts` 曾有两处**直接**取 `window.localStorage`：

| 行（修前） | 代码 | 风险 |
|---|---|---|
| `:97-98` | `storage: createJSONStorage(() => typeof window !== 'undefined' ? window.localStorage : memoryStorage)` | 跨源 iframe（`dsh-remote-web-ui`）中 `localStorage` **getter 本身**抛 `SecurityError` ⇒ `persist` 在 **store 创建期**求值 storage 参数 ⇒ 整个 store 创建失败 ⇒ 面板白屏 |
| `:181` | `if (typeof window !== 'undefined' && localStorage.getItem('__cg_debug') === '1')` | 模块顶层执行；同样抛错 |

**`typeof window !== 'undefined'` 挡不住这个问题**：`window` 存在、但 `window.localStorage`
的 getter 抛错。这是「存在性检查」与「可访问性检查」的区别。

### 14.2 实现（`src/client/utils/safeStorage.ts`）

| 导出 | 行 | 作用 |
|---|---|---|
| `interface SafeStorage` | `:40` | `getItem` / `setItem` / `removeItem`（**全部同步、不抛错**） |
| `getSafeStorage(label = 'generic')` | `:83` | 取一个后端：优先真实 `localStorage`，不可用时**稳定**回退内存实现 |
| `safeGetItem(key)` | `:133` | 读，抛错 ⇒ `null` |

调用点（`graphStore.ts`）：

| 行 | 内容 |
|---|---|
| `:22` | `import { getSafeStorage, safeGetItem } from '../utils/safeStorage.ts';` |
| `:39` | `const persistedStorage: StateStorage = getSafeStorage('graphStore');` —— **模块级只求值一次** |
| `:190` | `if (typeof window !== 'undefined' && safeGetItem('__cg_debug') === '1')` |

`safeStorage.ts` 的选择逻辑（`getSafeStorage`，`:83` 起）含一次**真读真写探测**
（`setItem` + `removeItem`），因为「`localStorage` 存在」与「`localStorage` 可写」是两件事
（Safari 隐私模式的典型行为：存在、能读、写时抛 `QuotaExceededError`）。

**四条契约**（缺一条都会退化）：

1. **首次访问不得抛错**——`localStorage` getter 抛 `SecurityError` 时回退内存；
2. **回退静默**（`log.debug` 记录，不弹错误）：这是**能力缺失**，不是操作失败；
3. **同一进程内回退实现稳定**（同一个对象）——否则 `persist` 每次拿到新的空 storage，
   已保存的 UI 偏好会「随机丢失」；`graphStore.ts:39` 把它提到模块级就是为了这条；
4. **两条既有调用点都换掉**（`:39` 与 `:190`，修前分别是 `:97-98` 与 `:181`）。

> `graphStore.ts:29-37` 的注释原文记录了修前的形状与为什么必须走这个函数——
> 保留这段注释是有意的：它是「为什么不能直接摸 `window.localStorage`」的唯一现场说明。

### 14.3 已有的正确形态（参照）

`src/client/i18n/index.ts` 早就是 try/catch 形态：

```ts
// :17-21  读：抛错时返回缺省值
try { const stored = window.localStorage.getItem(STORAGE_KEY); … }
catch { /* localStorage unavailable */ return 'zh'; }

// :28-30  写：抛错时静默放弃
try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage unavailable */ }
```

**差别只在调用时机**：i18n 是**函数内按需**访问（抛错可被就地捕获），
而 zustand `persist` 的 `storage` 是**构造参数**（抛错发生在 store 创建期，
没有就地捕获的机会）。这就是为什么 i18n 一直没事、而 store 会白屏。

### 14.4 测试必须模拟 getter 抛错

```ts
Object.defineProperty(window, 'localStorage', {
  get() { throw new DOMException('denied', 'SecurityError'); },
});
```

**不能**只是「把 localStorage 换成内存对象」——那根本没测到抛错路径。

> **仍无机器守卫的部分**：跨源真机场景没有 E2E（`conversation-remote-web-ui.spec.ts`
> 已不存在，见 [测试体系 §2.20](../测试体系.md)）。单测能证明「回退实现可用」，
> 不能证明「真实 iframe 里不再白屏」。

---

## 附：会话视图入口双端安装与验证（cycle-115）

**DSH 双 profile 结构**：桌面 App（Electron）用 `~/.dsh/profiles/desktop`，Web 服务/测试实例用
`~/.dsh/profiles/web`，**互相独立**。link 安装（`link:<路径>`）必须各自执行：

```jsonc
// package.json（两处 profile 各一份）
{ "dependencies": { "dsh-codegraph-visualizer": "link:D:/…/dsh-codegraph-visualizer" },
  "dsh": { "profile": { "bundles": [ "dsh-codegraph-visualizer", … ] } } }
// desktop 的 bundles 在 package.json 的 dsh.profile.bundles；web 的 cordis.yml 是空数组、
// 树由 bundles + cordis.patch.yml 组成——两 profile 的 bundle 声明位置不同！
```

**验证判据（两端一致）**：

1. 会话激活后顶部标签栏出现「代码图谱」（与「对话」「轨迹」同级）；
2. `document.documentElement` 的 `data-cg-top-tab="registered"`；
3. 空会话（未发首条消息）标签栏不渲染——先发消息激活再断言 UI。

**陷阱**：桌面 App 对未认证 `/api/v1/*` 统一 401（不存在也 401），不能用状态码判别插件加载；
识别桌面 profile 的方法：桌面主进程 CommandLine 的第 4 参数（wmic 可查）。

## 附2：注册矩阵看板面板（cycle-117）

**客户端呈现**：工具栏「更多」→「注册矩阵」（menuitemcheckbox，key `registry`，稳定类名寻址走 `cg-registry-*`）。组件 `RegistryPanel` 三态互斥：

| 态 | 触发 | 呈现 |
|---|---|---|
| 不可达 | fetchRegistryBoard 回落 null | 「矩阵不可达」——null 与空矩阵绝不冒充 |
| 等待 | 拉取中 | 斜体提示 |
| 就绪 | 拉到矩阵 | 四面计数块 + 断链行 + live 计数 + 分面清单（36 行全展开） |

**live 实测层**（宿主侧，`probeRegistry(deps)`）：声明式 `lifecycle` 回答设计意图，`live` 回答此刻宿主进程实况——数据路由有图数据即 live / 无则 idle；`/watch` `/events` 随 watcher；元路由（/status /health /workspace /registry）恒 live；entries 在宿主侧 unknown（DOM 在客户端），basis 字段说明依据。`/status.registry.liveCounts` 是它的轻量形态。

**新业务接入清单**（三处同步，缺一被守卫抓住）：`businessRegistry.ts` 登记一行 + `guardTest` 指向真实测试 + routes.ts 注册数对齐。live 探针形状由契约 2 例守卫（全覆盖 + 空数据 idle 方向）。
