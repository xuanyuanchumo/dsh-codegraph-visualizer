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
  'toolbar.theme': 'Toggle theme',
  'toolbar.export': 'Export graph',
  'toolbar.lang': 'Switch language',
  'toolbar.layout': 'Switch to {l} layout (Ctrl+L cycles)',

  // Filter options
  'filter.all': 'All Types',
  'filter.function': 'Functions',
  'filter.class': 'Classes',
  'filter.variable': 'Variables',
  'filter.module': 'Modules',
  'filter.interface': 'Interfaces',

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

  // Empty state
  'empty.title': 'No graph data yet',
  'empty.subtitle': 'Import a .codegraph folder, paste graph data, or scan a repository.',
  'empty.import': 'Import Graph',

  // Node detail
  'detail.ariaLabel': 'Node details',
  'detail.close': 'Close details',
  'detail.type': 'Type',
  'detail.file': 'File',
  'detail.line': 'Line',
  'detail.properties': 'Properties',

  // Mini-map
  'minimap.title': 'Overview',
  'minimap.close': 'Close mini-map',
  'minimap.functions': 'Functions',
  'minimap.classes': 'Classes',
  'minimap.variables': 'Variables',
  'minimap.modules': 'Modules',
  'minimap.interfaces': 'Interfaces',

  // Import panel
  'import.title': 'Import Graph',
  'import.close': 'Close import',
  'import.folder': 'Folder',
  'import.paste': 'Paste',
  'import.repo': 'Repo',
  'import.dropText': 'Drop .codegraph folder here or click to browse',
  'import.dropHint': 'Scans .codegraph/ directory for graph JSON files',
  'import.scanning': 'Scanning folder…',
  'import.noJson': 'No .json files found in folder',
  'import.pastePlaceholder': 'Paste graph JSON here, e.g. {"nodes":[...],"edges":[...]}',
  'import.importJson': 'Import JSON',
  'import.importing': 'Importing…',
  'import.repoPlaceholder': '/path/to/repository or .',
  'import.repoHint': 'Host will scan the path and build a code graph.',
  'import.scanRepo': 'Scan Repository',
  'import.scanningRepo': 'Scanning…',
  'import.fileTooLarge': 'File too large (max 10 MB)',
  'import.pasteFirst': 'Paste JSON first',
  'import.enterPath': 'Enter a repository path',
  'import.imported': 'Imported {nodes} nodes · {edges} edges',
  'import.importFailed': 'Import failed: {msg}',
  'import.requestedScan': 'Requested scan of {path}',
  'import.fileReadError': 'File read error',

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
  'toolbar.theme': '切换主题',
  'toolbar.export': '导出图谱',
  'toolbar.lang': '切换语言',
  'toolbar.layout': '切换至 {l} 布局 (Ctrl+L 循环)',

  // Filter options
  'filter.all': '全部类型',
  'filter.function': '函数',
  'filter.class': '类',
  'filter.variable': '变量',
  'filter.module': '模块',
  'filter.interface': '接口',

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

  // Empty state
  'empty.title': '暂无图谱数据',
  'empty.subtitle': '导入 .codegraph 文件夹、粘贴图谱数据或扫描仓库。',
  'empty.import': '导入图谱',

  // Node detail
  'detail.ariaLabel': '节点详情',
  'detail.close': '关闭详情',
  'detail.type': '类型',
  'detail.file': '文件',
  'detail.line': '行号',
  'detail.properties': '属性',

  // Mini-map
  'minimap.title': '概览',
  'minimap.close': '关闭缩略图',
  'minimap.functions': '函数',
  'minimap.classes': '类',
  'minimap.variables': '变量',
  'minimap.modules': '模块',
  'minimap.interfaces': '接口',

  // Import panel
  'import.title': '导入图谱',
  'import.close': '关闭导入',
  'import.folder': '文件夹',
  'import.paste': '粘贴',
  'import.repo': '仓库',
  'import.dropText': '拖放 .codegraph 文件夹到此处或点击选择',
  'import.dropHint': '扫描 .codegraph/ 目录中的图谱 JSON 文件',
  'import.scanning': '扫描文件夹中…',
  'import.noJson': '文件夹中未找到 .json 文件',
  'import.pastePlaceholder': '在此粘贴图谱 JSON，例如 {"nodes":[...],"edges":[...]}',
  'import.importJson': '导入 JSON',
  'import.importing': '导入中…',
  'import.repoPlaceholder': '/path/to/repository 或 .',
  'import.repoHint': '宿主将扫描路径并构建代码图谱。',
  'import.scanRepo': '扫描仓库',
  'import.scanningRepo': '扫描中…',
  'import.fileTooLarge': '文件过大 (最大 10 MB)',
  'import.pasteFirst': '请先粘贴 JSON',
  'import.enterPath': '请输入仓库路径',
  'import.imported': '已导入 {nodes} 节点 · {edges} 边',
  'import.importFailed': '导入失败: {msg}',
  'import.requestedScan': '已请求扫描 {path}',
  'import.fileReadError': '文件读取错误',

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
};

const dicts: Record<Lang, Dict> = { zh, en };

// ── Store ────────────────────────────────────────────────────────────────
let currentLang: Lang = 'zh';
const listeners = new Set<() => void>();

export function getLang(): Lang { return currentLang; }

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  for (const fn of listeners) fn();
}

export function toggleLang(): void {
  setLang(currentLang === 'zh' ? 'en' : 'zh');
}

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
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}

// Hook that re-renders on lang change
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  useLang(); // subscribe
  return t;
}