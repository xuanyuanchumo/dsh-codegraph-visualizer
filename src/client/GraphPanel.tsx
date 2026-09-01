import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type LayoutType, type ThemeType } from './store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import type { IRenderer } from './renderer/IRenderer.ts';
import type { NodeId, GraphNode } from '../types/index.ts';
import { useDebounce, usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard } from './hooks/index.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import { Legend } from './components/Legend.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { NodeDetail } from './components/NodeDetail.tsx';
import { StatsPanel } from './components/StatsPanel.tsx';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; path: string; type: string } | null>(null);

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

  const panel = usePanelState();
  const debouncedSearch = useDebounce(searchQuery, 200);
  const showCallChainRef = useRef(panel.showCallChain);
  showCallChainRef.current = panel.showCallChain;

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

  const handleNodeTap = useCallback((id: NodeId) => {
    setSelectedNode(id);
    const data = renderer.rendererRef.current?.getSelectedNodeData() ?? null;
    setSelectedNodeData(data);
  }, [setSelectedNode]);

  const handleNodeDoubleTap = useCallback((nodeId: string) => {
    const data = renderer.rendererRef.current?.getSelectedNodeData();
    if (data) {
      window.dispatchEvent(new CustomEvent('codegraph:open-source', {
        detail: { filePath: data.filePath, lineNumber: data.lineNumber, nodeId },
      }));
    }
  }, []);

  const handleNodeHover = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    const data = renderer.rendererRef.current?.getNodeData(nodeId);
    if (data) {
      setTooltip({ x: pos.x, y: pos.y, name: data.label, path: `${data.filePath}:${data.lineNumber}`, type: data.type });
    }
  }, []);

  const handleNodeHoverOut = useCallback(() => setTooltip(null), []);

  const renderer = useGraphRenderer(
    nodes, edges, layout, theme,
    highlightedNodeIds, selectedNodeId, filterType,
    debouncedSearch, panel.showCallChain, panel.showCycles,
    { onNodeTap: handleNodeTap, onNodeDoubleTap: handleNodeDoubleTap, onNodeHover: handleNodeHover, onNodeHoverOut: handleNodeHoverOut },
    showCallChainRef,
  );

  usePanelResize(panelRef, renderer.rendererRef);

  usePanelKeyboard(layout, setLayout, renderer.rendererRef, {
    onToggleSearch: panel.toggleSearch,
    onCloseAll: () => {
      panel.setShowSearch(false); panel.setShowCallChain(false); panel.setShowCycles(false);
      panel.setShowImport(false); panel.setShowLegend(false); setTooltip(null);
    },
    onToggleCallChain: panel.toggleCallChain,
    onToggleMiniMap: panel.toggleMiniMap,
    onCycleLayout: () => {},
    onToggleImport: panel.toggleImport,
  });

  const requestRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('codegraph:refresh'));
  }, []);
  usePolling(requestRefresh, 3000, !panel.collapsed);

  const handleThemeToggle = useCallback(() => {
    const newTheme: ThemeType = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    renderer.updateTheme(newTheme);
  }, [theme, setTheme, renderer]);

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeData(null); setSelectedNode(null);
  }, [setSelectedNode]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:refresh'));
    log.info('manual refresh');
  }, [setLoading]);

  const statsText = useMemo(() => `${nodes.length} nodes · ${edges.length} edges`, [nodes.length, edges.length]);
  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0, type: 0 };
    for (const n of nodes) { if (n.type in counts) counts[n.type as keyof typeof counts]++; }
    return counts;
  }, [nodes]);
  const panelClassName = useMemo(() =>
    `graph-panel resizable ${panel.collapsed ? 'collapsed' : ''} ${className}`.trim(),
    [panel.collapsed, className],
  );

  const c = panel.collapsed;

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <div className="collapse-fab" onClick={panel.toggleCollapsed} role="button" aria-label={t('panel.expand')}>
        <GraphIcon size={22} />
      </div>

      <Toolbar
        statsText={statsText}
        typeCounts={{ function: nodeTypeCounts.function, class: nodeTypeCounts.class, interface: nodeTypeCounts.interface }}
        layout={layout}
        theme={theme}
        filterType={filterType}
        showSearch={panel.showSearch}
        showCallChain={panel.showCallChain}
        showCycles={panel.showCycles}
        showMiniMap={panel.showMiniMap}
        showLegend={panel.showLegend}
        showImport={panel.showImport}
        collapsed={panel.collapsed}
        onLayoutChange={setLayout}
        onThemeToggle={handleThemeToggle}
        onFilterChange={setFilterType}
        onToggleSearch={panel.toggleSearch}
        onToggleCallChain={panel.toggleCallChain}
        onToggleCycles={panel.toggleCycles}
        onToggleMiniMap={panel.toggleMiniMap}
        onToggleLegend={panel.toggleLegend}
        onToggleImport={panel.toggleImport}
        onRefresh={handleRefresh}
        onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed}
      />

      {panel.showSearch && !c && (
        <SearchBar
          query={searchQuery}
          matchCount={renderer.searchMatchCount}
          onChange={setSearchQuery}
          onClose={() => panel.setShowSearch(false)}
        />
      )}

      {isLoading && !c && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="spinner" /><span>{t('state.loading')}</span>
        </div>
      )}

      {error && !c && (<div className="error-overlay" role="alert"><span>⚠ {error}</span></div>)}

      {nodes.length === 0 && !isLoading && !error && !c && (
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} />
      )}

      {panel.showImport && !c && (
        <ImportPanel onClose={() => panel.setShowImport(false)} workspacePath={currentWorkspace} />
      )}
      {panel.showLegend && !c && (<Legend onClose={() => panel.setShowLegend(false)} />)}

      {selectedNodeData && !c && (
        <NodeDetail node={selectedNodeData} onClose={handleCloseDetail} />
      )}

      <div className="graph-container" ref={renderer.containerRef} />

      {panel.showMiniMap && !c && (
        <StatsPanel
          counts={{
            function: nodeTypeCounts.function,
            class: nodeTypeCounts.class,
            variable: nodeTypeCounts.variable,
            module: nodeTypeCounts.module,
            interface: nodeTypeCounts.interface,
          }}
          onClose={() => panel.setShowMiniMap(false)}
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
