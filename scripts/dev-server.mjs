// DSH CodeGraph Visualizer — dev server (localhost:3080)
// Serves a self-contained test harness that loads the plugin client bundle
// in a simulated DSH web shell with theme tokens and mock graph data.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3080;

const HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DSH — CodeGraph Visualizer</title>
  <style>
    /* DSH theme tokens (--dsw-*) consumed by the plugin. */
    :root {
      --dsw-bg: #0f1117;
      --dsw-surface: #181a24;
      --dsw-surface-hover: #21232f;
      --dsw-surface-active: #2a2d3d;
      --dsw-border: #2e3142;
      --dsw-border-strong: #3a3e52;
      --dsw-fg: #e6e8f0;
      --dsw-fg-secondary: #9ca0b8;
      --dsw-fg-tertiary: #6b6f85;
      --dsw-accent: #6366f1;
      --dsw-accent-hover: #818cf8;
      --dsw-accent-soft: rgba(99, 102, 241, 0.12);
      --dsw-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      --dsw-font-mono: 'JetBrains Mono', Consolas, monospace;
    }
    [data-theme="light"] {
      --dsw-bg: #f7f8fc;
      --dsw-surface: #ffffff;
      --dsw-surface-hover: #f1f2f8;
      --dsw-surface-active: #e8eaf2;
      --dsw-border: #e2e5ee;
      --dsw-border-strong: #c9cdd9;
      --dsw-fg: #1a1d2e;
      --dsw-fg-secondary: #5c6076;
      --dsw-fg-tertiary: #8b8fa3;
      --dsw-accent: #4f46e5;
      --dsw-accent-hover: #6366f1;
      --dsw-accent-soft: rgba(79, 70, 229, 0.1);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--dsw-font-sans);
      background: var(--dsw-bg);
      color: var(--dsw-fg);
      min-height: 100vh;
      overflow: hidden;
    }
    #dsh-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .dsh-topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 20px;
      height: 52px;
      background: var(--dsw-surface);
      border-bottom: 1px solid var(--dsw-border);
      flex-shrink: 0;
    }
    .dsh-topbar .logo {
      font-size: 16px;
      font-weight: 700;
      background: linear-gradient(135deg, #6366f1, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .dsh-topbar .badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(99,102,241,0.15);
      color: #818cf8;
      font-weight: 600;
    }
    .dsh-topbar .spacer { flex: 1; }
    .dsh-topbar .api-status {
      font-size: 12px;
      color: var(--dsw-fg-secondary);
    }
    .dsh-main {
      flex: 1;
      display: flex;
      position: relative;
      overflow: hidden;
    }
    .dsh-sidebar {
      width: 240px;
      background: var(--dsw-surface);
      border-right: 1px solid var(--dsw-border);
      padding: 12px 0;
      flex-shrink: 0;
      overflow-y: auto;
    }
    .dsh-sidebar-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      font-size: 13px;
      color: var(--dsw-fg-secondary);
      cursor: pointer;
      transition: all 180ms;
    }
    .dsh-sidebar-item:hover {
      background: var(--dsw-surface-hover);
      color: var(--dsw-fg);
    }
    .dsh-sidebar-item.active {
      background: rgba(99,102,241,0.12);
      color: #818cf8;
      border-left: 3px solid #6366f1;
    }
    .dsh-content {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      position: relative;
    }
    .dsh-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      flex-direction: column;
      gap: 16px;
      color: var(--dsw-fg-secondary);
    }
    .dsh-placeholder .icon { font-size: 48px; opacity: 0.4; }
    /* API config modal */
    .dsh-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    }
    .dsh-modal {
      background: var(--dsw-surface);
      border: 1px solid var(--dsw-border);
      border-radius: 12px;
      padding: 24px;
      width: 420px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.4);
    }
    .dsh-modal h2 { margin: 0 0 8px; font-size: 18px; }
    .dsh-modal p { margin: 0 0 20px; font-size: 13px; color: var(--dsw-fg-secondary); }
    .dsh-modal input {
      width: 100%;
      padding: 10px 12px;
      background: var(--dsw-bg);
      border: 1px solid var(--dsw-border);
      border-radius: 8px;
      color: var(--dsw-fg);
      font-size: 13px;
      margin-bottom: 16px;
      outline: none;
    }
    .dsh-modal input:focus { border-color: var(--dsw-accent); }
    .dsh-modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .dsh-btn {
      padding: 8px 16px;
      border: 1px solid var(--dsw-border);
      border-radius: 8px;
      background: transparent;
      color: var(--dsw-fg);
      font-size: 13px;
      cursor: pointer;
      transition: all 180ms;
      font-family: var(--dsw-font-sans);
    }
    .dsh-btn:hover { background: var(--dsw-surface-hover); }
    .dsh-btn.primary {
      background: var(--dsw-accent);
      border-color: var(--dsw-accent);
      color: #fff;
    }
    .dsh-btn.primary:hover { background: var(--dsw-accent-hover); }
    #plugin-root { position: relative; z-index: 1; }
  </style>
  <link rel="stylesheet" href="/src/client/styles.css" />
</head>
<body>
  <div id="dsh-shell">
    <div class="dsh-topbar">
      <span class="logo">DSH</span>
      <span class="badge">CodeGraph Visualizer</span>
      <span class="spacer"></span>
      <span class="api-status" id="api-status">API: Not configured</span>
    </div>
    <div class="dsh-main">
      <div class="dsh-sidebar">
        <div class="dsh-sidebar-item active">📊 Code Graph</div>
        <div class="dsh-sidebar-item">📁 Files</div>
        <div class="dsh-sidebar-item">🔍 Search</div>
        <div class="dsh-sidebar-item">⚙️ Settings</div>
      </div>
      <div class="dsh-content">
        <div class="dsh-placeholder">
          <span class="icon">📊</span>
          <span>Code Graph Visualizer plugin loaded. Panel is in the bottom-right corner.</span>
        </div>
      </div>
    </div>
  </div>
  <div id="plugin-root"></div>

  <!-- API config modal -->
  <div class="dsh-modal-overlay" id="api-modal">
    <div class="dsh-modal">
      <h2>Configure API</h2>
      <p>Enter your DeepSeek API key to enable AI-powered code analysis. You can skip this for now.</p>
      <input type="password" placeholder="sk-..." id="api-key-input" />
      <div class="dsh-modal-actions">
        <button class="dsh-btn" id="api-skip-btn">Configure Later</button>
        <button class="dsh-btn primary" id="api-save-btn">Save</button>
      </div>
    </div>
  </div>

  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.2.0",
      "react/": "https://esm.sh/react@19.2.0/",
      "react-dom": "https://esm.sh/react-dom@19.2.0?external=react",
      "react-dom/": "https://esm.sh/react-dom@19.2.0&external=react/",
      "cytoscape": "https://esm.sh/cytoscape@3.30.4",
      "cytoscape-dagre": "https://esm.sh/cytoscape-dagre@2.5.0?external=cytoscape",
      "zustand": "https://esm.sh/zustand@5.0.2?external=react",
      "zustand/": "https://esm.sh/zustand@5.0.2&external=react/"
    }
  }
  </script>
  <script type="module">
    // Simulated DSH module loader runtime.
    const __ModuleLoader__ = {
      _modules: new Map(),
      load(id, factory) { this._modules.set(id, factory()); },
      register(reg) { this._modules.set(reg.id, reg.factory()); },
      get(id) { return this._modules.get(id); }
    };
    globalThis.__ModuleLoader__ = __ModuleLoader__;

    // Mock graph data for testing (wrapped as a GraphData payload for init()).
    const mockGraphData = {
      nodes: [
        { id: 'n1', label: 'apply', type: 'function', filePath: 'src/index.ts', lineNumber: 9, properties: {} },
        { id: 'n2', label: 'createGraphTools', type: 'function', filePath: 'src/tools.ts', lineNumber: 61, properties: {} },
        { id: 'n3', label: 'CodeGraphAdapter', type: 'class', filePath: 'src/adapters/CodeGraphAdapter.ts', lineNumber: 25, properties: {} },
        { id: 'n4', label: 'LensAdapter', type: 'class', filePath: 'src/adapters/LensAdapter.ts', lineNumber: 22, properties: {} },
        { id: 'n5', label: 'GraphDataMerger', type: 'class', filePath: 'src/merger/GraphDataMerger.ts', lineNumber: 5, properties: {} },
        { id: 'n6', label: 'GraphPanel', type: 'function', filePath: 'src/client/GraphPanel.tsx', lineNumber: 30, properties: {} },
        { id: 'n7', label: 'CytoscapeRenderer', type: 'class', filePath: 'src/client/renderer/CytoscapeRenderer.ts', lineNumber: 53, properties: {} },
        { id: 'n8', label: 'useGraphStore', type: 'variable', filePath: 'src/client/store/graphStore.ts', lineNumber: 39, properties: {} },
        { id: 'n9', label: 'graphData', type: 'function', filePath: 'src/tools.ts', lineNumber: 119, properties: {} },
        { id: 'n10', label: 'summarizeGraph', type: 'function', filePath: 'src/tools.ts', lineNumber: 37, properties: {} },
        { id: 'n11', label: 'fetchMergedGraph', type: 'function', filePath: 'src/tools.ts', lineNumber: 21, properties: {} },
        { id: 'n12', label: 'RepoId', type: 'variable', filePath: 'src/types/index.ts', lineNumber: 11, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n2', target: 'n3', type: 'call', properties: {} },
        { id: 'e3', source: 'n2', target: 'n4', type: 'call', properties: {} },
        { id: 'e4', source: 'n2', target: 'n5', type: 'call', properties: {} },
        { id: 'e5', source: 'n6', target: 'n7', type: 'call', properties: {} },
        { id: 'e6', source: 'n6', target: 'n8', type: 'call', properties: {} },
        { id: 'e7', source: 'n9', target: 'n11', type: 'call', properties: {} },
        { id: 'e8', source: 'n11', target: 'n3', type: 'call', properties: {} },
        { id: 'e9', source: 'n11', target: 'n4', type: 'call', properties: {} },
        { id: 'e10', source: 'n11', target: 'n5', type: 'call', properties: {} },
        { id: 'e11', source: 'n9', target: 'n10', type: 'call', properties: {} },
        { id: 'e12', source: 'n3', target: 'n12', type: 'import', properties: {} },
        { id: 'e13', source: 'n4', target: 'n12', type: 'import', properties: {} },
        { id: 'e14', source: 'n5', target: 'n12', type: 'import', properties: {} },
      ],
    };

    // GraphData payload consumed by the real client bundle's init().
    const graphDataPayload = {
      ...mockGraphData,
      metadata: {
        repoId: 'dev-workspace',
        timestamp: Date.now(),
        nodeCount: mockGraphData.nodes.length,
        edgeCount: mockGraphData.edges.length,
      },
    };

    // API modal handling — "Configure Later" skips and reveals the panel.
    const apiModal = document.getElementById('api-modal');
    const apiSkipBtn = document.getElementById('api-skip-btn');
    const apiSaveBtn = document.getElementById('api-save-btn');
    const apiStatus = document.getElementById('api-status');
    const apiKeyInput = document.getElementById('api-key-input');

    function dismissModal(configured) {
      apiModal.style.display = 'none';
      apiStatus.textContent = configured ? 'API: Connected' : 'API: Skipped (configure later)';
      apiStatus.style.color = configured ? '#10b981' : 'var(--dsw-fg-secondary)';
      // Load the plugin after modal dismissal.
      loadPlugin();
    }

    apiSkipBtn.addEventListener('click', () => dismissModal(false));
    apiSaveBtn.addEventListener('click', () => {
      const key = apiKeyInput.value.trim();
      dismissModal(key.length > 0);
    });

    async function loadPlugin() {
      // Prefer the real client bundle (architecture fidelity): the ESM build
      // at dist/client/index.esm.js (the DSH web shell loads the CJS-wrapped
      // dist/client/index.js via a classic <script> tag). Falls back to the
      // inline renderer only when the bundle or its browser deps fail.
      try {
        const mod = await import('/dist/client/index.esm.js');
        if (mod && typeof mod.init === 'function') {
          mod.init(document.getElementById('plugin-root'), graphDataPayload);
          console.log('[dev-server] real client bundle loaded');
          return;
        }
        console.warn('[dev-server] bundle has no init(), falling back to inline renderer');
      } catch (err) {
        console.warn('[dev-server] real bundle unavailable, falling back to inline renderer:', err?.message);
      }
      try {
        const react = await import('react');
        const reactDom = await import('react-dom/client');
        await renderInlinePanel(react, reactDom);
      } catch (err) {
        console.error('Failed to load plugin:', err);
        document.getElementById('plugin-root').innerHTML =
          '<div style="padding:20px;color:#ef4444">Plugin load failed: ' + err.message + '</div>';
      }
    }

    // Inline fallback renderer using Cytoscape directly + project CSS classes.
    async function renderInlinePanel(react, reactDom) {
      let cytoscape, dagre;
      try {
        cytoscape = (await import('cytoscape')).default;
        dagre = (await import('cytoscape-dagre')).default;
        cytoscape.use(dagre);
      } catch (e) {
        console.error('Failed to load cytoscape:', e.message);
        document.getElementById('plugin-root').innerHTML =
          '<div style="padding:20px;color:#ef4444">Failed to load cytoscape: ' + e.message + '</div>';
        return;
      }

      const { useEffect, useRef, useState, useCallback } = react;
      const h = react.createElement;

      const Panel = () => {
        const containerRef = useRef(null);
        const cyRef = useRef(null);
        const [layout, setLayout] = useState('cose');
        const [theme, setTheme] = useState('dark');
        const [collapsed, setCollapsed] = useState(false);
        const [selected, setSelected] = useState(null);
        const [showSearch, setShowSearch] = useState(false);
        const [searchQuery, setSearchQuery] = useState('');
        const [filterType, setFilterType] = useState('all');

        useEffect(() => {
          if (!containerRef.current) return;
          const cy = cytoscape({
            container: containerRef.current,
            elements: [
              ...mockGraphData.nodes.map(n => ({
                group: 'nodes',
                data: { id: n.id, label: n.label, type: n.type, filePath: n.filePath, lineNumber: n.lineNumber, weight: 5 }
              })),
              ...mockGraphData.edges.map(e => ({
                group: 'edges',
                data: { id: e.id, source: e.source, target: e.target, type: e.type }
              })),
            ],
            style: [
              { selector: 'node', style: {
                'background-color': '#6366f1', 'label': 'data(label)', 'font-size': '11px',
                'color': '#e6e8f0', 'text-valign': 'center', 'text-halign': 'center',
                'text-wrap': 'wrap', 'text-max-width': '80px', 'width': 32, 'height': 32,
                'border-width': 2, 'border-color': '#2e3142',
                'transition-property': 'background-color', 'transition-duration': 200,
              }},
              { selector: 'node[type="function"]', style: { 'background-color': '#10b981', 'shape': 'round-triangle' }},
              { selector: 'node[type="class"]', style: { 'background-color': '#818cf8', 'shape': 'rectangle' }},
              { selector: 'node[type="variable"]', style: { 'background-color': '#f59e0b', 'shape': 'diamond' }},
              { selector: 'node[type="module"]', style: { 'background-color': '#ec4899', 'shape': 'round-rectangle' }},
              { selector: 'edge', style: {
                'width': 1.5, 'line-color': '#6b7280', 'target-arrow-color': '#6b7280',
                'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'opacity': 0.7,
              }},
              { selector: 'edge[type="call"]', style: { 'line-color': '#60a5fa', 'target-arrow-color': '#60a5fa' }},
              { selector: 'edge[type="import"]', style: { 'line-color': '#34d399', 'target-arrow-color': '#34d399' }},
              { selector: '.selected', style: { 'border-width': 4, 'border-color': '#ef4444', 'z-index': 30 }},
              { selector: '.highlighted', style: { 'border-width': 4, 'border-color': '#fbbf24', 'z-index': 20 }},
              { selector: '.search-match', style: { 'border-width': 3, 'border-color': '#22c55e' }},
            ],
            layout: { name: layout, animate: true, animationDuration: 300 },
            wheelSensitivity: 0.2,
            minZoom: 0.1, maxZoom: 3,
          });
          cyRef.current = cy;
          cy.on('tap', 'node', (evt) => {
            cy.elements().removeClass('selected');
            evt.target.addClass('selected');
            const id = evt.target.id();
            const node = mockGraphData.nodes.find(n => n.id === id);
            setSelected(node);
          });
          cy.on('mouseover', 'node', (evt) => {
            evt.target.addClass('highlighted');
          });
          cy.on('mouseout', 'node', (evt) => {
            evt.target.removeClass('highlighted');
          });
          return () => { cy.destroy(); };
        }, []);

        useEffect(() => {
          const cy = cyRef.current;
          if (!cy) return;
          cy.layout({ name: layout, animate: true, animationDuration: 300 }).run();
        }, [layout]);

        useEffect(() => {
          const cy = cyRef.current;
          if (!cy) return;
          if (!searchQuery) {
            cy.nodes().removeClass('search-match');
            return;
          }
          const q = searchQuery.toLowerCase();
          cy.nodes().forEach(node => {
            const label = node.data('label') || '';
            node.toggleClass('search-match', label.toLowerCase().includes(q));
          });
        }, [searchQuery]);

        useEffect(() => {
          const cy = cyRef.current;
          if (!cy) return;
          cy.nodes().forEach(node => {
            node.style('display', filterType !== 'all' && node.data('type') !== filterType ? 'none' : 'element');
          });
          cy.edges().forEach(edge => {
            const srcHidden = edge.source().style('display') === 'none';
            const tgtHidden = edge.target().style('display') === 'none';
            edge.style('display', srcHidden || tgtHidden ? 'none' : 'element');
          });
        }, [filterType]);

        const handleThemeToggle = useCallback(() => {
          const next = theme === 'dark' ? 'light' : 'dark';
          setTheme(next);
          document.documentElement.setAttribute('data-theme', next);
        }, [theme]);

        const stats = mockGraphData.nodes.length + ' nodes · ' + mockGraphData.edges.length + ' edges';
        const layouts = ['cose', 'dagre', 'circle', 'grid'];
        const filterOptions = [
          { value: 'all', label: 'All' },
          { value: 'function', label: 'Functions' },
          { value: 'class', label: 'Classes' },
          { value: 'variable', label: 'Variables' },
        ];

        if (collapsed) {
          return h('div', {
            className: 'graph-panel resizable collapsed',
            onClick: () => setCollapsed(false),
            role: 'button',
            'aria-label': 'Expand graph panel',
          }, h('div', { className: 'collapse-fab' }, '📊'));
        }

        return h('div', { className: 'graph-panel resizable' },
          h('div', { className: 'graph-toolbar' },
            h('div', { className: 'toolbar-left' },
              h('span', { className: 'node-count' }, stats),
            ),
            h('div', { className: 'toolbar-center' },
              h('div', { className: 'layout-buttons', role: 'group', 'aria-label': 'Layout switcher' },
                ...layouts.map(l => h('button', {
                  key: l,
                  className: 'layout-btn ' + (layout === l ? 'active' : ''),
                  onClick: () => setLayout(l),
                  'aria-pressed': layout === l,
                }, l)),
              ),
            ),
            h('div', { className: 'toolbar-right' },
              h('select', {
                value: filterType,
                onChange: (e) => setFilterType(e.target.value),
                className: 'filter-select',
                'aria-label': 'Filter by node type',
              }, ...filterOptions.map(opt => h('option', { key: opt.value, value: opt.value }, opt.label))),
              h('button', {
                className: 'search-btn ' + (showSearch ? 'active' : ''),
                onClick: () => setShowSearch(!showSearch),
                'aria-label': 'Search symbols',
                title: 'Search (press /)',
              }, '🔍'),
              h('button', {
                className: 'chain-btn',
                onClick: () => {},
                'aria-label': 'Toggle call chain',
                title: 'Call chain (Ctrl+C)',
              }, '🔗'),
              h('button', {
                className: 'cycle-btn',
                onClick: () => {},
                'aria-label': 'Highlight cycles',
                title: 'Circular dependencies',
              }, '🔄'),
              h('button', {
                className: 'minimap-btn',
                onClick: () => {},
                'aria-label': 'Toggle mini-map',
                title: 'Mini-map overview',
              }, '🗺️'),
              h('button', {
                className: 'refresh-btn',
                onClick: () => {},
                'aria-label': 'Refresh graph',
                title: 'Refresh',
              }, '⟳'),
              h('div', { className: 'export-menu' },
                h('button', { className: 'export-btn', 'aria-label': 'Export graph', title: 'Export' }, '📥'),
                h('div', { className: 'export-dropdown', role: 'menu' },
                  h('button', { role: 'menuitem', onClick: () => {} }, 'PNG'),
                  h('button', { role: 'menuitem', onClick: () => {} }, 'SVG'),
                  h('button', { role: 'menuitem', onClick: () => {} }, 'JSON'),
                ),
              ),
              h('button', {
                className: 'theme-btn',
                onClick: handleThemeToggle,
                'aria-label': 'Toggle theme',
                title: 'Toggle theme',
              }, theme === 'dark' ? '☀️' : '🌙'),
              h('button', {
                className: 'collapse-btn',
                onClick: () => setCollapsed(true),
                'aria-label': 'Collapse panel',
                title: 'Collapse',
              }, '▼'),
            ),
          ),
          showSearch && h('div', { className: 'search-bar' },
            h('input', {
              type: 'text',
              placeholder: 'Search symbols…',
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
              autoFocus: true,
              'aria-label': 'Symbol search input',
            }),
            h('button', { onClick: () => setShowSearch(false), 'aria-label': 'Close search' }, '✕'),
            h('span', { className: 'search-hint' }, 'debounced 200ms'),
          ),
          h('div', { ref: containerRef, className: 'graph-container' }),
          selected && h('div', { className: 'node-detail-panel', role: 'complementary', 'aria-label': 'Node details' },
            h('button', {
              className: 'close-btn',
              onClick: () => { setSelected(null); cyRef.current?.elements().removeClass('selected'); },
              'aria-label': 'Close details',
            }, '✕'),
            h('h3', null, selected.label),
            h('div', { className: 'detail-row' },
              h('span', { className: 'detail-label' }, 'Type'),
              h('span', { className: 'detail-value' }, selected.type),
            ),
            h('div', { className: 'detail-row' },
              h('span', { className: 'detail-label' }, 'File'),
              h('span', { className: 'detail-value' }, selected.filePath),
            ),
            h('div', { className: 'detail-row' },
              h('span', { className: 'detail-label' }, 'Line'),
              h('span', { className: 'detail-value' }, String(selected.lineNumber)),
            ),
            h('div', { className: 'detail-row' },
              h('span', { className: 'detail-label' }, 'ID'),
              h('span', { className: 'detail-value' }, selected.id),
            ),
          ),
          h('div', { className: 'status-bar', role: 'status' },
            h('div', { className: 'status-item' },
              h('span', { className: 'status-dot' }),
              h('span', null, 'Ready'),
            ),
            h('div', { className: 'status-item' },
              h('span', null, mockGraphData.nodes.length + 'n · ' + mockGraphData.edges.length + 'e'),
            ),
            h('div', { className: 'status-spacer' }),
            h('div', { className: 'status-item' },
              h('span', null, layout + ' · ' + theme),
            ),
          ),
          h('div', { className: 'resize-handle', 'aria-hidden': 'true' }),
        );
      };

      const root = reactDom.createRoot(document.getElementById('plugin-root'));
      root.render(h(Panel));
    }
  </script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // Serve static files from project root (for /dist/client/* etc.)
  if (url.startsWith('/dist/') || url.startsWith('/src/')) {
    const filePath = join(ROOT, url);
    try {
      const data = await readFile(filePath);
      const ext = url.split('.').pop() ?? '';
      const types = { js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json' };
      res.writeHead(200, { 'Content-Type': (types[ext] ?? 'application/octet-stream') + '; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  DSH CodeGraph Visualizer — dev server`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});