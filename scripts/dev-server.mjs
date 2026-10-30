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

// -----------------------------------------------------------------------------
// 桩图数据 —— 唯一真源
// -----------------------------------------------------------------------------
// 页面内联脚本（`mod.init()` 的初始负载）与 `/api/v1/codegraph/data` 增量刷新接口
// **必须**共用这一份定义，再也不能各写一份。
//
// 历史缺陷（cycle-81 定位）：两处各写一份（21 节点 vs 6 节点），且两份都只用
// `class` 节点构造「环」，而 `src/client/diagram/CallGraphAssembler.ts:5` 的
// `CALL_NODE_TYPES = new Set(['function'])` 会在装配前把所有 class 节点过滤掉，
// 于是调用视图里既没有环、也没有可被 `selectNode` 命中的节点，
// J5（循环面板）与 J31（波及半径面板）在 E2E 里**永远无法验证**。
//
// 因此本数据的硬约束（改动前请先读 `src/client/diagram/CallGraphAssembler.ts`
// 与 `src/client/diagram/index.ts:69-73`）：
//   1. 环必须由 **function → function** 的 `call` 边构成，否则被装配器过滤；
//   2. 至少有一个 function 节点可作 `selectNode` 目标，否则分析面板缺前置数据
//      （`src/client/hooks/useAnalysisPanels.ts:82-89`）；
//   3. 环上的 function 节点在 Layer 0（`isEntry === true || depth <= 1`）中必须保留。
// 这里用 n9 ↔ n11（`graphData` 与 `fetchMergedGraph`）成环：两者都是 function，
// 且深度默认回退为 0，必然通过上述两条过滤。
//
// 注意：本常量会被 `JSON.stringify` 注入 HTML 模板字符串，注释里可以出现反引号
// （注释在模板字符串之外），但**注入点之后**的 HTML 内联脚本注释里不能出现反引号。
const MOCK_GRAPH = {
  nodes: [
    { id: 'n1', label: 'apply', type: 'function', filePath: 'src/index.ts', lineNumber: 9, properties: { depth: 0, isEntry: true } },
    { id: 'n2', label: 'createGraphTools', type: 'function', filePath: 'src/tools.ts', lineNumber: 61, properties: { depth: 1, isEntry: true } },
    { id: 'n3', label: 'CodeGraphAdapter', type: 'class', filePath: 'src/adapters/CodeGraphAdapter.ts', lineNumber: 25, properties: { depth: 2 } },
    { id: 'n4', label: 'LensAdapter', type: 'class', filePath: 'src/adapters/LensAdapter.ts', lineNumber: 22, properties: { depth: 2 } },
    { id: 'n5', label: 'GraphDataMerger', type: 'class', filePath: 'src/merger/GraphDataMerger.ts', lineNumber: 5, properties: { depth: 2 } },
    { id: 'n6', label: 'GraphPanel', type: 'function', filePath: 'src/client/GraphPanel.tsx', lineNumber: 30, properties: { depth: 1 } },
    { id: 'n7', label: 'CytoscapeRenderer', type: 'class', filePath: 'src/client/renderer/CytoscapeRenderer.ts', lineNumber: 53, properties: { depth: 2 } },
    { id: 'n8', label: 'useGraphStore', type: 'variable', filePath: 'src/client/store/graphStore.ts', lineNumber: 39, properties: { depth: 1 } },
    { id: 'n9', label: 'graphData', type: 'function', filePath: 'src/tools.ts', lineNumber: 119, properties: { depth: 1, isEntry: true } },
    { id: 'n10', label: 'summarizeGraph', type: 'function', filePath: 'src/tools.ts', lineNumber: 37, properties: { depth: 1, isEntry: true } },
    { id: 'n11', label: 'fetchMergedGraph', type: 'function', filePath: 'src/tools.ts', lineNumber: 21, properties: { depth: 1, isEntry: true } },
    { id: 'n12', label: 'RepoId', type: 'variable', filePath: 'src/types/index.ts', lineNumber: 11, properties: { depth: 0 } },
    // cycle-112：n13 只为给 n3 凑入度到 5（isHotspotEligible 阈值）——见 edges e30 的注释。
    { id: 'n13', label: 'createRepository', type: 'function', filePath: 'src/host/db/GraphRepository.ts', lineNumber: 12, properties: { depth: 1 } },
    { id: 'm1', label: 'src/index.ts', type: 'module', filePath: 'src/index.ts', lineNumber: 0, properties: {} },
    { id: 'm2', label: 'src/tools.ts', type: 'module', filePath: 'src/tools.ts', lineNumber: 0, properties: {} },
    { id: 'm3', label: 'src/adapters/CodeGraphAdapter.ts', type: 'module', filePath: 'src/adapters/CodeGraphAdapter.ts', lineNumber: 0, properties: {} },
    { id: 'm4', label: 'src/adapters/LensAdapter.ts', type: 'module', filePath: 'src/adapters/LensAdapter.ts', lineNumber: 0, properties: {} },
    { id: 'm5', label: 'src/merger/GraphDataMerger.ts', type: 'module', filePath: 'src/merger/GraphDataMerger.ts', lineNumber: 0, properties: {} },
    { id: 'm6', label: 'src/client/GraphPanel.tsx', type: 'module', filePath: 'src/client/GraphPanel.tsx', lineNumber: 0, properties: {} },
    { id: 'm7', label: 'src/client/renderer/CytoscapeRenderer.ts', type: 'module', filePath: 'src/client/renderer/CytoscapeRenderer.ts', lineNumber: 0, properties: {} },
    { id: 'm8', label: 'src/client/store/graphStore.ts', type: 'module', filePath: 'src/client/store/graphStore.ts', lineNumber: 0, properties: {} },
    { id: 'm9', label: 'src/types/index.ts', type: 'module', filePath: 'src/types/index.ts', lineNumber: 0, properties: {} },
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
    { id: 'e15', source: 'n3', target: 'n4', type: 'extend', properties: {} },
    { id: 'e16', source: 'n5', target: 'n3', type: 'implement', properties: {} },
    { id: 'e17', source: 'm1', target: 'n1', type: 'contains', properties: {} },
    { id: 'e18', source: 'm2', target: 'n2', type: 'contains', properties: {} },
    { id: 'e19', source: 'm2', target: 'n9', type: 'contains', properties: {} },
    { id: 'e20', source: 'm2', target: 'n10', type: 'contains', properties: {} },
    { id: 'e21', source: 'm2', target: 'n11', type: 'contains', properties: {} },
    { id: 'e22', source: 'm3', target: 'n3', type: 'contains', properties: {} },
    { id: 'e23', source: 'm4', target: 'n4', type: 'contains', properties: {} },
    { id: 'e24', source: 'm5', target: 'n5', type: 'contains', properties: {} },
    { id: 'e25', source: 'm6', target: 'n6', type: 'contains', properties: {} },
    { id: 'e26', source: 'm7', target: 'n7', type: 'contains', properties: {} },
    { id: 'e27', source: 'm8', target: 'n8', type: 'contains', properties: {} },
    { id: 'e28', source: 'm9', target: 'n12', type: 'contains', properties: {} },
    // e29 与 e7 构成**函数级环** n9 → n11 → n9。两端都是 function，
    // 因此能穿过 CallGraphAssembler 的类型过滤并留在 Layer 0，
    // 让 J5 的 cycleDetails 与 J31 的 selectedNodeId 都有真实数据可依。
    { id: 'e29', source: 'n11', target: 'n9', type: 'call', properties: {} },
    // cycle-112：e30 让 n3 的入度达到 5（= `isHotspotEligible` 的阈值，`churn.ts:156`）。
    // 此前桩图最高入度只有 4 ⇒ 热点面板永远为空（`visible: showHotspot && hotspotNodes.length > 0`），
    // J28「热点分析」在 dev-server 上不可达 —— 与 CLAUDE.md「阈值与喂它的界是一次契约」同族。
    // 来源 n13 是独立函数，不引入新环。
    { id: 'e30', source: 'n13', target: 'n3', type: 'call', properties: {} },
  ],
};

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
  <!-- 插件 CSS 的唯一来源：ESM 产物不内联样式（tsdown 只产出 index.css），
       因此页面必须以 <link> 引入构建产物 dist/client/index.css。
       历史上这里写的是 /src/client/styles.css，该文件在 CSS 模块化拆分
       （1d61b53）后已删除，导致每次加载都 404、插件样式整体丢失。 -->
  <link rel="stylesheet" href="/dist/client/index.css" />
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

  <!-- E2E 需要读取 Zustand store（window.__graphStore）来断言状态。
       该调试句柄只在 localStorage.__cg_debug === '1' 时才挂载
       （src/client/store/graphStore.ts:174-176），真实 DSH 宿主不会开启它，
       所以 dev-server 必须在这里显式打开，否则所有读 store 的 E2E 断言
       都会拿到 null。 -->
  <script>localStorage.setItem('__cg_debug', '1');</script>

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
    // 数据来自服务端的 MOCK_GRAPH 单一真源（见文件头注释），不再各自维护一份。
    const mockGraphData = ${JSON.stringify(MOCK_GRAPH)};

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

  // ---------------------------------------------------------------------------
  // 插件 HTTP API 桩（cycle-81）
  //
  // 本 dev-server 只模拟 DSH 外壳，原先对 `/api/**` 一律回 404 文本 `Not found`。
  // 21 个 E2E spec 里有 4 个直接打插件 API（realtime / diff-and-integration /
  // performance / resource-exhaustion），于是 404 文本被 `res.json()` 解析成
  // `SyntaxError: Unexpected token 'N'`——「接口不存在」被伪装成「解析失败」，
  // 与选择器脱节一起构成 TODO-02 的两个真实根因。
  //
  // 这里给出与 host 路由语义一致的最小桩：状态码、ETag/304 短路、错误体形状
  // 都与 `src/host/routes/*.ts` 对齐，让 E2E 断言的是**契约**而不是巧合。
  // ---------------------------------------------------------------------------
  if (url.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

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

// -----------------------------------------------------------------------------
// API 桩实现
// -----------------------------------------------------------------------------

// 图数据只有一份真源：文件头的 MOCK_GRAPH。这里曾经另写一份 6 节点副本，
// 与页面内联的那份（21 节点）互相漂移，导致「页面里能看到的图」与
// 「接口返回的图」不是同一张——J5/J31 的失败正是由此而来。
const API_GRAPH = MOCK_GRAPH;

const DEV_WORKSPACE = 'dev-workspace';

function graphPayload() {
  return {
    ...API_GRAPH,
    metadata: {
      repoId: DEV_WORKSPACE,
      timestamp: 1,
      nodeCount: API_GRAPH.nodes.length,
      edgeCount: API_GRAPH.edges.length,
    },
  };
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

/**
 * 带条件请求的最小桩 —— 与 host `src/host/routes/shared.ts` 的 `etagGuard` 同语义。
 *
 * 为什么 dev-server 需要它：P3-R18-02 的原始缺陷是"校验器可达但校验值不可达"——
 * 路由能回 304，但 200 从不带 `etag`，客户端手里永远没有可回传的值。
 * 只补服务端、不在 dev-server 里也给出这个形状，端到端就**无法验证**条件请求真的发生
 * （E2E 只能看到"面板渲染了"，而"每次都全量重取"在画面上完全一样）。
 *
 * 校验值的字符串形状刻意与 host 一致（`W/"<revision>-<hash>"`），但哈希算法**不必**相同：
 * dev-server 是自洽的桩，客户端只做"原样保存、原样回传"，不解析这个值。
 * 请求键必须覆盖所有会改变载荷的参数，少一个就等价于两个不同响应共用一个校验值。
 */
function etagFor(resource, requestKey) {
  const identity = `${resource}\u0001${DEV_REPO_ID}\u0001${requestKey}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < identity.length; i++) {
    const c = identity.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  return `W/"${DEV_REVISION}-${hex}"`;
}

/**
 * 条件请求短路：命中就回 304（带 ETag），否则调用 `send()` 并附带 ETag。
 *
 * 两条路径都写 ETag 是关键：只写 304 分支正是原缺陷；只写 200 分支则客户端第二轮无从比较。
 */
function conditionalJson(req, res, resource, requestKey, send) {
  const etag = etagFor(resource, requestKey);
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  send(etag);
}

/** dev-server 的"版本"：桩数据是静态的，所以固定为 1（与 `/data` 桩一致）。 */
const DEV_REVISION = 1;
const DEV_REPO_ID = 'dev-workspace';

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** git ref 合法性：与 host `diffRoutes` 同规则，拒绝 shell 元字符。 */
const INVALID_REF_RE = /[;|&$`<>(){}[\]\s]/;

async function handleApi(req, res, url) {
  const path = url.split('?')[0];
  const method = req.method ?? 'GET';

  // --- 图数据：带 if-none-match 走 304 短路（对应 host `returnIfEtagMatch`） ---
  if (path === '/api/v1/codegraph/data' && method === 'GET') {
    const etag = `W/"dev-1"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
    sendJson(res, 200, graphPayload(), { ETag: etag });
    return;
  }

  // --- 扫描：POST 后回成功体，触发前端增量刷新 ---
  if (path === '/api/v1/codegraph/scan') {
    if (method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
    const body = await readJsonBody(req);
    if (body === null) { sendJson(res, 400, { error: 'Invalid JSON body' }); return; }
    sendJson(res, 200, {
      success: true,
      nodes: API_GRAPH.nodes,
      edges: API_GRAPH.edges,
      metadata: graphPayload().metadata,
    });
    return;
  }

  // --- 版本对比：非法 ref 必须 400 + `Invalid git ref`（E2E 直接断言该文案） ---
  if (path === '/api/v1/codegraph/diff') {
    if (method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
    const body = await readJsonBody(req);
    if (body === null) { sendJson(res, 400, { error: 'Invalid JSON body' }); return; }
    const { from, to } = body;
    if (typeof from !== 'string' || typeof to !== 'string' || INVALID_REF_RE.test(from) || INVALID_REF_RE.test(to)) {
      sendJson(res, 400, { error: `Invalid git ref: ${from ?? ''}..${to ?? ''}` });
      return;
    }
    sendJson(res, 200, { from, to, added: [], removed: [], changed: [] });
    return;
  }

  // --- 健康检查：`codegraph: false` 是本机降级态，与真实 host 一致 ---
  // （cycle-118：`builtin` 兼容别名已移除，桩与真实宿主同形——只发四个位。）
  if (path === '/api/v1/codegraph/health' && method === 'GET') {
    sendJson(res, 200, {
      status: 'healthy',
      codegraph: false,
      lens: false,
      astSource: false,
      graphSource: true,
      hasGraphData: true,
      fingerprint: 'dev-stub',
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
    return;
  }

  if (path === '/api/v1/codegraph/status' && method === 'GET') {
    sendJson(res, 200, { codegraph: false, lens: false, astSource: false, graphSource: true });
    return;
  }

  if (path === '/api/v1/codegraph/registry' && method === 'GET') {
    // cycle-118 补桩：dev-server 与宿主路由面漂移（宿主 cycle-116 加了 /registry，
    // 桩没跟上 ⇒ 注册矩阵面板在 dev-server 404，旅程缺口）。形状与宿主
    // `registrySummary()` 一致（四面计数 / 断链 / 生命周期），条目用桩图自证。
    const nodeIds = API_GRAPH.nodes.map((n) => n.id);
    const entries = [
      ...nodeIds.map((id) => ({
        id: `dev:node:${id}`, face: 'routes', kind: 'dev-stub', label: `stub node ${id}`,
        producers: ['dev-server'], consumers: ['graph-panel'], lifecycle: 'producing',
      })),
    ];
    const byFace = {};
    for (const e of entries) byFace[e.face] = (byFace[e.face] ?? 0) + 1;
    sendJson(res, 200, {
      version: 1,
      generatedAt: Date.now(),
      total: entries.length,
      byFace,
      brokenLinks: [],
      lifecycleCounts: { registered: 0, producing: entries.length, consuming: 0, degraded: 0 },
      entries,
    });
    return;
  }

  if (path === '/api/v1/codegraph/workspace' && method === 'GET') {
    sendJson(res, 200, { path: ROOT, list: [ROOT], rootSource: 'dev-server' });
    return;
  }

  if (path === '/api/v1/codegraph/bootstrap' && method === 'GET') {
    const payload = graphPayload();
    // 请求键 = `bootstrap`：这条路由没有参数（工作区已在校验值的身份维度里）。
    conditionalJson(req, res, 'bootstrap', 'bootstrap', (etag) => {
      sendJson(res, 200, {
        rootNodes: payload.nodes,
        topLevelNodes: payload.nodes,
        topLevelTotal: payload.nodes.length,
        edges: payload.edges,
        indexStatus: 'ready',
        metadata: { ...payload.metadata, totalNodeCount: payload.nodes.length, totalEdgeCount: payload.edges.length },
      }, { ETag: etag });
    });
    return;
  }

  // --- 子节点展开：`resource-exhaustion` 用它验证并发取消 ---
  const childrenMatch = path.match(/^\/api\/v1\/codegraph\/nodes\/([^/]+)\/children$/);
  if (childrenMatch) {
    const childNodeId = decodeURIComponent(childrenMatch[1] ?? '');
    conditionalJson(req, res, 'children', `children:${childNodeId}::50`, (etag) => {
      sendJson(res, 200, { nodes: [], edges: [], cursor: null, total: 0 }, { ETag: etag });
    });
    return;
  }

  if (path === '/api/v1/codegraph/children' && method === 'GET') {
    // 请求键 = `children:<nodeId>:<cursor>:<limit>`，与 `etagKeyForChildren` 同形。
    // 节点维度是必需的：少了它，nodeA 的校验值会让 nodeB 的请求收到 304，
    // 而客户端手上没有 nodeB 的子节点 ⇒ nodeB 永远展开不出来且无错误可见。
    const childQuery = new URL(url, 'http://localhost').searchParams;
    const childNodeId = childQuery.get('nodeId') ?? '';
    const childCursor = childQuery.get('cursor') ?? '';
    const childLimit = Number.parseInt(childQuery.get('limit') ?? '50', 10) || 50;
    conditionalJson(req, res, 'children', `children:${childNodeId}:${childCursor}:${childLimit}`, (etag) => {
      sendJson(res, 200, { nodes: [], edges: [], cursor: null, total: 0 }, { ETag: etag });
    });
    return;
  }

  // --- 文件大纲：`expandNode` 对 `type === 'module'` 的节点会打这个端点。
  // 契约逐字对齐 `src/host/routes/dataRoutes.ts:252-306 registerFileOutlineRoute`：
  // 正则 `^\/api\/v1\/codegraph\/files\/([^/]+)\/outline$`，返回 `{ symbols, edges }`。
  // 符号一律从 `API_GRAPH` 派生，绝不另写一份节点副本（否则会与页面内联的
  // `mockGraphData` 漂移，正是历史上 `API_GRAPH` 被抽出来的原因）。
  const outlineMatch = path.match(/^\/api\/v1\/codegraph\/files\/([^/]+)\/outline$/);
  if (outlineMatch && method === 'GET') {
    const fileId = decodeURIComponent(outlineMatch[1] ?? '');
    const fileNode = API_GRAPH.nodes.find((n) => n.id === fileId);
    if (!fileNode) {
      sendJson(res, 404, { error: 'INVALID_FILEPATH', message: 'Invalid filePath' });
      return;
    }
    const symbols = API_GRAPH.nodes.filter(
      (n) => n.filePath === fileNode.filePath && n.type !== 'module' && n.id !== fileNode.id,
    );
    const symbolIds = new Set(symbols.map((n) => n.id));
    const edges = API_GRAPH.edges.filter((e) => symbolIds.has(e.source) && symbolIds.has(e.target));
    // 请求键 = `outline:<nodeId>`，与 `etagKeyForOutline` 同形（不同文件不得共用校验值）。
    conditionalJson(req, res, 'outline', `outline:${fileId}`, (etag) => {
      sendJson(res, 200, { symbols, edges }, { ETag: etag });
    });
    return;
  }

  // --- 单符号 AST：`expandNode` 对 `type === 'function'` 的节点会打这个端点。
  // 契约逐字对齐 `src/host/routes/dataRoutes.ts:308+ registerSymbolASTRoute`：
  // 正则 `^\/api\/v1\/codegraph\/symbols\/([^/]+)\/ast$`，**必须返回 6 个键**
  // （`astNodes` / `astEdges` / `sourceLines` / `total` / `cursor` / `hasMore`）——
  // 少一个键客户端就会走「本页即全部」的降级分支，契约用例也就失去意义。
  const astMatch = path.match(/^\/api\/v1\/codegraph\/symbols\/([^/]+)\/ast$/);
  if (astMatch && method === 'GET') {
    const symbolId = decodeURIComponent(astMatch[1] ?? '');
    const symbolNode = API_GRAPH.nodes.find((n) => n.id === symbolId);
    if (!symbolNode) {
      sendJson(res, 404, { error: 'INVALID_FILEPATH', message: 'Invalid filePath' });
      return;
    }
    // 默认只回该符号自身：AST 的兄弟函数体必须**不被**加载，
    // 这正是「展开 foo 后同文件其他函数体请求数必须为 0」要守住的语义。
    const astNodes = [symbolNode];
    const astEdges = [];
    // 请求键 = `ast:<nodeId>:<cursor>:<budget>`，与 `etagKeyForAst` 同形。
    // `cursor` 与 `budget` 都在键里：它们是载荷的一部分（不同分页/预算不得共用校验值）。
    // budget 的解析必须与 host 的 `resolveAstBudget` 同语义（默认 800、上限 800、非法回落），
    // 否则同一请求在桩与 host 上算出不同的校验值。
    const astQuery = new URL(url, 'http://localhost').searchParams;
    const astCursor = Math.max(Number.parseInt(astQuery.get('cursor') ?? '0', 10) || 0, 0);
    const astBudgetRaw = Number.parseInt(astQuery.get('budget') ?? '800', 10);
    const astBudget = !Number.isFinite(astBudgetRaw) || astBudgetRaw <= 0 ? 800 : Math.min(astBudgetRaw, 800);
    conditionalJson(req, res, 'ast', `ast:${symbolId}:${astCursor}:${astBudget}`, (etag) => {
      sendJson(res, 200, {
        astNodes,
        astEdges,
        sourceLines: [],
        total: astNodes.length,
        cursor: astNodes.length,
        hasMore: false,
      }, { ETag: etag });
    });
    return;
  }

  // --- 依赖图（cycle-112 补桩）：切到任一 behavioral 视图时 `useViewMode.ts:57` 会
  // `fetch /api/v1/codegraph/dependencies`，**成功后才 setViewMode**（空载荷直接 return）。
  // 此前没有这个桩 ⇒ fetch 404 ⇒ 切层永远不生效，E2E 的 viewMode 切换 / hotspot /
  // godModule 一族长期红（它们的 setup 都要先进 behavioral 层）。
  // 契约对齐 `src/host/routes/analysisRoutes.ts registerDependenciesRoute`：
  // 返回 `{ nodes, edges, metadata }`，metadata.repoId 必须与请求方工作区同源
  // （`isForeignRepo` 会丢弃 repoId 不匹配的载荷）。桩用 MOCK_GRAPH 的 module 节点
  // 组装一棵假的依赖树（node_modules/<label>），保证「节点数 > 0」这个分支走到。
  if (path === '/api/v1/codegraph/dependencies' && method === 'GET') {
    const moduleNodes = MOCK_GRAPH.nodes.filter((n) => n.type === 'module');
    const nodes = moduleNodes.map((n, i) => ({
      id: `dep:${n.id}`,
      label: n.label,
      type: 'module',
      filePath: `node_modules/${n.label}`,
      lineNumber: 0,
      properties: { version: '1.0.0', depType: 'npm', isExternal: true },
      layer: 'dependency',
    }));
    const first = nodes[0];
    const edges = nodes.slice(1).map((n) => ({
      id: `dep:${first.id}->${n.id}:dependency`,
      source: first.id,
      target: n.id,
      type: 'dependency',
      properties: { scope: 'dependencies' },
    }));
    sendJson(res, 200, {
      nodes,
      edges,
      metadata: {
        // isForeignRepo 按 repoId 识别外来载荷：桩必须回一个与图槽一致的 repoId。
        repoId: 'dev-stub',
        timestamp: Date.now(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    });
    return;
  }

  // --- 节点关联边：`NodeDetail` 挂载时 `loadNodeEdges` 会打这个端点。
  // 契约逐字对齐 `src/host/routes/dataRoutes.ts:413-549 registerEdgesRoute`：
  // 参数 `from` / `scope` / `cursor` / `limit`，返回 `{ edges, total, cursor, hasMore }`。
  if (path === '/api/v1/codegraph/edges' && method === 'GET') {
    const query = new URL(url, 'http://localhost').searchParams;
    const from = query.get('from') ?? '';
    const scope = query.get('scope') ?? 'file';
    const cursor = Number.parseInt(query.get('cursor') ?? '0', 10) || 0;
    const limit = Number.parseInt(query.get('limit') ?? '100', 10) || 100;
    const anchor = API_GRAPH.nodes.find((n) => n.id === from);
    const fileNodeIds = new Set(
      anchor && scope === 'file'
        ? API_GRAPH.nodes.filter((n) => n.filePath === anchor.filePath).map((n) => n.id)
        : [from],
    );
    const incident = API_GRAPH.edges.filter((e) => fileNodeIds.has(e.source) || fileNodeIds.has(e.target));
    const paged = incident.slice(cursor, cursor + limit);
    const detail = query.get('detail') === '1';
    // 请求键 = `edges:<from>:<scope>:<cursor>:<limit>:<detail>`，与 `etagKeyForEdges` 同形。
    // `detail` 决定这一页是聚合摘要还是原始边——少算这一维就会用摘要的校验值让明细请求收 304。
    conditionalJson(req, res, 'edges', `edges:${from}:${scope}:${cursor}:${limit}:${detail ? 1 : 0}`, (etag) => {
      sendJson(res, 200, {
        edges: paged,
        total: incident.length,
        cursor: cursor + paged.length,
        hasMore: cursor + paged.length < incident.length,
      }, { ETag: etag });
    });
    return;
  }

  // --- 关键词图检索：面板打开后按关键词检索子图（cycle-111 / N-5）。
  //
  // 契约逐字对齐 `src/host/routes/queryRoute.ts` 的 `buildPayload`：
  // 参数 `q` / `depth` / `tokenBudget` / `workspace`，响应必须含
  // `query` / `terms` / `seeds` / `nodes` / `edges` / `text` / `tokens` /
  // `truncated` / `reason` / `meta` —— **少一个键客户端就走降级分支**，E2E 也就失去意义。
  //
  // 刻意**不**在这里复算 token 预算与 BFS：桩的职责是"给出宿主会给出的形状"，
  // 而不是复制库算法（复制出来的第二份迟早与 `keyword-query.ts` 漂移）。
  // 因此这里只做词匹配：命中 `label` 的节点即种子，其余节点按是否与种子相邻决定入子图。
  // 截断用**固定触发条件**（tokenBudget 很小）而不是估算 token：桩要能被 E2E 稳定复现，
  // 而"这次到底截没截断"若取决于桩自己的估算，用例就会随行数变化而不可复现。
  if (path === '/api/v1/codegraph/query' && method === 'GET') {
    const query = new URL(url, 'http://localhost').searchParams;
    const q = (query.get('q') ?? '').trim();
    const depth = Number.parseInt(query.get('depth') ?? '2', 10) || 2;
    const tokenBudget = Number.parseInt(query.get('tokenBudget') ?? '800', 10) || 800;
    if (q.length === 0) {
      sendJson(res, 400, { success: false, error: 'FILEPATH_REQUIRED', message: 'filePath is required: q is required' });
      return;
    }
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    const seedNodes = API_GRAPH.nodes.filter((n) => terms.some((t) => n.label.toLowerCase().includes(t)));
    const seedIds = new Set(seedNodes.map((n) => n.id));
    // 有界 BFS（深度用请求值，桩不钳制到 3：客户端只关心"参数被正确发送"）。
    let frontier = new Set(seedIds);
    const included = new Set(seedIds);
    for (let hop = 0; hop < depth; hop++) {
      const next = new Set();
      for (const edge of API_GRAPH.edges) {
        if (frontier.has(edge.source) && !included.has(edge.target)) next.add(edge.target);
        if (frontier.has(edge.target) && !included.has(edge.source)) next.add(edge.source);
      }
      for (const id of next) included.add(id);
      frontier = next;
      if (frontier.size === 0) break;
    }
    const nodes = API_GRAPH.nodes.filter((n) => included.has(n.id));
    const edges = API_GRAPH.edges.filter((e) => included.has(e.source) && included.has(e.target));
    // 桩的截断条件：预算不足以容纳「每个节点一行」时标记截断。
    // 每行按 8 token 估（刻意与库的估算不同——桩只需要**确定性**，不需要与库同值）。
    const estimated = nodes.length * 8;
    const truncated = estimated > tokenBudget;
    const text = [
      `seeds=${[...seedIds].join(',') || '(none)'}`,
      ...nodes.map((n) => `NODE ${n.id} ${n.label}${seedIds.has(n.id) ? ' *' : ''}`),
      ...edges.map((e) => `EDGE ${e.source} -> ${e.target} (${e.type})`),
    ].join('\n');
    conditionalJson(req, res, 'query', `query:${q}:${depth}:${tokenBudget}`, (etag) => {
      sendJson(res, 200, {
        query: q,
        terms,
        seeds: seedNodes.map((n) => ({
          id: n.id,
          label: n.label,
          // 桩的得分按"是否完全等于 term"给两档，只为让面板的 score 列非空。
          score: terms.includes(n.label.toLowerCase()) ? 1000 : 100,
          matchedTerms: terms.filter((t) => n.label.toLowerCase().includes(t)),
        })),
        nodes,
        edges,
        text,
        tokens: estimated,
        truncated,
        reason: truncated ? 'truncated' : 'fits',
        meta: {
          depth,
          depthEffective: Math.min(depth, 3),
          tokenBudget,
          source: 'slot',
          revision: DEV_REVISION,
          reason: truncated ? 'truncated' : 'fits',
        },
      }, { ETag: etag });
    });
    return;
  }

  // --- SSE：保持连接并周期心跳，让 `EventSource` 不报错 ---
  if (path === '/api/v1/codegraph/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => { res.write(': ping\n\n'); }, 15000);
    req.on('close', () => clearInterval(heartbeat));
    return;
  }

  sendJson(res, 404, { error: `No dev stub for ${method} ${path}` });
}

server.listen(PORT, () => {
  console.log(`\n  DSH CodeGraph Visualizer — dev server`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});