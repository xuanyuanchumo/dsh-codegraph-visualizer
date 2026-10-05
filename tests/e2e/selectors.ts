/**
 * E2E 选择器单一事实源。
 *
 * ## 为什么需要这个文件（cycle-81 的根因）
 *
 * TODO-02 在 `docs/需求分析.md` 里被登记了 12 次、跨 8 轮，描述一直是「Playwright 超时」。
 * 实测证伪：页面完全正常（`error-context.md` 快照里有「搜索符号 (按 /)」「就绪」「✓ 图谱完整」），
 * 真正的原因是**工具栏模块化之后类名变了，而 21 个 spec 里散落的字符串字面量没人跟着改**：
 *
 *   - `.cg-search-btn`        → `cg-search-standalone-btn`
 *   - `.cg-layout-btn`        → `cg-layout-dropdown-btn`（下拉触发器）+ `cg-layout-option-<name>`（选项）
 *   - `.cg-view-mode-btn`     → `cg-view-dropdown-btn` + `cg-viewmode-option-<mode>`
 *   - `.cg-graph-type-btn`    → `cg-graphtype-option-<type>`
 *   - `.cg-layer-btn`         → `cg-layer-option-<idx>`
 *   - `.cg-layer-selector`    → 不存在（层级选择器就是 `cg-level-dropdown-btn` 下拉）
 *   - `.cg-theme-btn`         → 不存在（主题在「更多」下拉里：`cg-more-theme`）
 *   - `.cg-lang-btn`          → 不存在（语言在「更多」下拉里：`cg-more-lang`）
 *   - `.cg-minimap-btn`       → 不存在（缩略图在「更多」下拉里：`cg-more-minimap`）
 *   - `.cg-minimap`           → `cg-mini-map`
 *   - `.cg-call-chain-btn`    → `cg-chain-btn`（且位于「工具」下拉内）
 *   - `.cg-filter-select`     → 不存在（筛选面板用 checkbox：`cg-filter-node-<type>`）
 *   - `.cg-collapse-all-btn`  → 不存在（「更多」下拉里的 `cg-more-collapseAll`）
 *   - `.cg-search-input`      → `#graph-search`
 *   - `.cg-selected`          → `'selected'`（cytoscape 节点类，不带 `cg-` 前缀）
 *   - `.cg-chain-highlight`   → `'call-chain'`（同上）
 *   - `.cg-keyboard-help`     → `cg-keyboard-help-panel`
 *   - `.cg-error-boundary`    → `cg-error-boundary-fallback`
 *   - `.cg-toolbar`           → `cg-graph-toolbar`
 *   - `.cg-zoom-in/out-btn`、`.cg-fit-btn` → 不存在（画布无缩放按钮，用 `cy.zoom()`）
 *
 * ## 契约
 *
 * `tests/unit/e2eSelectorContract.test.ts` 会解析本文件里所有 `cg-*` 字面量，
 * 断言每一个都能在 `src/` 中静态找到。因此**新增选择器时必须同时确认它在源码里真实存在**，
 * 否则单测会立刻失败——这正是 cycle-81 想要的「漂移不可能再次静默通过」。
 *
 * 例外：`.cg-analysis-panel` 系列的 `cg-<variant>-panel` 是运行时拼接的，见 `DYNAMIC_PREFIXES`。
 */

/** 面板根与画布容器。 */
export const PANEL = {
  root: '.cg-graph-panel',
  toolbar: '.cg-graph-toolbar',
  graphContainer: '.cg-graph-container',
  statusBar: '.cg-status-bar',
  nodeCount: '.cg-node-count',
  overlay: '.cg-error-overlay',
  loadingOverlay: '.cg-loading-overlay',
  emptyState: '.cg-empty-state',
  collapsedFab: '.cg-collapse-fab',
  collapsedClass: 'cg-collapsed',
  activeClass: 'cg-active',
} as const;

/** 工具栏三个视图/布局下拉的触发器。 */
export const TRIGGERS = {
  layout: '.cg-layout-dropdown-btn',
  view: '.cg-view-dropdown-btn',
  level: '.cg-level-dropdown-btn',
  data: '.cg-data-dropdown-btn',
  tools: '.cg-tools-dropdown-btn',
  history: '.cg-history-dropdown-btn',
  export: '.cg-export-btn',
  more: '.cg-more-btn',
  refresh: '.cg-refresh-btn',
  search: '.cg-search-standalone-btn',
  collapse: '.cg-collapse-btn',
  workspace: '.cg-workspace-selector',
} as const;

/** 下拉内容的容器（用于断言"下拉已打开"）。 */
export const DROPDOWN_CONTENT = {
  layout: '.cg-layout-dropdown',
  view: '.cg-view-dropdown',
  level: '.cg-level-dropdown',
  export: '.cg-export-dropdown',
  exportMenu: '.cg-export-menu',
  generic: '.cg-dropdown-content',
  item: '.cg-dropdown-item',
} as const;

/**
 * 下拉里的选项：这些是 cycle-81 新增的**稳定寻址类名**，
 * 不随 i18n 文案变化，也不依赖 `hasText` 正则。
 */
export const OPTION = {
  layout: (name: string) => `.cg-layout-option-${name}`,
  graphType: (type: string) => `.cg-graphtype-option-${type}`,
  viewMode: (mode: string) => `.cg-viewmode-option-${mode}`,
  level: (n: number) => `.cg-level-option-${n}`,
  clusterDepth: (n: number) => `.cg-clusterdepth-option-${n}`,
  more: (key: string) => `.cg-more-${key}`,
} as const;

/** 分析/质量面板开关：全部位于「工具」下拉内。 */
export const TOOL_ITEM = {
  chain: '.cg-chain-btn',
  cycles: '.cg-cycle-btn',
  impact: '.cg-impact-btn',
  inheritance: '.cg-inheritance-btn',
  pathFind: '.cg-pathfind-btn',
  health: '.cg-health-btn',
  rules: '.cg-rules-btn',
  hotspot: '.cg-hotspot-btn',
  godModule: '.cg-godmodule-btn',
  coreFunction: '.cg-corefunction-btn',
  deadCode: '.cg-deadcode-btn',
  isolateCycles: '.cg-isolate-btn',
} as const;

/** 「数据」下拉内的条目。 */
export const DATA_ITEM = {
  import: '.cg-import-btn',
  filterPanel: '.cg-filter-panel-btn',
} as const;

/** 「历史」下拉内的条目。 */
export const HISTORY_ITEM = {
  undo: '.cg-undo-btn',
  redo: '.cg-redo-btn',
} as const;

/** 「导出」下拉内的条目（类名由 `ToolbarSettings.tsx` 按 `EXPORT_FORMATS.value` 拼出）。 */
export const EXPORT_ITEM = {
  png: '.cg-export-option-png',
  svg: '.cg-export-option-svg',
  json: '.cg-export-option-json',
  mermaid: '.cg-export-option-mermaid',
  mermaidSeq: '.cg-export-option-mermaid-seq',
  mermaidClass: '.cg-export-option-mermaid-class',
  graphml: '.cg-export-option-graphml',
  jsonld: '.cg-export-option-jsonld',
} as const;

/** 搜索。 */
export const SEARCH = {
  bar: '.cg-search-bar',
  input: '#graph-search',
  closeBtn: '.cg-search-close-btn',
  resultItem: '.cg-search-result-item',
  results: '.cg-search-results',
} as const;

/** 筛选面板（checkbox 网格，不是 `<select>`）。
 *  注意：节点/边类型 checkbox 只把 `cg-filter-node-*` / `cg-filter-edge-*`
 *  写在 `id` 与 `name` 上，**没有 className**（`FilterPanel.tsx:143-172`），
 *  所以这里必须用 `#` 前缀而不是 `.`。 */
export const FILTER = {
  panel: '.cg-filter-panel',
  nodeType: (type: string) => `#cg-filter-node-${type}`,
  edgeType: (type: string) => `#cg-filter-edge-${type}`,
  includeInput: '#cg-filter-include',
  excludeInput: '#cg-filter-exclude',
  reset: '.cg-filter-reset-btn',
} as const;

/** 缩略图、图例、路径栏、聚焦栏、健康分卡片。 */
export const PANELS = {
  miniMap: '.cg-mini-map',
  legend: '.cg-legend-panel',
  healthScoreCard: '.cg-health-score-card',
  pathBar: '.cg-path-bar',
  pathFindBtn: '.cg-pathfind-btn',
  pathFindSubmit: '.cg-path-find-btn',
  pathClear: '.cg-path-clear-btn',
  pathStartInput: 'input[name="pathStart"]',
  pathEndInput: 'input[name="pathEnd"]',
  closeBtn: '.cg-close-btn',
  focusModeBar: '.cg-focus-mode-bar',
  focusExpand: '.cg-focus-expand-btn',
  focusContract: '.cg-focus-contract-btn',
  overlayBar: '.cg-overlay-bar',
} as const;

/** 分析面板根：`variant` 见 `AnalysisPanelShell` 调用方。 */
export const ANALYSIS_PANEL = {
  shell: '.cg-analysis-panel',
  close: '.cg-analysis-panel .cg-close-btn',
  coreFunction: '.cg-core-function-panel',
  cycle: '.cg-cycle-panel',
  impact: '.cg-impact-panel',
  hotspot: '.cg-hotspot-panel',
  godModule: '.cg-godmodule-panel',
  deadCode: '.cg-deadcode-panel',
} as const;

/** 微观视图（CFG / 流程图 / 时序图）。 */
export const MICRO = {
  emptyPrompt: '.cg-micro-empty-prompt',
  emptyBackBtn: '.cg-micro-empty-back-btn',
  functionBar: '.cg-micro-function-bar',
  sequenceContainer: '.cg-sequence-diagram-container',
  seqZoomControls: '.cg-seq-zoom-controls',
  detailBtn: '.cg-detail-micro-btn',
} as const;

/** 键盘帮助、错误边界与集成宿主。 */
export const MISC = {
  keyboardHelpOverlay: '.cg-keyboard-help-overlay',
  keyboardHelpPanel: '.cg-keyboard-help-panel',
  errorBoundaryFallback: '.cg-error-boundary-fallback',
  conversationViewWrapper: '.cg-conversation-view-wrapper',
  integrationHost: '.cg-integration-host',
  resizeHandle: '.cg-resize-handle',
} as const;

/**
 * Cytoscape 元素类名（**不带 `cg-` 前缀**）——它们是渲染层内部约定，
 * 与 CSS 类名空间不同，所以单独一组。
 */
export const CY_CLASS = {
  selected: 'selected',
  callChain: 'call-chain',
  highlighted: 'highlighted',
  cluster: 'isCluster',
} as const;

/**
 * 运行时拼接的类名族：`cg-<variant>-panel`。
 * 契约测试按前缀放行这几个，其余一律要求静态存在。
 */
export const DYNAMIC_PREFIXES = [
  'cg-filter-node-',
  'cg-filter-edge-',
  'cg-detail-edge-dir--',
  'cg-panel-stack-',
  'cg-cluster-hue-',
  'cg-sidebar-nav-btn',
  'cg-layout-option-',
  'cg-graphtype-option-',
  'cg-viewmode-option-',
  'cg-level-option-',
  'cg-clusterdepth-option-',
  'cg-more-',
  'cg-export-option-',
] as const;
