import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type LayoutType, type ThemeType } from './store/graphStore.ts';
import { CytoscapeRenderer } from './renderer/CytoscapeRenderer.ts';
import type { NodeId, GraphNode } from '../types/index.ts';
import { useDebounce, useKeyboardShortcut, usePolling } from './hooks/index.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import { Legend } from './components/Legend.tsx';
import {
  GraphIcon, SearchIcon, ChainIcon, CycleIcon, MapIcon, RefreshIcon,
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon,
  CloseIcon, UploadIcon, LayersIcon, AlertIcon,
} from './components/Icons.tsx';
import { scoped } from './services/Logger.ts';
import { useT, useLang, toggleLang } from './i18n/index.ts';
import './styles.css';

const log = scoped('panel');

interface GraphPanelProps {
  className?: string;
}

const LAYOUTS: LayoutType[] = ['cose', 'dagre', 'circle', 'grid'];
const FILTER_KEYS: { value: string; key: string }[] = [
  { value: 'all', key: 'filter.all' },
  { value: 'function', key: 'filter.function' },
  { value: 'class', key: 'filter.class' },
  { value: 'variable', key: 'filter.variable' },
  { value: 'module', key: 'filter.module' },
  { value: 'interface', key: 'filter.interface' },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const lang = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CytoscapeRenderer | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const {
    nodes, edges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, isLoading, error, lastUpdated,
    prerequisites, watchEnabled,
    setLayout, setTheme, setSearchQuery,
    setSelectedNode, setFilterType, setLoading,
  } = useGraphStore();

  const [showSearch, setShowSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(null);
  const [showCycles, setShowCycles] = useState(false);
  const [showCallChain, setShowCallChain] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string>('.');
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; path: string; type: string } | null>(null);

  const showCallChainRef = useRef(showCallChain);
  showCallChainRef.current = showCallChain;

  const debouncedSearch = useDebounce(searchQuery, 200);

  // Listen for workspace path updates from the host/client entry
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path) setWorkspacePath(detail.path);
    };
    window.addEventListener('codegraph:workspace', handler);
    return () => window.removeEventListener('codegraph:workspace', handler);
  }, []);

  useKeyboardShortcut('/', () => setShowSearch(true), { preventDefault: true });
  useKeyboardShortcut('Escape', () => {
    setShowSearch(false);
    setShowCallChain(false);
    setShowCycles(false);
    setShowImport(false);
    setShowLegend(false);
    setShowExportMenu(false);
    setTooltip(null);
    rendererRef.current?.highlightCallChain(null);
    rendererRef.current?.highlightCycles(new Set<string>());
  });
  useKeyboardShortcut('c', () => setShowCallChain(v => !v), { ctrl: true });
  useKeyboardShortcut('m', () => setShowMiniMap(v => !v), { ctrl: true });
  useKeyboardShortcut('l', () => {
    const next: LayoutType = (layout === 'cose' ? 'dagre' : layout === 'dagre' ? 'circle' : layout === 'circle' ? 'grid' : 'cose');
    setLayout(next);
  }, { ctrl: true });
  useKeyboardShortcut('i', () => setShowImport(v => !v), { ctrl: true });

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new CytoscapeRenderer({
      container: containerRef.current,
      theme,
      onNodeTap: (nodeId: string) => {
        const id = nodeId as NodeId;
        setSelectedNode(id);
        const data = rendererRef.current?.getSelectedNodeData() ?? null;
        setSelectedNodeData(data);
        if (showCallChainRef.current) { rendererRef.current?.highlightCallChain(id); }
      },
      onNodeDoubleTap: (nodeId: string) => {
        const data = rendererRef.current?.getSelectedNodeData();
        if (data) {
          window.dispatchEvent(new CustomEvent('codegraph:open-source', {
            detail: { filePath: data.filePath, lineNumber: data.lineNumber, nodeId },
          }));
        }
      },
      onNodeHover: (nodeId: string, renderedPosition: { x: number; y: number }) => {
        const data = rendererRef.current?.getNodeData(nodeId);
        if (data) {
          setTooltip({ x: renderedPosition.x, y: renderedPosition.y, name: data.label, path: `${data.filePath}:${data.lineNumber}`, type: data.type });
        }
      },
      onNodeHoverOut: () => setTooltip(null),
    });
    renderer.init();
    rendererRef.current = renderer;
    log.info('renderer initialized', { theme });
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, [theme, setSelectedNode]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.updateData(nodes, edges);
    renderer.applyLayout(layout);
  }, [nodes, edges, layout]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.highlightNodes(highlightedNodeIds);
    renderer.selectNode(selectedNodeId);
  }, [highlightedNodeIds, selectedNodeId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.filterByType(filterType);
  }, [filterType]);

  const [searchMatchCount, setSearchMatchCount] = useState<number | null>(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    setSearchMatchCount(debouncedSearch ? renderer.search(debouncedSearch) : null);
  }, [debouncedSearch, nodes]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (showCallChain && selectedNodeId) { renderer.highlightCallChain(selectedNodeId); }
    else { renderer.highlightCallChain(null); }
  }, [showCallChain, selectedNodeId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (showCycles) { const cycles = renderer.detectCycles(); renderer.highlightCycles(cycles); }
    else { renderer.highlightCycles(new Set<string>()); }
  }, [showCycles]);

  const requestRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('codegraph:refresh'));
  }, []);
  usePolling(requestRefresh, 3000, !collapsed);

  useEffect(() => {
    if (!showExportMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) { setShowExportMenu(false); }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showExportMenu]);

  const handleLayoutChange = useCallback((newLayout: LayoutType) => setLayout(newLayout), [setLayout]);
  const handleThemeToggle = useCallback(() => {
    const newTheme: ThemeType = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    rendererRef.current?.updateTheme(newTheme);
  }, [theme, setTheme]);

  const handleExport = useCallback((format: 'png' | 'svg' | 'json') => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let data: string | null = null;
    let mimeType = 'application/json';
    let extension = 'json';
    if (format === 'png') { data = renderer.exportPNG(); mimeType = 'image/png'; extension = 'png'; }
    else if (format === 'svg') { data = renderer.exportSVG(); mimeType = 'image/svg+xml'; extension = 'svg'; }
    else { data = renderer.exportJSON(); }
    if (data) {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `codegraph-${Date.now()}.${extension}`; a.click();
      URL.revokeObjectURL(url);
      log.info(`exported ${format}`);
    }
    setShowExportMenu(false);
  }, []);

  const handleCollapse = useCallback(() => setCollapsed(c => !c), []);
  const handleCloseDetail = useCallback(() => { setSelectedNodeData(null); setSelectedNode(null); }, [setSelectedNode]);
  const handleRefresh = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:refresh'));
    log.info('manual refresh');
  }, [setLoading]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let startX = 0, startY = 0, startW = 0, startH = 0;
    const onPointerMove = (e: PointerEvent) => {
      const w = Math.max(320, startW + (e.clientX - startX));
      const h = Math.max(240, startH + (e.clientY - startY));
      panel.style.width = `${w}px`; panel.style.height = `${h}px`;
      rendererRef.current?.resize();
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX; startY = e.clientY; startW = panel.offsetWidth; startH = panel.offsetHeight;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };
    const handle = panel.querySelector<HTMLElement>('.resize-handle');
    handle?.addEventListener('pointerdown', onPointerDown);
    return () => { handle?.removeEventListener('pointerdown', onPointerDown); };
  }, []);

  const statsText = useMemo(() => `${nodes.length} nodes · ${edges.length} edges`, [nodes.length, edges.length]);
  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0, type: 0 };
    for (const n of nodes) { if (n.type in counts) counts[n.type as keyof typeof counts]++; }
    return counts;
  }, [nodes]);
  const panelClassName = useMemo(() => `graph-panel resizable ${collapsed ? 'collapsed' : ''} ${className}`.trim(), [collapsed, className]);
  const statusDotClass = error ? 'status-dot error' : isLoading ? 'status-dot loading' : 'status-dot';
  const statusText = error ? t('state.error') : isLoading ? t('state.loading') : t('state.ready');
  const nodeExtraProps = useMemo(() => {
    if (!selectedNodeData) return [] as [string, unknown][];
    return Object.entries(selectedNodeData.properties).slice(0, 5);
  }, [selectedNodeData]);

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <div className="collapse-fab" onClick={handleCollapse} role="button" aria-label={t('panel.expand')}>
        <GraphIcon size={22} />
      </div>

      <div className="graph-toolbar">
        <div className="toolbar-left">
          <span className="node-count">{statsText}</span>
          {nodeTypeCounts.function > 0 && <span className="type-badge function">fn:{nodeTypeCounts.function}</span>}
          {nodeTypeCounts.class > 0 && <span className="type-badge class">cls:{nodeTypeCounts.class}</span>}
          {nodeTypeCounts.interface > 0 && <span className="type-badge interface">if:{nodeTypeCounts.interface}</span>}
        </div>

        <div className="toolbar-center">
          <div className="layout-buttons" role="group" aria-label="Layout switcher">
            {LAYOUTS.map((l) => (
              <button key={l} className={`layout-btn ${layout === l ? 'active' : ''}`} onClick={() => handleLayoutChange(l)}
                title={t('toolbar.layout', { l })} aria-pressed={layout === l}>{l}</button>
            ))}
          </div>
        </div>

        <div className="toolbar-right">
          <button className="import-btn" onClick={() => setShowImport(v => !v)} title={t('toolbar.import')}
            aria-label={t('toolbar.import')} aria-pressed={showImport}><UploadIcon size={15} /></button>

          <select value={filterType} onChange={(e) => setFilterType(e.target.value as GraphNode['type'] | 'all')}
            className="filter-select" aria-label={t('toolbar.filter')}>
            {FILTER_KEYS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
            ))}
          </select>

          <button className={`search-btn ${showSearch ? 'active' : ''}`} onClick={() => setShowSearch(!showSearch)}
            title={t('toolbar.search')} aria-label={t('toolbar.search')} aria-expanded={showSearch}><SearchIcon size={15} /></button>
          <button className={`chain-btn ${showCallChain ? 'active' : ''}`} onClick={() => setShowCallChain(v => !v)}
            title={t('toolbar.chain')} aria-label={t('toolbar.chain')} aria-pressed={showCallChain}><ChainIcon size={15} /></button>
          <button className={`cycle-btn ${showCycles ? 'active' : ''}`} onClick={() => setShowCycles(v => !v)}
            title={t('toolbar.cycles')} aria-label={t('toolbar.cycles')} aria-pressed={showCycles}><CycleIcon size={15} /></button>
          <button className={`minimap-btn ${showMiniMap ? 'active' : ''}`} onClick={() => setShowMiniMap(v => !v)}
            title={t('toolbar.minimap')} aria-label={t('toolbar.minimap')} aria-pressed={showMiniMap}><MapIcon size={15} /></button>
          <button className={`legend-btn ${showLegend ? 'active' : ''}`} onClick={() => setShowLegend(v => !v)}
            title={t('toolbar.legend')} aria-label={t('toolbar.legend')} aria-pressed={showLegend}><LayersIcon size={15} /></button>
          <button className="refresh-btn" onClick={handleRefresh} title={t('toolbar.refresh')}
            aria-label={t('toolbar.refresh')}><RefreshIcon size={15} /></button>
          <button className="theme-btn" onClick={handleThemeToggle} title={t('toolbar.theme')}
            aria-label={t('toolbar.theme')}>{theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}</button>
          <button className="lang-btn" onClick={toggleLang} title={t('toolbar.lang')}
            aria-label={t('toolbar.lang')}><span className="lang-label">{lang === 'zh' ? '中' : 'EN'}</span></button>

          <div className="export-menu" ref={exportMenuRef}>
            <button className="export-btn" onClick={() => setShowExportMenu(v => !v)} title={t('toolbar.export')}
              aria-label={t('toolbar.export')} aria-haspopup="menu" aria-expanded={showExportMenu}><DownloadIcon size={15} /></button>
            {showExportMenu && (
              <div className="export-dropdown" role="menu">
                <button onClick={() => handleExport('png')} role="menuitem">{t('export.png')}</button>
                <button onClick={() => handleExport('svg')} role="menuitem">{t('export.svg')}</button>
                <button onClick={() => handleExport('json')} role="menuitem">{t('export.json')}</button>
              </div>
            )}
          </div>

          <button className="collapse-btn" onClick={handleCollapse} title={collapsed ? t('panel.collapse') : t('panel.collapse')}
            aria-label={collapsed ? t('panel.expandPanel') : t('panel.collapsePanel')}>
            {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
          </button>
        </div>
      </div>

      {showSearch && !collapsed && (
        <div className="search-bar">
          <SearchIcon size={14} className="search-bar-icon" />
          <input type="text" placeholder={t('search.placeholder')} value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} autoFocus aria-label={t('search.placeholder')} />
          <button onClick={() => setShowSearch(false)} aria-label={t('search.close')}><CloseIcon size={14} /></button>
          {searchQuery && searchMatchCount !== null && (
            <span className="search-hint" role="status" aria-live="polite">
              {searchMatchCount > 0 ? t(searchMatchCount === 1 ? 'search.match' : 'search.matches', { n: searchMatchCount }) : t('search.noMatch')}
            </span>
          )}
          {!searchQuery && <span className="search-hint">{t('search.debounced')}</span>}
        </div>
      )}

      {isLoading && !collapsed && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="spinner" /><span>{t('state.loading')}</span>
        </div>
      )}

      {error && !collapsed && (<div className="error-overlay" role="alert"><span>⚠ {error}</span></div>)}

      {nodes.length === 0 && !isLoading && !error && !collapsed && (
        <div className="empty-state">
          <GraphIcon size={48} className="empty-icon" />
          <span className="empty-title">{t('empty.title')}</span>
          <span className="empty-subtitle">{t('empty.subtitle')}</span>
          {(!prerequisites.codegraph && !prerequisites.lens) && (
            <div className="empty-prereq-warning">
              <AlertIcon size={14} />
              <span>{t('import.prereqMissing')}</span>
            </div>
          )}
          <button className="empty-import-btn" onClick={() => setShowImport(true)}>
            <UploadIcon size={15} /> {t('empty.import')}
          </button>
        </div>
      )}

      {showImport && !collapsed && (<ImportPanel onClose={() => setShowImport(false)} workspacePath={workspacePath} />)}
      {showLegend && !collapsed && (<Legend onClose={() => setShowLegend(false)} />)}

      {selectedNodeData && !collapsed && (
        <div className="node-detail-panel" role="complementary" aria-label={t('detail.ariaLabel')}>
          <button className="close-btn" onClick={handleCloseDetail} aria-label={t('detail.close')}><CloseIcon size={14} /></button>
          <h3>{selectedNodeData.label}</h3>
          <div className="detail-row"><span className="detail-label">{t('detail.type')}</span><span className="detail-value">{selectedNodeData.type}</span></div>
          <div className="detail-row"><span className="detail-label">{t('detail.file')}</span><span className="detail-value">{selectedNodeData.filePath}</span></div>
          <div className="detail-row"><span className="detail-label">{t('detail.line')}</span><span className="detail-value">{selectedNodeData.lineNumber}</span></div>
          {nodeExtraProps.length > 0 && (
            <div className="detail-extra">
              <div className="detail-extra-title">{t('detail.properties')}</div>
              {nodeExtraProps.map(([k, v]) => (
                <div className="detail-row" key={k}>
                  <span className="detail-label">{k}</span>
                  <span className="detail-value">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="graph-container" ref={containerRef} />

      {showMiniMap && !collapsed && (
        <div className="mini-map" role="complementary" aria-label={t('minimap.title')}>
          <div className="mini-map-header">
            <span>{t('minimap.title')}</span>
            <button onClick={() => setShowMiniMap(false)} aria-label={t('minimap.close')}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px' }}>
              <CloseIcon size={14} />
            </button>
          </div>
          <div className="mini-map-content">
            <div className="mini-map-stats">
              <div><span className="dot" style={{ background: 'var(--cg-success)' }} />{t('minimap.functions')}: {nodeTypeCounts.function}</div>
              <div><span className="dot" style={{ background: 'var(--cg-accent)' }} />{t('minimap.classes')}: {nodeTypeCounts.class}</div>
              <div><span className="dot" style={{ background: 'var(--cg-warning)' }} />{t('minimap.variables')}: {nodeTypeCounts.variable}</div>
              <div><span className="dot" style={{ background: '#ec4899' }} />{t('minimap.modules')}: {nodeTypeCounts.module}</div>
              <div><span className="dot" style={{ background: '#14b8a6' }} />{t('minimap.interfaces')}: {nodeTypeCounts.interface}</div>
            </div>
          </div>
        </div>
      )}

      {tooltip && (
        <div className="cg-tooltip" style={{ left: tooltip.x + 15, top: tooltip.y + 15 }} role="tooltip">
          <div className="tooltip-name">{tooltip.name}</div>
          <div className="tooltip-path">{tooltip.path}</div>
          <span className="tooltip-type">{tooltip.type}</span>
        </div>
      )}

      <div className="status-bar">
        <div className="status-item">
          <span className={statusDotClass} /><span>{statusText}</span>
        </div>
        {watchEnabled && <span className="watch-indicator" title={t('import.watchOn')}>●</span>}
        <div className="status-spacer" />
        <div className="status-item">
          <span className="status-time">{lastUpdated > 0 ? t('state.updated', { time: formatTime(lastUpdated) }) : t('state.noData')}</span>
        </div>
      </div>

      <div className="resize-handle" aria-hidden="true" />
    </div>
  );
}

export function GraphPanel(props: GraphPanelProps) {
  return (
    <GraphErrorBoundary>
      <GraphPanelInner {...props} />
    </GraphErrorBoundary>
  );
}
