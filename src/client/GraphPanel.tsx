import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type LayoutType, type ThemeType } from './store/graphStore.ts';
import { CytoscapeRenderer } from './renderer/CytoscapeRenderer.ts';
import type { NodeId, GraphNode } from '../types/index.ts';
import './styles.css';

interface GraphPanelProps {
  className?: string;
}

const LAYOUTS: LayoutType[] = ['cose', 'dagre', 'circle', 'grid'];
const FILTER_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'function', label: 'Functions' },
  { value: 'class', label: 'Classes' },
  { value: 'variable', label: 'Variables' },
  { value: 'module', label: 'Modules' },
  { value: 'interface', label: 'Interfaces' },
] as const;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export const GraphPanel = ({ className = '' }: GraphPanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CytoscapeRenderer | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    nodes, edges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, isLoading, error, lastUpdated,
    setLayout, setTheme, setSearchQuery,
    setSelectedNode, setFilterType, setLoading,
  } = useGraphStore();

  const [showSearch, setShowSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(null);
  const [showCycles, setShowCycles] = useState(false);
  const [showCallChain, setShowCallChain] = useState(false);
  const [miniMapVisible, setMiniMapVisible] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; path: string; type: string } | null>(null);

  // Refs to avoid stale closures in the renderer's tap callback.
  const showCallChainRef = useRef(showCallChain);
  showCallChainRef.current = showCallChain;

  const debouncedSearch = useDebounce(searchQuery, 200);

  // Initialize renderer once; recreate only when theme changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new CytoscapeRenderer({
      container: containerRef.current,
      theme,
      onNodeTap: (nodeId) => {
        const id = nodeId as NodeId;
        setSelectedNode(id);
        const data = rendererRef.current?.getSelectedNodeData() ?? null;
        setSelectedNodeData(data);
        if (showCallChainRef.current) {
          rendererRef.current?.highlightCallChain(id);
        }
      },
      onNodeDoubleTap: (nodeId) => {
        const data = rendererRef.current?.getSelectedNodeData();
        if (data) {
          // Emit a custom event for the host shell to open the source file.
          window.dispatchEvent(new CustomEvent('codegraph:open-source', {
            detail: { filePath: data.filePath, lineNumber: data.lineNumber, nodeId },
          }));
        }
      },
      onNodeHover: (nodeId, renderedPosition) => {
        const data = rendererRef.current?.getNodeData(nodeId);
        if (data) {
          setTooltip({
            x: renderedPosition.x,
            y: renderedPosition.y,
            name: data.label,
            path: `${data.filePath}:${data.lineNumber}`,
            type: data.type,
          });
        }
      },
      onNodeHoverOut: () => setTooltip(null),
    });

    renderer.init();
    rendererRef.current = renderer;

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [theme, setSelectedNode]);

  // Update data + layout when nodes/edges/layout change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.updateData(nodes, edges);
    renderer.applyLayout(layout);
  }, [nodes, edges, layout]);

  // Highlight + selection.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.highlightNodes(highlightedNodeIds);
    renderer.selectNode(selectedNodeId);
  }, [highlightedNodeIds, selectedNodeId]);

  // Filter.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.filterByType(filterType);
  }, [filterType]);

  // Debounced search.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.search(debouncedSearch);
  }, [debouncedSearch]);

  // Call chain highlight.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (showCallChain && selectedNodeId) {
      renderer.highlightCallChain(selectedNodeId);
    } else {
      renderer.highlightCallChain(null);
    }
  }, [showCallChain, selectedNodeId]);

  // Cycle detection.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (showCycles) {
      const cycles = renderer.detectCycles();
      renderer.highlightCycles(cycles);
    } else {
      renderer.highlightCycles(new Set<string>());
    }
  }, [showCycles]);

  // Keyboard shortcuts (passive listener for performance).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setShowCallChain(false);
        setShowCycles(false);
        setTooltip(null);
        rendererRef.current?.highlightCallChain(null);
        rendererRef.current?.highlightCycles(new Set<string>());
      }
      if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowCallChain((v) => !v);
      }
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const next: LayoutType = (layout === 'cose' ? 'dagre' : layout === 'dagre' ? 'circle' : layout === 'circle' ? 'grid' : 'cose');
        setLayout(next);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layout, setLayout]);

  // Polling fallback: refresh graph data every 3s when not loading (J9 realtime).
  useEffect(() => {
    if (collapsed) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      setLoading(true);
      // In a real DSH environment, this calls graph_data via ctx.tools.
      // Here we simulate the heat-update check; the host emits codegraph/graph/updated.
    }, 3000);
    return () => clearInterval(interval);
  }, [collapsed, setLoading]);

  const handleLayoutChange = useCallback((newLayout: LayoutType) => {
    setLayout(newLayout);
  }, [setLayout]);

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

    if (format === 'png') {
      data = renderer.exportPNG();
      mimeType = 'image/png';
      extension = 'png';
    } else if (format === 'svg') {
      data = renderer.exportSVG();
      mimeType = 'image/svg+xml';
      extension = 'svg';
    } else {
      data = renderer.exportJSON();
    }

    if (data) {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codegraph-${Date.now()}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  const handleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeData(null);
    setSelectedNode(null);
  }, [setSelectedNode]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    // Trigger a manual re-fetch by emitting a refresh event.
    window.dispatchEvent(new CustomEvent('codegraph:refresh'));
  }, [setLoading]);

  // Resize handling via pointer events on the bottom-right corner.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    let startX = 0, startY = 0, startW = 0, startH = 0;

    const onPointerMove = (e: PointerEvent) => {
      const w = Math.max(320, startW + (e.clientX - startX));
      const h = Math.max(240, startH + (e.clientY - startY));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      rendererRef.current?.resize();
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      startW = panel.offsetWidth;
      startH = panel.offsetHeight;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const handle = panel.querySelector<HTMLElement>('.resize-handle');
    handle?.addEventListener('pointerdown', onPointerDown);
    return () => {
      handle?.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const statsText = useMemo(
    () => `${nodes.length} nodes · ${edges.length} edges`,
    [nodes.length, edges.length],
  );

  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0 };
    for (const n of nodes) {
      if (n.type in counts) counts[n.type as keyof typeof counts]++;
    }
    return counts;
  }, [nodes]);

  const panelClassName = useMemo(
    () => `graph-panel resizable ${collapsed ? 'collapsed' : ''} ${className}`.trim(),
    [collapsed, className],
  );

  const statusDotClass = error ? 'status-dot error' : isLoading ? 'status-dot loading' : 'status-dot';
  const statusText = error ? 'Error' : isLoading ? 'Loading…' : 'Ready';

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label="Code graph visualizer">
      <div className="collapse-fab" onClick={handleCollapse} role="button" aria-label="Expand graph panel">📊</div>

      <div className="graph-toolbar">
        <div className="toolbar-left">
          <span className="node-count">{statsText}</span>
        </div>

        <div className="toolbar-center">
          <div className="layout-buttons" role="group" aria-label="Layout switcher">
            {LAYOUTS.map((l) => (
              <button
                key={l}
                className={`layout-btn ${layout === l ? 'active' : ''}`}
                onClick={() => handleLayoutChange(l)}
                title={`Switch to ${l} layout (Ctrl+L cycles)`}
                aria-pressed={layout === l}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-right">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as GraphNode['type'] | 'all')}
            className="filter-select"
            aria-label="Filter by node type"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <button
            className={`search-btn ${showSearch ? 'active' : ''}`}
            onClick={() => setShowSearch(!showSearch)}
            title="Search symbols (press /)"
            aria-label="Search symbols"
            aria-expanded={showSearch}
          >
            🔍
          </button>

          <button
            className={`chain-btn ${showCallChain ? 'active' : ''}`}
            onClick={() => setShowCallChain((v) => !v)}
            title="Toggle call chain highlight (Ctrl+C)"
            aria-label="Toggle call chain"
            aria-pressed={showCallChain}
          >
            🔗
          </button>

          <button
            className={`cycle-btn ${showCycles ? 'active' : ''}`}
            onClick={() => setShowCycles((v) => !v)}
            title="Highlight circular dependencies"
            aria-label="Highlight cycles"
            aria-pressed={showCycles}
          >
            🔄
          </button>

          <button
            className={`minimap-btn ${miniMapVisible ? 'active' : ''}`}
            onClick={() => setMiniMapVisible((v) => !v)}
            title="Toggle mini-map overview"
            aria-label="Toggle mini-map"
            aria-pressed={miniMapVisible}
          >
            🗺️
          </button>

          <button className="refresh-btn" onClick={handleRefresh} title="Refresh graph" aria-label="Refresh graph">
            ⟳
          </button>

          <button className="theme-btn" onClick={handleThemeToggle} title="Toggle theme" aria-label="Toggle theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <div className="export-menu">
            <button className="export-btn" title="Export graph" aria-label="Export graph" aria-haspopup="menu">📥</button>
            <div className="export-dropdown" role="menu">
              <button onClick={() => handleExport('png')} role="menuitem">PNG</button>
              <button onClick={() => handleExport('svg')} role="menuitem">SVG</button>
              <button onClick={() => handleExport('json')} role="menuitem">JSON</button>
            </div>
          </div>

          <button className="collapse-btn" onClick={handleCollapse} title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {showSearch && !collapsed && (
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search symbols…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            aria-label="Symbol search input"
          />
          <button onClick={() => setShowSearch(false)} aria-label="Close search">✕</button>
          <span className="search-hint">debounced 200ms</span>
        </div>
      )}

      {isLoading && !collapsed && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="spinner" />
          <span>Loading graph…</span>
        </div>
      )}

      {error && !collapsed && (
        <div className="error-overlay" role="alert">
          <span>⚠️ {error}</span>
        </div>
      )}

      {nodes.length === 0 && !isLoading && !error && !collapsed && (
        <div className="empty-state">
          <span className="empty-icon">📊</span>
          <span>No graph data available. Import a repository to begin.</span>
        </div>
      )}

      {selectedNodeData && !collapsed && (
        <div className="node-detail-panel" role="complementary" aria-label="Node details">
          <button className="close-btn" onClick={handleCloseDetail} aria-label="Close details">✕</button>
          <h3>{selectedNodeData.label}</h3>
          <div className="detail-row">
            <span className="detail-label">Type</span>
            <span className="detail-value">{selectedNodeData.type}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">File</span>
            <span className="detail-value">{selectedNodeData.filePath}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Line</span>
            <span className="detail-value">{selectedNodeData.lineNumber}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">ID</span>
            <span className="detail-value">{selectedNodeData.id}</span>
          </div>
        </div>
      )}

      {miniMapVisible && !collapsed && (
        <div className="mini-map" ref={miniMapRef}>
          <div className="mini-map-header">
            <span>Overview</span>
            <span>{nodes.length} total</span>
          </div>
          <div className="mini-map-content">
            {nodes.length > 0 && (
              <div className="mini-map-stats">
                <div><span className="dot" style={{ background: '#10b981' }} /> {nodeTypeCounts.function} functions</div>
                <div><span className="dot" style={{ background: '#818cf8' }} /> {nodeTypeCounts.class} classes</div>
                <div><span className="dot" style={{ background: '#f59e0b' }} /> {nodeTypeCounts.variable} variables</div>
                <div><span className="dot" style={{ background: '#ec4899' }} /> {nodeTypeCounts.module} modules</div>
                <div><span className="dot" style={{ background: '#14b8a6' }} /> {nodeTypeCounts.interface} interfaces</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={containerRef} className="graph-container" />

      {!collapsed && (
        <div className="status-bar" role="status" aria-live="polite">
          <div className="status-item">
            <span className={statusDotClass} />
            <span>{statusText}</span>
          </div>
          <div className="status-item">
            <span>{nodes.length}n · {edges.length}e</span>
          </div>
          <div className="status-spacer" />
          {lastUpdated > 0 && (
            <div className="status-item status-time">
              <span>updated {formatTime(lastUpdated)}</span>
            </div>
          )}
          <div className="status-item">
            <span>{layout} · {theme}</span>
          </div>
        </div>
      )}

      {tooltip && !collapsed && (
        <div
          className="cg-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <div className="tooltip-name">{tooltip.name}</div>
          <div className="tooltip-path">{tooltip.path}</div>
          <span className="tooltip-type">{tooltip.type}</span>
        </div>
      )}

      <div className="resize-handle" aria-hidden="true" />
    </div>
  );
};

export default React.memo(GraphPanel);
