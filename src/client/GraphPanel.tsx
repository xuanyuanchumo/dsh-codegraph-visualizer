import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type ThemeType, type GraphType } from './store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
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
  const getDataRef = useRef<{
    getSelectedNodeData: () => GraphNode | null;
    getNodeData: (id: string) => GraphNode | null;
  } | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; path: string; type: string } | null>(null);

  const {
    nodes, edges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, graphType, isLoading, error, lastUpdated,
    prerequisites, watchEnabled, currentWorkspace, workspaceList,
    initStatus,
  } = useGraphStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, layout: s.layout, theme: s.theme,
    searchQuery: s.searchQuery, selectedNodeId: s.selectedNodeId,
    highlightedNodeIds: s.highlightedNodeIds, filterType: s.filterType,
    graphType: s.graphType,
    isLoading: s.isLoading, error: s.error, lastUpdated: s.lastUpdated,
    prerequisites: s.prerequisites, watchEnabled: s.watchEnabled,
    currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
    initStatus: s.initStatus,
  })));

  const setLayout = useGraphStore((s) => s.setLayout);
  const setTheme = useGraphStore((s) => s.setTheme);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const setFilterType = useGraphStore((s) => s.setFilterType);
  const setGraphType = useGraphStore((s) => s.setGraphType);
  const setLoading = useGraphStore((s) => s.setLoading);
  const setCurrentWorkspace = useGraphStore((s) => s.setCurrentWorkspace);
  const addWorkspace = useGraphStore((s) => s.addWorkspace);
  const removeWorkspace = useGraphStore((s) => s.removeWorkspace);
  const setGraphData = useGraphStore((s) => s.setGraphData);
  const setInitStatus = useGraphStore((s) => s.setInitStatus);
  const setWatchEnabled = useGraphStore((s) => s.setWatchEnabled);
  const setError = useGraphStore((s) => s.setError);

  const panel = usePanelState();
  const debouncedSearch = useDebounce(searchQuery, 200);
  const showCallChainRef = useRef(panel.showCallChain);

  useEffect(() => {
    showCallChainRef.current = panel.showCallChain;
  }, [panel.showCallChain]);

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

  const handleWorkspaceSwitch = useCallback((path: string) => {
    setCurrentWorkspace(path);
    window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path } }));

  }, [setCurrentWorkspace]);

  const handleWorkspaceAdd = useCallback((path: string) => {
    addWorkspace(path, path.split(/[\\/]/).pop() || path);
    window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path } }));
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path } }));
  }, [addWorkspace]);

  const handleNodeTap = useCallback((id: NodeId) => {
    setSelectedNode(id);
    const data = getDataRef.current?.getSelectedNodeData() ?? null;
    setSelectedNodeData(data);
  }, [setSelectedNode]);

  const handleNodeDoubleTap = useCallback((nodeId: string) => {
    const data = getDataRef.current?.getSelectedNodeData();
    if (data) {
      window.dispatchEvent(new CustomEvent('codegraph:open-source', {
        detail: { filePath: data.filePath, lineNumber: data.lineNumber, nodeId },
      }));
    }
  }, []);

  const handleNodeHover = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    const data = getDataRef.current?.getNodeData(nodeId);
    if (data) {
      setTooltip({ x: pos.x, y: pos.y, name: data.label, path: `${data.filePath}:${data.lineNumber}`, type: data.type });
    }
  }, []);

  const handleNodeHoverOut = useCallback(() => setTooltip(null), []);

  const renderer = useGraphRenderer(
    nodes, edges, layout, theme,
    highlightedNodeIds, selectedNodeId, filterType, graphType,
    debouncedSearch, panel.showCallChain, panel.showCycles,
    { onNodeTap: handleNodeTap, onNodeDoubleTap: handleNodeDoubleTap, onNodeHover: handleNodeHover, onNodeHoverOut: handleNodeHoverOut },
    showCallChainRef,
  );

  useEffect(() => {
    getDataRef.current = {
      getSelectedNodeData: () => renderer.rendererRef.current?.getSelectedNodeData() ?? null,
      getNodeData: (id: string) => renderer.rendererRef.current?.getNodeData(id) ?? null,
    };
  }, [renderer.rendererRef]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.body.hasAttribute('data-ds-dark-theme');
      const newTheme: ThemeType = isDark ? 'dark' : 'light';
      const current = useGraphStore.getState().theme;
      if (current !== newTheme) {
        useGraphStore.getState().setTheme(newTheme);
        renderer.updateTheme(newTheme);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    return () => observer.disconnect();
  }, [renderer.updateTheme]);

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
  usePolling(requestRefresh, watchEnabled ? 2000 : 5000, !panel.collapsed);

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

  const handleScanWorkspace = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path: currentWorkspace || '.' } }));
    log.info('scan workspace from empty state', { path: currentWorkspace });
  }, [setLoading, currentWorkspace]);

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
        graphType={graphType}
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
        onGraphTypeChange={setGraphType}
        onToggleSearch={panel.toggleSearch}
        onToggleCallChain={panel.toggleCallChain}
        onToggleCycles={panel.toggleCycles}
        onToggleMiniMap={panel.toggleMiniMap}
        onToggleLegend={panel.toggleLegend}
        onToggleImport={panel.toggleImport}
        onRefresh={handleRefresh}
        onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed}
        currentWorkspace={currentWorkspace}
        workspaceList={workspaceList}
        onSwitchWorkspace={handleWorkspaceSwitch}
        onAddWorkspace={handleWorkspaceAdd}
        onRemoveWorkspace={removeWorkspace}
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
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}

      {panel.showImport && !c && (
        <ImportPanel
          onClose={() => panel.setShowImport(false)}
          workspacePath={currentWorkspace}
          prerequisites={prerequisites}
          initStatus={initStatus}
          watchEnabled={watchEnabled}
          onSetGraphData={setGraphData}
          onSetLoading={setLoading}
          onSetError={setError}
          onSetInitStatus={setInitStatus}
          onSetWatchEnabled={setWatchEnabled}
        />
      )}
      {selectedNodeData && !c && (
        <NodeDetail node={selectedNodeData} onClose={handleCloseDetail} />
      )}

      <div className="graph-container" ref={renderer.containerRef} />

      {panel.showLegend && !c && (<Legend onClose={() => panel.setShowLegend(false)} />)}

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

      <StatusBar error={error} isLoading={isLoading} lastUpdated={lastUpdated} watchEnabled={watchEnabled} workspaceName={currentWorkspace} />

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
