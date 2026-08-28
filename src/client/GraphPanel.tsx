// GraphPanel - Main React component for graph visualization
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useGraphStore, type LayoutType, type ThemeType } from './store/graphStore.ts';
import { CytoscapeRenderer } from './renderer/CytoscapeRenderer.ts';
import type { NodeId } from '../types/index.ts';

interface GraphPanelProps {
  className?: string;
}

export const GraphPanel = ({ className = '' }: GraphPanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CytoscapeRenderer | null>(null);
  const {
    nodes, edges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, isLoading, error,
    setGraphData, setLayout, setTheme, setSearchQuery,
    setSelectedNode, setHighlightedNodes, setFilterType,
    setLoading, setError, clearGraph,
  } = useGraphStore();

  const [showSearch, setShowSearch] = useState(false);

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new CytoscapeRenderer({
      container: containerRef.current,
      theme,
      onNodeTap: (nodeId) => setSelectedNode(nodeId as NodeId),
    });

    renderer.init();
    rendererRef.current = renderer;

    return () => renderer.destroy();
  }, [theme]);

  // Update graph data
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.updateData(nodes, edges);
    renderer.applyLayout(layout);
  }, [nodes, edges, layout]);

  // Apply highlights
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.highlightNodes(highlightedNodeIds);
    renderer.selectNode(selectedNodeId);
  }, [highlightedNodeIds, selectedNodeId]);

  // Apply filter
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.filterByType(filterType);
  }, [filterType]);

  // Apply search
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.search(searchQuery);
  }, [searchQuery]);

  // Layout switcher
  const handleLayoutChange = useCallback((newLayout: LayoutType) => {
    setLayout(newLayout);
  }, [setLayout]);

  // Theme toggle
  const handleThemeToggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Export
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
      a.download = `graph-export.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  return (
    <div className={`graph-panel ${className}`}>
      {/* Toolbar */}
      <div className="graph-toolbar">
        <div className="toolbar-left">
          <span className="node-count">{nodes.length} nodes · {edges.length} edges</span>
        </div>
        
        <div className="toolbar-center">
          {/* Layout buttons */}
          <div className="layout-buttons">
            {(['cose', 'dagre', 'circle', 'grid'] as LayoutType[]).map((l) => (
              <button
                key={l}
                className={`layout-btn ${layout === l ? 'active' : ''}`}
                onClick={() => handleLayoutChange(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-right">
          {/* Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="filter-select"
          >
            <option value="all">All Types</option>
            <option value="function">Functions</option>
            <option value="class">Classes</option>
            <option value="variable">Variables</option>
            <option value="module">Modules</option>
          </select>

          {/* Search */}
          <button
            className="search-btn"
            onClick={() => setShowSearch(!showSearch)}
          >
            🔍
          </button>

          {/* Theme */}
          <button className="theme-btn" onClick={handleThemeToggle}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Export */}
          <div className="export-menu">
            <button className="export-btn">📥</button>
            <div className="export-dropdown">
              <button onClick={() => handleExport('png')}>PNG</button>
              <button onClick={() => handleExport('svg')}>SVG</button>
              <button onClick={() => handleExport('json')}>JSON</button>
            </div>
          </div>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search symbols..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button onClick={() => setShowSearch(false)}>✕</button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>Loading graph...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="error-overlay">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && !isLoading && !error && (
        <div className="empty-state">
          <span>No graph data available. Import a repository to begin.</span>
        </div>
      )}

      {/* Graph container */}
      <div ref={containerRef} className="graph-container" />
    </div>
  );
};

export default GraphPanel;