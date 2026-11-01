/**
 * 业务注册-生产-消费矩阵（cycle-116 可观测性主轴）。
 *
 * 本模块是**唯一事实源**：四面（tools / routes / entries / skill）的每一项业务都有一行，
 * 标明它的注册点（宿主 API 调用）、生产面（数据从哪来）、消费面（谁在读）、守卫测试（谁保证它不静默失效）。
 *
 * 设计约束：
 * - 纯静态数据 + 可选的运行时探针（`probe()`），无副作用、无 React、无网络请求——
 *   同一份清单同时服务宿主路由（/api/v1/codegraph/registry）、dev-server 与文档生成。
 * - 每一项的 `guardTest` 指向**真实存在的测试文件**；清单与测试不同步时由
 *   `registryContract.test.ts` 抓住（守卫的守卫）。
 * - 「断链」判定是声明式的：`consumers.length === 0` 即断链，看板直接标红。
 */

export interface RegistryEntry {
  /** 业务 id（全局唯一，跨四面不重复）。 */
  id: string;
  /** 面：tools=LLM 工具 / routes=HTTP 路由 / entries=UI 入口 / skill=技能贡献。 */
  face: 'tools' | 'routes' | 'entries' | 'skill';
  /** 注册点：宿主 API 调用的 file:line（重构后会漂移，契约测试按 id 对齐）。 */
  registeredAt: string;
  /** 生产面：数据/行为的来源描述。 */
  produces: string;
  /** 消费面：谁在读/调。空数组 = 断链（看板标红）。 */
  consumers: string[];
  /** 守卫测试文件（不含路径，契约测试核对存在性）。 */
  guardTest?: string;
  /** 生命周期状态（五态）：registered → producing → consuming → degraded → disposed。 */
  lifecycle: 'registered' | 'producing' | 'consuming' | 'degraded' | 'disposed';
}

/** LLM 工具（11 个）——factory 返回与 entry 注册的集合相等性由 tools.test.ts 守卫。 */
export const TOOL_ENTRIES: RegistryEntry[] = [
  { id: 'graph_status', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '能力位 + 工作区索引状态', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_data', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '合并图数据（codegraph+lens，增量 delta）', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_symbol', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '节点符号详情 + AST 摘要', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_impact', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '变更影响面（三级扩散）', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_path_find', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '两节点间路径', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_path_enumerate', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '路径枚举（截断语义：序/top-k-weight）', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_cycles', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '环检测（Booth 规范化）', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_health', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '架构健康评分', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_rules_check', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '规则引擎违规清单', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_focus', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '邻域聚焦子图', consumers: ['LLM 会话', 'tests/unit/tools.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_query', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '关键词图检索（璇玑图 top-k）', consumers: ['LLM 会话', 'tests/unit/tools.test.ts', 'tests/unit/keywordQueryApi.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
  { id: 'graph_integrity', face: 'tools', registeredAt: 'src/index.ts (ctx.tools.register)', produces: '璇玑图白盒体检（变更日志水位 / 逐规则索引计数 / 休眠态披露）', consumers: ['LLM 会话', 'tests/unit/tools.test.ts', 'tests/unit/xuanjiAdapter.test.ts'], guardTest: 'tools.test.ts', lifecycle: 'consuming' },
];

/** HTTP 路由（19 条）——tree-sitter/health 的消费面是测试与 E2E（外部消费）。 */
export const ROUTE_ENTRIES: RegistryEntry[] = [
  { id: '/data', face: 'routes', registeredAt: 'src/host/routes/dataRoutes.ts:65', produces: '合并图数据 JSON', consumers: ['client bootstrap/dataChannels', 'graph_data tool'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/bootstrap', face: 'routes', registeredAt: 'src/host/routes/dataRoutes.ts:107', produces: '首屏引导数据', consumers: ['client bootstrap'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/children', face: 'routes', registeredAt: 'src/host/routes/dataRoutes.ts:196', produces: '展开子图（目录/文件/符号）', consumers: ['client expandNode'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/files', face: 'routes', registeredAt: 'src/host/routes/dataRoutes.ts:271', produces: '文件清单', consumers: ['client file-scope'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/symbols', face: 'routes', registeredAt: 'src/host/routes/dataRoutes.ts:332', produces: '符号表', consumers: ['client symbol panel', 'graph_symbol tool'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/edges', face: 'routes', registeredAt: 'src/host/routes/dataRoutes.ts:442', produces: '边集（聚合分页）', consumers: ['client edge panel'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/dependencies', face: 'routes', registeredAt: 'src/host/routes/analysisRoutes.ts:39', produces: '依赖关系（多代兼容）', consumers: ['client dependencies view'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/churn', face: 'routes', registeredAt: 'src/host/routes/analysisRoutes.ts:132', produces: 'git 变更频率', consumers: ['client hotspot panel'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/diff', face: 'routes', registeredAt: 'src/host/routes/analysisRoutes.ts:201', produces: '版本对比', consumers: ['client diff panel'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/ast', face: 'routes', registeredAt: 'src/host/routes/analysisRoutes.ts:281', produces: '符号 AST（分页+预算）', consumers: ['client AST panel', 'graph_symbol tool'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/tree-sitter', face: 'routes', registeredAt: 'src/host/routes/analysisRoutes.ts:320', produces: 'tree-sitter 解析对照', consumers: ['tests/unit/pathParityAndRevealContract.test.ts（外部消费）'], guardTest: 'pathParityAndRevealContract.test.ts', lifecycle: 'consuming' },
  { id: '/status', face: 'routes', registeredAt: 'src/host/routes/statusRoutes.ts:10', produces: '能力位 + 索引状态', consumers: ['client 空态判定', '本 registry 路由'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/health', face: 'routes', registeredAt: 'src/host/routes/statusRoutes.ts:37', produces: '健康度（503 语义）', consumers: ['E2E diff-and-integration.spec', 'dev-server.mjs（外部消费）'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/workspace', face: 'routes', registeredAt: 'src/host/routes/statusRoutes.ts:83', produces: '工作区清单', consumers: ['client workspace selector'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/scan', face: 'routes', registeredAt: 'src/host/routes/controlRoutes.ts:17', produces: '工作区扫描（建索引）', consumers: ['client 扫描按钮'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/init', face: 'routes', registeredAt: 'src/host/routes/controlRoutes.ts:99', produces: '索引初始化', consumers: ['client init'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/watch', face: 'routes', registeredAt: 'src/host/routes/controlRoutes.ts:168', produces: '文件监听开关', consumers: ['client watcher'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/events', face: 'routes', registeredAt: 'src/host/routes/controlRoutes.ts:194', produces: 'SSE 增量事件流', consumers: ['client SSE channel'], guardTest: 'routes.test.ts', lifecycle: 'consuming' },
  { id: '/query', face: 'routes', registeredAt: 'src/host/routes/queryRoute.ts:93', produces: '关键词检索（五维 etag 键）', consumers: ['client keyword panel', 'graph_query tool'], guardTest: 'xuanjiIntegrationContract.test.ts', lifecycle: 'consuming' },
  { id: '/worker', face: 'routes', registeredAt: 'src/host/routes/workerRoutes.ts:69', produces: '布局 worker 脚本（fcose/dagre 布局计算，IIFE 静态资源）', consumers: ['client LayoutController', 'tests/unit/LayoutController.test.ts'], guardTest: 'LayoutController.test.ts', lifecycle: 'consuming' },
  { id: '/paths', face: 'routes', registeredAt: 'src/host/routes/pathsRoute.ts:56', produces: '路径枚举（璇玑图路径规则读法的用户侧出口，所见即所查）', consumers: ['client PathBar（下一轮接线）', 'graph_path_enumerate tool（同算法）'], guardTest: 'pathsRoute.test.ts', lifecycle: 'consuming' },
];

/** UI 入口席位（4 通道优先级链）。状态由 topTabObservability 写 DOM 标记。 */
export const ENTRY_ITEMS: RegistryEntry[] = [
  { id: 'conversation.view', face: 'entries', registeredAt: 'src/client/integrations/ConversationViewIntegration.ts', produces: '主会话顶部「代码图谱」标签', consumers: ['会话面板用户'], guardTest: 'topTabRegistration.test.tsx', lifecycle: 'consuming' },
  { id: 'sidebar-right-tab', face: 'entries', registeredAt: 'src/client/integrations/SidebarRightTabsIntegration.ts', produces: '右侧栏 tab（回退通道）', consumers: ['右侧栏用户'], guardTest: 'SidebarRightTabsIntegration.test.ts', lifecycle: 'consuming' },
  { id: 'better-sidebar', face: 'entries', registeredAt: 'src/client/integrations/BetterSidebarIntegration.ts', produces: 'dsh-better-sidebar tab（回退通道）', consumers: ['better-sidebar 用户'], guardTest: 'BetterSidebarIntegration.test.ts', lifecycle: 'consuming' },
  { id: 'floating-panel', face: 'entries', registeredAt: 'src/client/integrations/FloatingPanelIntegration.ts', produces: '浮动面板（最后回退）', consumers: ['浮动面板用户'], guardTest: 'FloatingPanelIntegration.test.ts', lifecycle: 'consuming' },
];

/** 技能贡献（runtime skill，/commands 面板 + 模型侧） */
export const SKILL_ENTRIES: RegistryEntry[] = [
  { id: 'graph-skill', face: 'skill', registeredAt: 'src/host/skills.ts (contributeGraphSkill)', produces: '图检索技能说明（/ 面板与模型提示）', consumers: ['LLM 会话', '用户 / 面板'], guardTest: 'hostSkillContribution.test.ts', lifecycle: 'consuming' },
];

/** 全量清单（四面合一）。 */
export function allEntries(): RegistryEntry[] {
  return [...TOOL_ENTRIES, ...ROUTE_ENTRIES, ...ENTRY_ITEMS, ...SKILL_ENTRIES];
}

/** 断链项（consumers 为空——当前应为 0，非 0 即看板红）。 */
export function brokenLinks(): RegistryEntry[] {
  return allEntries().filter((e) => e.consumers.length === 0);
}

/** 看板摘要（宿主路由与 dev-server 共用的返回形状）。 */
export function registrySummary() {
  const entries = allEntries();
  const byFace = new Map<string, number>();
  for (const e of entries) byFace.set(e.face, (byFace.get(e.face) ?? 0) + 1);
  return {
    version: 1,
    generatedAt: Date.now(),
    total: entries.length,
    byFace: Object.fromEntries(byFace),
    brokenLinks: brokenLinks().map((e) => e.id),
    lifecycleCounts: {
      registered: entries.filter((e) => e.lifecycle === 'registered').length,
      producing: entries.filter((e) => e.lifecycle === 'producing').length,
      consuming: entries.filter((e) => e.lifecycle === 'consuming').length,
      degraded: entries.filter((e) => e.lifecycle === 'degraded').length,
      disposed: entries.filter((e) => e.lifecycle === 'disposed').length,
    },
    entries,
  };
}


/** 宿主运行时依赖的最小形状（避免拉入完整 Deps 类型造成循环依赖）。 */
export interface RegistryProbeDeps {
  getLastGraphData: () => unknown | null;
  isWatcherEnabled?: () => boolean;
  apiCompat?: unknown;
  featureFlags?: { readonly [key: string]: unknown } | object | null;
}

/** 单业务运行时探针结果。 */
export interface LiveHint {
  id: string;
  face: RegistryEntry['face'];
  /** 实测生命周期：由宿主状态推导，与声明式 lifecycle 独立。 */
  live: 'live' | 'idle' | 'degraded' | 'unknown';
  /** 人类可读的实测依据。 */
  basis: string;
}

/**
 * 运行时探针（cycle-117：lifecycle 从声明式转实测式）。
 *
 * 声明式 `lifecycle` 回答「设计上该业务处于什么阶段」；本函数回答「此刻宿主进程里
 * 它到底活不活」。两者可能合法地不同：`/scan` 声明 consuming，但从未扫描时实测 idle。
 *
 * 探测原理（全部零副作用）：
 * - routes：图数据有无（多数数据/分析路由的工作前提）+ watcher 开关（/watch、/events）；
 * - tools：与 routes 同源（工具经 invoke 调路由 handler），图数据在即 live；
 * - entries：宿主侧不可测（DOM 在客户端）→ `unknown` + basis 说明，客户端看板用 DOM 标记补齐；
 * - skill：featureFlags 里 commandUi 类位存在即 live。
 */
export function probeRegistry(deps: RegistryProbeDeps): LiveHint[] {
  const hasGraph = deps.getLastGraphData() !== null;
  const watcherOn = deps.isWatcherEnabled?.() ?? false;
  const flags = (deps.featureFlags ?? {}) as Record<string, unknown>;

  const routeHint = (id: string, basis: string, live: LiveHint['live']): LiveHint => ({ id, face: 'routes', live, basis });

  const routeLive = (id: string): LiveHint => {
    if (id === '/watch' || id === '/events') {
      return routeHint(id, watcherOn ? 'watcher 已启用' : 'watcher 未启用（路由注册但无事件流）', watcherOn ? 'live' : 'idle');
    }
    if (id === '/status' || id === '/health' || id === '/workspace' || id === '/registry') {
      return routeHint(id, '状态/元路由：无图数据也响应', 'live');
    }
    return routeHint(id, hasGraph ? '图数据在内存中' : '图数据未加载（先扫描/导入）', hasGraph ? 'live' : 'idle');
  };

  return [
    ...allEntries().filter((e) => e.face === 'routes').map((e) => routeLive(e.id)),
    ...allEntries().filter((e) => e.face === 'tools').map((e): LiveHint => ({
      id: e.id, face: 'tools',
      live: hasGraph ? 'live' : 'idle',
      basis: hasGraph ? 'invoke 链路可用（图数据在）' : 'invoke 链路可用但数据为空',
    })),
    ...allEntries().filter((e) => e.face === 'entries').map((e): LiveHint => ({
      id: e.id, face: 'entries', live: 'unknown',
      basis: '入口状态在客户端 DOM（data-cg-top-tab / 集成状态标记），宿主侧不可测',
    })),
    ...allEntries().filter((e) => e.face === 'skill').map((e): LiveHint => ({
      id: e.id, face: 'skill',
      live: Object.keys(flags).length > 0 ? 'live' : 'unknown',
      basis: Object.keys(flags).length > 0 ? 'featureFlags 已解析' : 'featureFlags 为空',
    })),
  ];
}

/** live 探针结果计数（/status 摘要用轻量形态）。 */
export function countLive(hints: LiveHint[]): Record<string, number> {
  const out: Record<string, number> = { live: 0, idle: 0, degraded: 0, unknown: 0 };
  for (const h of hints) out[h.live] = (out[h.live] ?? 0) + 1;
  return out;
}
