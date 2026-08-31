import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type LayoutType, type ThemeType } from './store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import { CytoscapeRenderer } from './renderer/CytoscapeRenderer.ts';
import type { NodeId, GraphNode } from '../types/index.ts';
import { useDebounce, useKeyboardShortcut, usePolling } from './hooks/index.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import { Legend } from './components/Legend.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { NodeDetail } from './components/NodeDetail.tsx';
import { MiniMap } from './components/MiniMap.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { GraphIcon } from './components/Icons.tsx';
import { scoped } from '../shared/Logger.ts';
import { useT } from './i18n/index.ts';
import './styles.css';

const log = scoped('panel');

interface GraphPanelProps {
  className?: string;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CytoscapeRenderer | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    nodes, edges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, isLoading, error, lastUpdated,
    prerequisites, watchEnabled, currentWorkspace,
    setLayout, setTheme, setSearchQuery,
    setSelectedNode, setFilterType, setLoading,
  } = useGraphStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, layout: s.layout, theme: s.theme,
    searchQuery: s.searchQuery, selectedNodeId: s.selectedNodeId,
    highlightedNodeIds: s.highlightedNodeIds, filterType: s.filterType,
    isLoading: s.isLoading, error: s.error, lastUpdated: s.lastUpdated,
    prerequisites: s.prerequisites, watchEnabled: s.watchEnabled,
    currentWorkspace: s.currentWorkspace,
    setLayout: s.setLayout, setTheme: s.setTheme, setSearchQuery: s.setSearchQuery,
    setSelectedNode: s.setSelectedNode, setFilterType: s.setFilterType, setLoading: s.setLoading,
  })));

  const [showSearch, setShowSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(null);
  const [showCycles, setShowCycles] = useState(false);
  const [showCallChain, setShowCallChain] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; path: string; type: string } | null>(null);

  const showCallChainRef = useRef(showCallChain);
  showCallChainRef.current = showCallChain;
  const debouncedSearch = useDebounce(searchQuery, 200);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path) {
        useGraphStore.getState().setCurrentWorkspace(detail.path);
      }
    };
    window.addEventListener('codegraph:workspace', handler);
    return () => window.removeEventListener('codegraph:workspace', handler);
  }, []);

  useKeyboardShortcut('/', () => setShowSearch(true), { preventDefault: true });
  useKeyboardShortcut('Escape', () => {
    setShowSearch(false); setShowCallChain(false); setShowCycles(false);
    setShowImport(false); setShowLegend(false); setTooltip(null);
    rendererRef.current?.highlightCallChain(null);
    rendererRef.current?.highlightCycles(new Set<string>());
  });
  useKeyboardShortcut('c', () => setShowCallChain((v) => !v), { ctrl: true });
  useKeyboardShortcut('m', () => setShowMiniMap((v) => !v), { ctrl: true });
  useKeyboardShortcut('l', () => {
    const next: LayoutType = (layout === 'cose' ? 'dagre' : layout === 'dagre' ? 'circle' : layout === 'circle' ? 'grid' : 'cose');
    setLayout(next);
  }, { ctrl: true });
  useKeyboardShortcut('i', () => setShowImport((v) => !v), { ctrl: true });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.updateData(nodes, edges);
  }, [nodes, edges]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.applyLayout(layout);
  }, [layout]);

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

  const handleThemeToggle = useCallback(() => {
    const newTheme: ThemeType = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    rendererRef.current?.updateTheme(newTheme);
  }, [theme, setTheme]);

  const handleExport = useCallback((format: 'png' | 'json') => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let data: string | null = null;
    let mimeType = 'application/json';
    let extension = 'json';
    if (format === 'png') { data = renderer.exportPNG(); mimeType = 'image/png'; extension = 'png'; }
    else { data = renderer.exportJSON(); }
    if (data) {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `codegraph-${Date.now()}.${extension}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      log.info(`exported ${format}`);
    }
  }, []);

  const handleCollapse = useCallback(() => setCollapsed((c) => !c), []);
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

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <div className="collapse-fab" onClick={handleCollapse} role="button" aria-label={t('panel.expand')}>
        <GraphIcon size={22} />
      </div>

      <Toolbar
        statsText={statsText}
        typeCounts={{ function: nodeTypeCounts.function, class: nodeTypeCounts.class, interface: nodeTypeCounts.interface }}
        layout={layout}
        theme={theme}
        filterType={filterType}
        showSearch={showSearch}
        showCallChain={showCallChain}
        showCycles={showCycles}
        showMiniMap={showMiniMap}
        showLegend={showLegend}
        showImport={showImport}
        collapsed={collapsed}
        onLayoutChange={setLayout}
        onThemeToggle={handleThemeToggle}
        onFilterChange={setFilterType}
        onToggleSearch={() => setShowSearch((v) => !v)}
        onToggleCallChain={() => setShowCallChain((v) => !v)}
        onToggleCycles={() => setShowCycles((v) => !v)}
        onToggleMiniMap={() => setShowMiniMap((v) => !v)}
        onToggleLegend={() => setShowLegend((v) => !v)}
        onToggleImport={() => setShowImport((v) => !v)}
        onRefresh={handleRefresh}
        onExport={handleExport}
        onCollapse={handleCollapse}
      />

      {showSearch && !collapsed && (
        <SearchBar
          query={searchQuery}
          matchCount={searchMatchCount}
          onChange={setSearchQuery}
          onClose={() => setShowSearch(false)}
        />
      )}

      {isLoading && !collapsed && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="spinner" /><span>{t('state.loading')}</span>
        </div>
      )}

      {error && !collapsed && (<div className="error-overlay" role="alert"><span>⚠ {error}</span></div>)}

      {nodes.length === 0 && !isLoading && !error && !collapsed && (
        <EmptyState prerequisites={prerequisites} onImport={() => setShowImport(true)} />
      )}

      {showImport && !collapsed && (
        <ImportPanel onClose={() => setShowImport(false)} workspacePath={currentWorkspace} />
      )}
      {showLegend && !collapsed && (<Legend onClose={() => setShowLegend(false)} />)}

      {selectedNodeData && !collapsed && (
        <NodeDetail node={selectedNodeData} onClose={handleCloseDetail} />
      )}

      <div className="graph-container" ref={containerRef} />

      {showMiniMap && !collapsed && (
        <MiniMap
          counts={{
            function: nodeTypeCounts.function,
            class: nodeTypeCounts.class,
            variable: nodeTypeCounts.variable,
            module: nodeTypeCounts.module,
            interface: nodeTypeCounts.interface,
          }}
          onClose={() => setShowMiniMap(false)}
        />
      )}

      {tooltip && (
        <div className="cg-tooltip" style={{ left: tooltip.x + 15, top: tooltip.y + 15 }} role="tooltip">
          <div className="tooltip-name">{tooltip.name}</div>
          <div className="tooltip-path">{tooltip.path}</div>
          <span className="tooltip-type">{tooltip.type}</span>
        </div>
      )}

      <StatusBar error={error} isLoading={isLoading} lastUpdated={lastUpdated} watchEnabled={watchEnabled} />

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
