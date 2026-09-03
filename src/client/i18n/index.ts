// Lightweight i18n: zh/en dictionary + useSyncExternalStore hook.
// Ponytail: no deps, ~120 lines. Keys are dot-notation strings.

import { useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';

type Dict = Record<string, string>;

const en: Dict = {
  // Panel
  'panel.ariaLabel': 'Code graph visualizer',
  'panel.expand': 'Expand graph panel',
  'panel.collapse': 'Collapse',
  'panel.expandPanel': 'Expand panel',
  'panel.collapsePanel': 'Collapse panel',

  // Toolbar
  'toolbar.import': 'Import graph (Ctrl+I)',
  'toolbar.filter': 'Filter by node type',
  'toolbar.search': 'Search symbols (press /)',
  'toolbar.chain': 'Toggle call chain highlight (Ctrl+C)',
  'toolbar.cycles': 'Highlight circular dependencies',
  'toolbar.minimap': 'Toggle mini-map (Ctrl+M)',
  'toolbar.legend': 'Toggle legend',
  'toolbar.refresh': 'Refresh graph',
  'toolbar.dataGroup': 'Data controls',
  'toolbar.analysisGroup': 'Analysis tools',
  'toolbar.viewGroup': 'View controls',
  'toolbar.settingsGroup': 'Settings',
  'toolbar.theme': 'Toggle theme',
  'toolbar.export': 'Export graph',
  'toolbar.lang': 'Switch language',
  'toolbar.layout': 'Switch to {l} layout (Ctrl+L cycles)',
  'toolbar.graphType': 'Graph type switcher',
  'toolbar.cluster': 'Cluster level',

  // Cluster levels
  'cluster.directory': 'Directory',
  'cluster.file': 'File',
  'cluster.function': 'Function',

  // Filter options
  'filter.all': 'All Types',
  'filter.function': 'Functions',
  'filter.class': 'Classes',
  'filter.variable': 'Variables',
  'filter.module': 'Modules',
  'filter.interface': 'Interfaces',

  // Graph type
  'graphType.all': 'All',
  'graphType.call': 'Calls',
  'graphType.dependency': 'Deps',

  // Search
  'search.placeholder': 'Search symbols…',
  'search.close': 'Close search',
  'search.noMatch': 'No matching symbols',
  'search.match': '{n} match',
  'search.matches': '{n} matches',
  'search.debounced': 'debounced 200ms',

  // States
  'state.loading': 'Loading graph…',
  'state.ready': 'Ready',
  'state.error': 'Error',
  'state.noData': 'No data',
  'state.updated': 'Updated {time}',
  'state.truncated': 'Showing top {shown} of {total} nodes',
  'state.truncatedHint': 'Graph is truncated for performance. Showing most important nodes.',

  // Empty state
  'empty.title': 'No graph data yet',
  'empty.subtitle': 'Import a .codegraph folder, paste graph data, or scan a repository.',
  'empty.import': 'Import Graph',

  // Error boundary
  'error.title': 'Something went wrong',
  'error.retry': 'Retry',

  // Node detail
  'detail.ariaLabel': 'Node details',
  'detail.close': 'Close details',
  'detail.type': 'Type',
  'detail.file': 'File',
  'detail.line': 'Line',
  'detail.properties': 'Properties',
  'detail.connections': 'Connections',
  'detail.doubleClickExpand': 'Double-click to expand related nodes',
  'detail.expanded': 'Expanded',
  'detail.collapse': 'Collapse',

  // Mini-map
  'minimap.title': 'Overview',
  'minimap.close': 'Close mini-map',
  'minimap.functions': 'Functions',
  'minimap.classes': 'Classes',
  'minimap.variables': 'Variables',
  'minimap.modules': 'Modules',
  'minimap.interfaces': 'Interfaces',
  'minimap.total': 'Total',

  // Import panel
  'import.title': 'Import Graph',
  'import.close': 'Close import',
  'import.workspace': 'Workspace',
  'import.paste': 'Paste',
  'import.workspacePath': 'Current workspace path',
  'import.workspaceHint': 'Scan the current DSH workspace for .codegraph database',
  'import.scanWorkspace': 'Scan Workspace',
  'import.scanning': 'Scanning…',
  'import.pastePlaceholder': 'Paste graph JSON here, e.g. {"nodes":[...],"edges":[...]}',
  'import.importJson': 'Import JSON',
  'import.importing': 'Importing…',

  'import.fileTooLarge': 'File too large (max 10 MB)',
  'import.pasteFirst': 'Paste JSON first',
  'import.enterPath': 'Enter a repository path',
  'import.imported': 'Imported {nodes} nodes · {edges} edges',
  'import.importFailed': 'Import failed: {msg}',
  'import.requestedScan': 'Requested scan of {path}',
  'import.fileReadError': 'File read error',
  'import.prereqMissing': 'Prerequisite plugins (dsh-codegraph or dsh-tool-lens) not detected. Install one for full functionality.',
  'import.prereqCmd': '{cmd}',
  'import.prereqCopy': 'Copy install command',
  'import.copied': 'Copied',
  'import.initGraph': 'Initialize Graph',
  'import.initializing': 'Initializing…',
  'import.initStarted': 'Initializing graph for {path}',
  'import.initSuccess': 'Graph initialized successfully',
  'import.initFailed': 'Initialization failed — check prerequisite plugins',
  'import.watchOn': 'Auto Refresh: ON',
  'import.watchOff': 'Auto Refresh: OFF',

  // Legend
  'legend.title': 'Legend',
  'legend.close': 'Close legend',
  'legend.nodes': 'Nodes',
  'legend.edges': 'Edges',
  'legend.function': 'Function',
  'legend.class': 'Class',
  'legend.variable': 'Variable',
  'legend.module': 'Module',
  'legend.interface': 'Interface',
  'legend.type': 'Type',
  'legend.call': 'calls',
  'legend.import': 'imports',
  'legend.extend': 'extends',
  'legend.implement': 'implements',
  'legend.dependency': 'depends on',

  // Export
  'export.png': 'PNG',
  'export.svg': 'SVG',
  'export.json': 'JSON',

  // Workspace
  'workspace.title': 'Workspace',
  'workspace.current': 'Current Workspace',
  'workspace.switch': 'Switch Workspace',
  'workspace.add': 'Add Workspace',
  'workspace.remove': 'Remove',
  'workspace.empty': 'No workspaces yet',
  'workspace.namePlaceholder': 'Workspace path or name',
  'workspace.addHint': 'Enter a path and press Enter to add',
  'workspace.active': 'Active',
  'workspace.lastUsed': 'Last used',
  'workspace.default': 'Default',

  // Prerequisite plugin install commands
  'prereq.installCodegraph': 'dsh plugin --profile web add dsh-codegraph',
  'prereq.installLens': 'dsh plugin --profile web add dsh-tool-lens',
  'prereq.installTitle': 'Install Prerequisite Plugin',
  'prereq.detecting': 'Detecting prerequisite plugins…',
  'prereq.found': 'Prerequisite plugin detected',
  'prereq.notFound': 'Not detected',
  'prereq.codegraphLabel': 'dsh-codegraph',
  'prereq.lensLabel': 'dsh-tool-lens',
  'prereq.codegraphDesc': 'Required for code graph data — provides 20+ language support and incremental indexing.',
  'prereq.lensDesc': 'Optional — provides AST-precise analysis and impact detection.',

  // Graph initialization
  'graph.init': 'Initialize Graph',
  'graph.initializing': 'Initializing graph…',
  'graph.initSuccess': 'Graph initialized successfully',
  'graph.initFailed': 'Initialization failed',
  'graph.refresh': 'Refresh',
  'graph.hotUpdate': 'Hot Update',
  'graph.hotUpdateOn': 'Auto refresh: ON',
  'graph.hotUpdateOff': 'Auto refresh: OFF',

  // Enhanced empty state
  'empty.prereqTitle': 'Prerequisite Plugin Required',
  'empty.prereqDesc': 'Install dsh-codegraph or dsh-tool-lens for full functionality:',
  'empty.copyCmd': 'Copy install command',
  'empty.copied': 'Copied!',
  'empty.scanWorkspace': 'Scan Current Workspace',

  // Keyboard shortcuts
  'shortcut.title': 'Keyboard Shortcuts',
  'shortcut.close': 'Close',
  'shortcut.search': 'Search symbols',
  'shortcut.closeAll': 'Close all panels',
  'shortcut.callChain': 'Toggle call chain',
  'shortcut.minimap': 'Toggle mini-map',
  'shortcut.layout': 'Cycle layout',
  'shortcut.import': 'Toggle import panel',
  'shortcut.help': 'Show this help',
};

const zh: Dict = {
  // Panel
  'panel.ariaLabel': '代码图谱可视化',
  'panel.expand': '展开图谱面板',
  'panel.collapse': '折叠',
  'panel.expandPanel': '展开面板',
  'panel.collapsePanel': '折叠面板',

  // Toolbar
  'toolbar.import': '导入图谱 (Ctrl+I)',
  'toolbar.filter': '按节点类型筛选',
  'toolbar.search': '搜索符号 (按 /)',
  'toolbar.chain': '切换调用链高亮 (Ctrl+C)',
  'toolbar.cycles': '高亮循环依赖',
  'toolbar.minimap': '切换缩略图 (Ctrl+M)',
  'toolbar.legend': '切换图例',
  'toolbar.refresh': '刷新图谱',
  'toolbar.dataGroup': '数据控制',
  'toolbar.analysisGroup': '分析工具',
  'toolbar.viewGroup': '视图控制',
  'toolbar.settingsGroup': '设置',
  'toolbar.theme': '切换主题',
  'toolbar.export': '导出图谱',
  'toolbar.lang': '切换语言',
  'toolbar.layout': '切换至 {l} 布局 (Ctrl+L 循环)',
  'toolbar.graphType': '图谱类型切换',
  'toolbar.cluster': '聚类层级',

  // 聚类层级
  'cluster.directory': '目录级',
  'cluster.file': '文件级',
  'cluster.function': '函数级',

  // Filter options
  'filter.all': '全部类型',
  'filter.function': '函数',
  'filter.class': '类',
  'filter.variable': '变量',
  'filter.module': '模块',
  'filter.interface': '接口',

  // 图谱类型
  'graphType.all': '全部',
  'graphType.call': '调用',
  'graphType.dependency': '依赖',

  // Search
  'search.placeholder': '搜索符号…',
  'search.close': '关闭搜索',
  'search.noMatch': '无匹配符号',
  'search.match': '{n} 个匹配',
  'search.matches': '{n} 个匹配',
  'search.debounced': '防抖 200ms',

  // States
  'state.loading': '加载图谱中…',
  'state.ready': '就绪',
  'state.error': '错误',
  'state.noData': '无数据',
  'state.updated': '更新于 {time}',
  'state.truncated': '显示前 {shown}/{total} 节点',
  'state.truncatedHint': '图谱已截断以提升性能，仅显示最重要的节点。',

  // Empty state
  'empty.title': '暂无图谱数据',
  'empty.subtitle': '导入 .codegraph 文件夹、粘贴图谱数据或扫描仓库。',
  'empty.import': '导入图谱',

  // Error boundary
  'error.title': '出错了',
  'error.retry': '重试',

  // Node detail
  'detail.ariaLabel': '节点详情',
  'detail.close': '关闭详情',
  'detail.type': '类型',
  'detail.file': '文件',
  'detail.line': '行号',
  'detail.properties': '属性',
  'detail.connections': '连接数',
  'detail.doubleClickExpand': '双击展开相关节点',
  'detail.expanded': '已展开',
  'detail.collapse': '收起',

  // Mini-map
  'minimap.title': '概览',
  'minimap.close': '关闭缩略图',
  'minimap.functions': '函数',
  'minimap.classes': '类',
  'minimap.variables': '变量',
  'minimap.modules': '模块',
  'minimap.interfaces': '接口',
  'minimap.total': '总计',

  // Import panel
  'import.title': '导入图谱',
  'import.close': '关闭导入',
  'import.workspace': '工作区',
  'import.paste': '粘贴',
  'import.workspacePath': '当前工作区路径',
  'import.workspaceHint': '扫描当前 DSH 工作区的 .codegraph 数据库',
  'import.scanWorkspace': '扫描工作区',
  'import.scanning': '扫描中…',
  'import.pastePlaceholder': '在此粘贴图谱 JSON，例如 {"nodes":[...],"edges":[...]}',
  'import.importJson': '导入 JSON',
  'import.importing': '导入中…',
  'import.fileTooLarge': '文件过大 (最大 10 MB)',
  'import.pasteFirst': '请先粘贴 JSON',
  'import.enterPath': '请输入仓库路径',
  'import.imported': '已导入 {nodes} 节点 · {edges} 边',
  'import.importFailed': '导入失败: {msg}',
  'import.requestedScan': '已请求扫描 {path}',
  'import.fileReadError': '文件读取错误',
  'import.prereqMissing': '未检测到前置插件 (dsh-codegraph 或 dsh-tool-lens)。请安装其一以获得完整功能。',
  'import.prereqCmd': '{cmd}',
  'import.prereqCopy': '复制安装命令',
  'import.copied': '已复制',
  'import.initGraph': '初始化图谱',
  'import.initializing': '初始化中…',
  'import.initStarted': '正在为 {path} 初始化图谱',
  'import.initSuccess': '图谱初始化成功',
  'import.initFailed': '初始化失败 — 请检查前置插件',
  'import.watchOn': '热更新: 开启',
  'import.watchOff': '热更新: 关闭',

  // Legend
  'legend.title': '图例',
  'legend.close': '关闭图例',
  'legend.nodes': '节点',
  'legend.edges': '边',
  'legend.function': '函数',
  'legend.class': '类',
  'legend.variable': '变量',
  'legend.module': '模块',
  'legend.interface': '接口',
  'legend.type': '类型',
  'legend.call': '调用',
  'legend.import': '导入',
  'legend.extend': '继承',
  'legend.implement': '实现',
  'legend.dependency': '依赖',

  // Export
  'export.png': 'PNG',
  'export.svg': 'SVG',
  'export.json': 'JSON',

  // Workspace
  'workspace.title': '工作区',
  'workspace.current': '当前工作区',
  'workspace.switch': '切换工作区',
  'workspace.add': '添加工作区',
  'workspace.remove': '移除',
  'workspace.empty': '暂无工作区',
  'workspace.namePlaceholder': '工作区路径或名称',
  'workspace.addHint': '输入路径后按回车添加',
  'workspace.active': '活跃',
  'workspace.lastUsed': '上次使用',
  'workspace.default': '默认',

  // 前置插件安装命令
  'prereq.installCodegraph': 'dsh plugin --profile web add dsh-codegraph',
  'prereq.installLens': 'dsh plugin --profile web add dsh-tool-lens',
  'prereq.installTitle': '安装前置插件',
  'prereq.detecting': '正在检测前置插件…',
  'prereq.found': '已检测到前置插件',
  'prereq.notFound': '未检测到',
  'prereq.codegraphLabel': 'dsh-codegraph',
  'prereq.lensLabel': 'dsh-tool-lens',
  'prereq.codegraphDesc': '必需 — 提供 20+ 语言支持和增量索引。',
  'prereq.lensDesc': '可选 — 提供 AST 精准分析和影响检测。',

  // 图谱初始化
  'graph.init': '初始化图谱',
  'graph.initializing': '正在初始化图谱…',
  'graph.initSuccess': '图谱初始化成功',
  'graph.initFailed': '初始化失败',
  'graph.refresh': '刷新',
  'graph.hotUpdate': '热更新',
  'graph.hotUpdateOn': '自动刷新: 开启',
  'graph.hotUpdateOff': '自动刷新: 关闭',

  // 增强空状态
  'empty.prereqTitle': '需要前置插件',
  'empty.prereqDesc': '安装 dsh-codegraph 或 dsh-tool-lens 以获得完整功能：',
  'empty.copyCmd': '复制安装命令',
  'empty.copied': '已复制！',
  'empty.scanWorkspace': '扫描当前工作区',

  // 键盘快捷键
  'shortcut.title': '键盘快捷键',
  'shortcut.close': '关闭',
  'shortcut.search': '搜索符号',
  'shortcut.closeAll': '关闭所有面板',
  'shortcut.callChain': '切换调用链',
  'shortcut.minimap': '切换缩略图',
  'shortcut.layout': '循环切换布局',
  'shortcut.import': '切换导入面板',
  'shortcut.help': '显示此帮助',
};

const dicts: Record<Lang, Dict> = { zh, en };

// ── Store ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'dsh-codegraph-visualizer/lang';
let currentLang: Lang = 'zh';
const listeners = new Set<() => void>();

function getStoredLang(): Lang {
  if (typeof window === 'undefined') return 'zh';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'zh' || stored === 'en' ? stored : 'zh';
  } catch { return 'zh'; }
}

export function getLang(): Lang { return currentLang; }

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage unavailable */ }
  }
  for (const fn of listeners) fn();
}

export function toggleLang(): void {
  setLang(currentLang === 'zh' ? 'en' : 'zh');
}

// Initialize persisted language preference early (J10 personalization).
currentLang = getStoredLang();

// Subscribe for useSyncExternalStore
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── Hook ─────────────────────────────────────────────────────────────────
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

// ── Translate ────────────────────────────────────────────────────────────
export function t(key: string, params?: Record<string, string | number>): string {
  let str = dicts[currentLang][key] ?? dicts.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

// Hook that re-renders on lang change
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  useLang(); // subscribe
  return t;
}