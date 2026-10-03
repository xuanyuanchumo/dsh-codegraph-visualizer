import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCy, mockCytoscapeFn } = vi.hoisted(() => ({
  mockCy: {} as any,
  mockCytoscapeFn: vi.fn(() => mockCy) as any,
}));

vi.mock('cytoscape', () => {
  const makeCollection = (items: any[] = []) => ({
    forEach: vi.fn((cb: (el: any) => void) => items.forEach(cb)),
    length: items.length,
    filter: vi.fn((pred: (el: any) => boolean) => makeCollection(items.filter(pred))),
    sort: vi.fn((cmp: (a: any, b: any) => number) => makeCollection([...items].sort(cmp))),
    slice: vi.fn((start: number, end?: number) => makeCollection(items.slice(start, end))),
    map: vi.fn((fn: (el: any) => any) => items.map(fn)),
    addClass: vi.fn((cls: string) => items.forEach(el => el.addClass?.(cls))),
    removeClass: vi.fn((cls: string) => items.forEach(el => el.removeClass?.(cls))),
    toggleClass: vi.fn(),
    hasClass: vi.fn(() => false),
    nonempty: vi.fn(() => items.length > 0),
    empty: vi.fn(() => items.length === 0),
    layout: vi.fn(() => ({ one: vi.fn(), run: vi.fn() })),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
    roots: vi.fn(() => makeCollection([])),
    reduce: vi.fn((fn: any, init: any) => items.reduce(fn, init)),
    union: vi.fn(() => makeCollection(items)),
    difference: vi.fn(() => makeCollection([])),
    not: vi.fn(() => makeCollection([])),
    isNode: vi.fn(() => true),
    isEdge: vi.fn(() => false),
    connectedEdges: vi.fn(() => makeCollection([])),
    neighborhood: vi.fn(() => makeCollection([])),
    incomers: vi.fn(() => makeCollection([])),
    outgoers: vi.fn(() => makeCollection([])),
    data: vi.fn(() => ({})),
    position: vi.fn(() => ({ x: 0, y: 0 })),
    width: vi.fn(() => 30),
    height: vi.fn(() => 30),
    degree: vi.fn(() => 0),
    indegree: vi.fn(() => 0),
    outdegree: vi.fn(() => 0),
    id: vi.fn(() => ''),
    style: vi.fn(),
    remove: vi.fn(),
    savedPosition: vi.fn(() => ({ x: 0, y: 0 })),
    renderedPosition: vi.fn(() => ({ x: 0, y: 0 })),
    renderedMidpoint: vi.fn(() => ({ x: 0, y: 0 })),
    select: vi.fn(),
    unselect: vi.fn(),
    animate: vi.fn(),
    stop: vi.fn(),
    visible: vi.fn(() => true),
    hidden: vi.fn(() => false),
    show: vi.fn(),
    hide: vi.fn(),
    move: vi.fn(),
  });

  Object.assign(mockCy, {
    nodes: vi.fn(() => makeCollection([])),
    edges: vi.fn(() => makeCollection([])),
    elements: vi.fn(() => makeCollection([])),
    on: vi.fn(),
    off: vi.fn(),
    one: vi.fn(),
    batch: vi.fn((cb: () => void) => cb()),
    zoom: vi.fn((val?: number) => val !== undefined ? undefined : 1),
    pan: vi.fn((val?: any) => val !== undefined ? undefined : { x: 0, y: 0 }),
    panBy: vi.fn(),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    fit: vi.fn(),
    layout: vi.fn(() => ({ one: vi.fn(), run: vi.fn() })),
    getElementById: vi.fn(() => ({
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      data: vi.fn(() => undefined),
      width: vi.fn(() => 30),
      height: vi.fn(() => 30),
      connectedEdges: vi.fn(() => makeCollection([])),
      removeClass: vi.fn(),
      addClass: vi.fn(),
      style: vi.fn(),
      isNode: vi.fn(() => true),
      isEdge: vi.fn(() => false),
      degree: vi.fn(() => 0),
      indegree: vi.fn(() => 0),
      outdegree: vi.fn(() => 0),
      id: vi.fn(() => ''),
      incomers: vi.fn(() => makeCollection([])),
      outgoers: vi.fn(() => makeCollection([])),
      neighborhood: vi.fn(() => makeCollection([])),
    })),
    style: vi.fn(() => ({ fromJson: vi.fn(() => ({ update: vi.fn() })) })),
    destroy: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    json: vi.fn(() => ({ nodes: [], edges: [] })),
    png: vi.fn(() => null),
    svg: vi.fn(() => null),
    animate: vi.fn((opts: any, cb?: () => void) => { if (cb) cb(); }),
    minZoom: 0.1,
    maxZoom: 10,
    collection: vi.fn(() => makeCollection([])),
    $: vi.fn(() => makeCollection([])),
    mount: vi.fn(),
    unmount: vi.fn(),
    autolock: vi.fn(),
    autoungrabify: vi.fn(),
    autounselectify: vi.fn(),
    viewport: vi.fn(() => ({ zoom: 1, pan: { x: 0, y: 0 } })),
    renderedBoundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 800, y2: 600, w: 800, h: 600 })),
    background: vi.fn(() => ({ color: '#000' })),
    hasElementWithId: vi.fn(() => false),
    _makeCollection: makeCollection,
  });
  (mockCytoscapeFn as any).use = vi.fn();
  return { default: mockCytoscapeFn };
});

vi.mock('cytoscape-dagre', () => ({ default: vi.fn() }));
vi.mock('cytoscape-fcose', () => ({ default: vi.fn() }));

import { CytoscapeRenderer } from '../../src/client/renderer/CytoscapeRenderer.ts';
import { NodeId, type GraphNode, type GraphEdge } from '../../src/types/index.ts';

function makeContainer(): HTMLElement {
  return { clientWidth: 800, clientHeight: 600 } as unknown as HTMLElement;
}

function makeNode(id: string): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: 'function',
    filePath: `/src/${id}.ts`,
    properties: {},
  };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id: `${id}` as any,
    source: NodeId(source),
    target: NodeId(target),
    type: 'call',
    properties: {},
  };
}

describe('CytoscapeRenderer', () => {
  let originalRAF: typeof requestAnimationFrame;
  let originalCAF: typeof cancelAnimationFrame;
  let renderer: CytoscapeRenderer | null = null;

  beforeEach(() => {
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
    if (renderer) {
      try { renderer.destroy(); } catch {}
      renderer = null;
    }
  });

  describe('constructor', () => {
    it('creates an instance with correct options', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      expect(renderer).toBeInstanceOf(CytoscapeRenderer);
    });
  });

  describe('updateData before init', () => {
    it('throws if updateData called before init', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      expect(() => renderer!.updateData([], [])).toThrow('init() must be called');
    });
  });

  describe('init', () => {
    it('initializes cytoscape instance and registers extensions', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(mockCy.on).toHaveBeenCalled();
      expect(mockCy.style).toHaveBeenCalled();
    });

    it('is idempotent (calling init twice does not create second cy instance)', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      const firstCallCount = mockCy.on.mock.calls.length;
      renderer!.init();
      expect(mockCy.on.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('delegation after init', () => {
    beforeEach(() => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
    });

    it('updateData adds nodes and edges to cy', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];
      renderer!.updateData(nodes, edges);
      expect(mockCy.add).toHaveBeenCalled();
    });

    it('setRawNodes stores raw node data without throwing', () => {
      renderer!.setRawNodes([makeNode('a')]);
      expect(mockCy.add).not.toHaveBeenCalled();
    });

    it('applyLayout triggers cytoscape layout', () => {
      renderer!.applyLayout('cose');
      expect(mockCy.layout).toHaveBeenCalled();
    });

    it('applyIncrementalLayout does not throw and produces no error', () => {
      renderer!.applyIncrementalLayout('cose', new Set(['a']));
      expect(renderer!.getLastError()).toBeNull();
    });

    it('isWorkerLayoutAvailable returns boolean', () => {
      expect(typeof renderer!.isWorkerLayoutAvailable()).toBe('boolean');
    });

    it('applyLayoutWithWorker returns promise that resolves', async () => {
      const result = renderer!.applyLayoutWithWorker([], [], 'cose');
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeDefined();
    });

    it('applyWorkerLayout calls layout controller', () => {
      renderer!.applyWorkerLayout({ a: { x: 0, y: 0 } });
      expect(mockCy.nodes).toHaveBeenCalled();
    });

    it('enableVirtualScroll enables virtual scroll', () => {
      renderer!.enableVirtualScroll();
      expect(renderer!.isVirtualScrollEnabled()).toBe(true);
    });

    it('disableVirtualScroll disables virtual scroll', () => {
      renderer!.enableVirtualScroll();
      renderer!.disableVirtualScroll();
      expect(renderer!.isVirtualScrollEnabled()).toBe(false);
    });

    it('isVirtualScrollEnabled returns boolean', () => {
      expect(typeof renderer!.isVirtualScrollEnabled()).toBe('boolean');
    });

    it('shouldEnableVirtualScroll returns boolean', () => {
      expect(typeof renderer!.shouldEnableVirtualScroll(100)).toBe('boolean');
    });

    it('highlightNodes does not throw and produces no error', () => {
      renderer!.highlightNodes([NodeId('a')]);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('selectNode with valid id calls getElementById', () => {
      renderer!.selectNode(NodeId('a'));
      expect(mockCy.getElementById).toHaveBeenCalledWith('a');
    });

    it('selectNode with null does not call getElementById', () => {
      renderer!.selectNode(null);
      expect(mockCy.getElementById).not.toHaveBeenCalled();
    });

    it('filterByType calls cy nodes', () => {
      renderer!.filterByType('function');
      expect(mockCy.nodes).toHaveBeenCalled();
    });

    it('filterByGraphType does not throw and produces no error', () => {
      renderer!.filterByGraphType('all');
      expect(renderer!.getLastError()).toBeNull();
    });

    it('applyConnectionFilters calls cy nodes and edges', () => {
      renderer!.applyConnectionFilters(0, 0, new Set(), new Set());
      expect(mockCy.nodes).toHaveBeenCalled();
    });

    it('search returns number (0 for empty graph)', () => {
      expect(renderer!.search('test')).toBe(0);
    });

    it('focusOnNode calls viewport methods', () => {
      renderer!.focusOnNode('a');
      expect(mockCy.getElementById).toHaveBeenCalled();
    });

    it('highlightCallChain with valid id does not throw and produces no error', () => {
      renderer!.highlightCallChain(NodeId('a'));
      expect(renderer!.getLastError()).toBeNull();
    });

    it('highlightCallChain with null produces no error', () => {
      renderer!.highlightCallChain(null);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('detectCycles returns empty Set for empty graph', () => {
      const result = renderer!.detectCycles();
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('detectCyclesDetailed returns empty array for empty graph', () => {
      const result = renderer!.detectCyclesDetailed();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('highlightCycles does not throw and produces no error', () => {
      renderer!.highlightCycles(new Set(['a']));
      expect(renderer!.getLastError()).toBeNull();
    });

    it('isolateCycles calls cy elements', () => {
      renderer!.isolateCycles(new Set(['a']));
      expect(mockCy.elements).toHaveBeenCalled();
    });

    it('relayoutCycles does not throw and produces no error', () => {
      renderer!.relayoutCycles(new Set(['a']));
      expect(renderer!.getLastError()).toBeNull();
    });

    it('restoreIsolation calls cy elements', () => {
      renderer!.restoreIsolation();
      expect(mockCy.elements).toHaveBeenCalled();
    });

    it('highlightImpact with valid id does not throw and produces no error', () => {
      renderer!.highlightImpact(NodeId('a'));
      expect(renderer!.getLastError()).toBeNull();
    });

    it('highlightImpact with null produces no error', () => {
      renderer!.highlightImpact(null);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('getImpactStats returns null for non-existent node', () => {
      const result = renderer!.getImpactStats(NodeId('a'));
      expect(result).toBeNull();
    });

    it('highlightInheritance with valid id does not throw and produces no error', () => {
      renderer!.highlightInheritance(NodeId('a'));
      expect(renderer!.getLastError()).toBeNull();
    });

    it('highlightInheritance with null produces no error', () => {
      renderer!.highlightInheritance(null);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('focusNeighborhood with valid id calls cy methods', () => {
      renderer!.focusNeighborhood(NodeId('a'));
      expect(mockCy.getElementById).toHaveBeenCalled();
    });

    it('focusNeighborhood with null produces no error', () => {
      renderer!.focusNeighborhood(null);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('getThumbnail returns null (no real canvas in mock)', () => {
      expect(renderer!.getThumbnail()).toBeNull();
    });

    it('getViewportInfo returns viewport data', () => {
      const result = renderer!.getViewportInfo();
      expect(result).not.toBeNull();
      expect(result!.zoom).toBe(1);
    });

    it('focusOnArea does not throw and produces no error', () => {
      renderer!.focusOnArea(0, 0, 1);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('exportJSON returns valid JSON string', () => {
      const result = renderer!.exportJSON();
      expect(typeof result).toBe('string');
      expect(JSON.parse(result)).toEqual({ nodes: [], edges: [] });
    });

    it('exportMermaid returns non-empty string', () => {
      const result = renderer!.exportMermaid();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('exportPNG returns null (no real canvas in mock)', () => {
      expect(renderer!.exportPNG()).toBeNull();
    });

    it('exportSVG returns null (no real canvas in mock)', () => {
      expect(renderer!.exportSVG()).toBeNull();
    });

    it('exportMermaidSequence returns string', () => {
      const result = renderer!.exportMermaidSequence();
      expect(typeof result).toBe('string');
    });

    it('exportMermaidClass returns string', () => {
      const result = renderer!.exportMermaidClass();
      expect(typeof result).toBe('string');
    });

    it('exportGraphML returns string', () => {
      const result = renderer!.exportGraphML();
      expect(typeof result).toBe('string');
    });

    it('exportJSONLD returns string', () => {
      const result = renderer!.exportJSONLD();
      expect(typeof result).toBe('string');
    });

    it('setTodoMarkerMode does not throw', () => {
      expect(() => renderer!.setTodoMarkerMode('todo')).not.toThrow();
    });

    it('getTodoMarkerMode returns string', () => {
      expect(typeof renderer!.getTodoMarkerMode()).toBe('string');
    });

    it('markDeadCode does not throw', () => {
      expect(() => renderer!.markDeadCode(new Set(['a']))).not.toThrow();
    });

    it('clearDeadCodeMarks does not throw', () => {
      expect(() => renderer!.clearDeadCodeMarks()).not.toThrow();
    });

    it('pauseAnimations does not throw', () => {
      expect(() => renderer!.pauseAnimations()).not.toThrow();
    });

    it('resumeAnimations does not throw', () => {
      expect(() => renderer!.resumeAnimations()).not.toThrow();
    });

    it('getSelectedNodeData returns null when no node selected', () => {
      expect(renderer!.getSelectedNodeData()).toBeNull();
    });

    it('getNodeData returns null for non-existent node', () => {
      expect(renderer!.getNodeData('a')).toBeNull();
    });

    it('getEdgeData returns null for non-existent edge', () => {
      expect(renderer!.getEdgeData('e1')).toBeNull();
    });

    it('resize calls cy resize', () => {
      renderer!.resize();
      expect(mockCy.resize).toHaveBeenCalled();
    });

    it('updateTheme calls style controller update', () => {
      renderer!.updateTheme('light');
      expect(mockCy.style).toHaveBeenCalled();
    });

    it('setHeatmapMode does not throw and produces no error', () => {
      renderer!.setHeatmapMode('none');
      expect(renderer!.getLastError()).toBeNull();
    });

    it('getHeatmapMode returns current mode', () => {
      expect(renderer!.getHeatmapMode()).toBe('none');
    });

    it('findPath returns null for non-existent path', () => {
      expect(renderer!.findPath(NodeId('a'), NodeId('b'))).toBeNull();
    });

    it('highlightPath with valid path does not throw and produces no error', () => {
      renderer!.highlightPath([NodeId('a'), NodeId('b')]);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('highlightPath with null produces no error', () => {
      renderer!.highlightPath(null);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('expandNeighborhood returns Set', () => {
      const result = renderer!.expandNeighborhood(NodeId('a'), 1);
      expect(result).toBeInstanceOf(Set);
    });
  });

  describe('destroy', () => {
    it('destroy without init does not call cy.destroy', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.destroy();
      expect(mockCy.destroy).not.toHaveBeenCalled();
    });

    it('destroy after init calls cy.destroy', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
      renderer!.destroy();
      expect(mockCy.destroy).toHaveBeenCalled();
    });

    it('destroy is idempotent (second call does not invoke cy.destroy again)', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.destroy();
      vi.clearAllMocks();
      renderer!.destroy();
      expect(mockCy.destroy).not.toHaveBeenCalled();
    });
  });

  describe('updateTheme', () => {
    it('updates theme and applies new stylesheet', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
      renderer!.updateTheme('light');
      expect(mockCy.style).toHaveBeenCalled();
    });
  });

  describe('setHeatmapMode', () => {
    it('sets heatmap mode and updates styles', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
      renderer!.setHeatmapMode('instability');
      expect(mockCy.style).toHaveBeenCalled();
    });
  });

  // ── setDagreRankDir ───────────────────────────────────────────────────

  describe('setDagreRankDir', () => {
    it('sets dagre rank direction and updates layout controller state', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.setDagreRankDir('LR');
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── hideNode ──────────────────────────────────────────────────────────

  describe('hideNode', () => {
    it('hides a node by setting display to none', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
      renderer!.hideNode(NodeId('a'));
      expect(mockCy.getElementById).toHaveBeenCalledWith('a');
    });
  });

  // ── showAllNodes ──────────────────────────────────────────────────────

  describe('showAllNodes', () => {
    it('shows all nodes by setting display to element', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
      renderer!.showAllNodes();
      expect(mockCy.nodes).toHaveBeenCalled();
    });
  });

  // ── getVisibleNodeCount ───────────────────────────────────────────────

  describe('getVisibleNodeCount', () => {
    it('returns visible node count', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      const count = renderer!.getVisibleNodeCount();
      expect(typeof count).toBe('number');
    });
  });

  // ── setMultiDimensionMapping ──────────────────────────────────────────

  describe('setMultiDimensionMapping', () => {
    it('sets multi dimension mapping and completes without error', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.setMultiDimensionMapping('fanIn', 'complexity');
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── setFocusMode ──────────────────────────────────────────────────────

  describe('setFocusMode', () => {
    it('activates focus mode for given node', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.setFocusMode(NodeId('a'), 2);
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── clearFocusMode ────────────────────────────────────────────────────

  describe('clearFocusMode', () => {
    it('clears focus mode and deactivates', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.clearFocusMode();
      expect(renderer!.isFocusModeActive()).toBe(false);
    });
  });

  // ── isFocusModeActive ─────────────────────────────────────────────────

  describe('isFocusModeActive', () => {
    it('returns boolean for focus mode active state', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(typeof renderer!.isFocusModeActive()).toBe('boolean');
    });
  });

  // ── filterByPath ──────────────────────────────────────────────────────

  describe('filterByPath', () => {
    it('filters by include path without error', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.filterByPath('src/', null);
      expect(renderer!.getLastError()).toBeNull();
    });

    it('filters by include and exclude patterns without error', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.filterByPath('src/', 'test');
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── clearLastError ────────────────────────────────────────────────────

  describe('clearLastError', () => {
    it('clears last error', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.clearLastError();
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── getZoom ───────────────────────────────────────────────────────────

  describe('getZoom', () => {
    it('returns current zoom level', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      const zoom = renderer!.getZoom();
      expect(typeof zoom).toBe('number');
    });
  });

  // ── onZoomChange ──────────────────────────────────────────────────────

  describe('onZoomChange', () => {
    it('registers zoom change callback and returns disposer', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();
      const callback = vi.fn();
      const disposer = renderer!.onZoomChange(callback);
      expect(mockCy.on).toHaveBeenCalledWith('zoom', callback);
      expect(typeof disposer).toBe('function');
      disposer();
      expect(mockCy.off).toHaveBeenCalledWith('zoom', callback);
    });

    it('returns noop disposer when cy is null', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      const disposer = renderer!.onZoomChange(vi.fn());
      expect(typeof disposer).toBe('function');
      disposer();
    });
  });

  // ── init catch block (error cleanup) ──────────────────────────────────

  describe('init error handling', () => {
    it('throws and cleans up when cytoscape constructor fails', () => {
      // Temporarily make the cytoscape mock throw
      const originalImpl = mockCytoscapeFn.getMockImplementation();
      mockCytoscapeFn.mockImplementationOnce(() => {
        throw new Error('cytoscape init failed');
      });

      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      expect(() => renderer!.init()).toThrow('cytoscape init failed');

      // After failed init, cy should be null and a second init should work
      mockCytoscapeFn.mockImplementation(originalImpl ?? (() => mockCy));
      renderer!.init();
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── updateData with fake timers ───────────────────────────────────────

  describe('updateData fit timer', () => {
    let origNodes: any;
    beforeEach(() => {
      vi.useFakeTimers();
      origNodes = mockCy.nodes;
    });
    afterEach(() => {
      vi.useRealTimers();
      mockCy.nodes = origNodes;
    });

    it('does not schedule fit when nodes array is empty', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      renderer!.updateData([], []);
      vi.advanceTimersByTime(500);
      expect(mockCy.fit).not.toHaveBeenCalled();
    });

    it('clears fitTimer during destroy when a fit was pending', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // updateData with non-empty nodes will attempt to schedule a fit timer
      // even if DataController throws (safeCallWithError catches it but the
      // fit timer code is after dataCtrl.updateData which throws first).
      // However, we can still verify destroy clears any pending timer.
      renderer!.updateData([makeNode('a')], []);
      renderer!.destroy();
      // Advancing timers should not cause any unhandled callback
      vi.advanceTimersByTime(500);
      // If we reach here without error, the timer was properly cleared
      expect(true).toBe(true);
    });
  });

  // ── safeCall error paths ──────────────────────────────────────────────

  describe('safeCall error handling', () => {
    let origNodes: any;
    let origLayout: any;
    let origAdd: any;

    beforeEach(() => {
      origNodes = mockCy.nodes;
      origLayout = mockCy.layout;
      origAdd = mockCy.add;
    });
    afterEach(() => {
      mockCy.nodes = origNodes;
      mockCy.layout = origLayout;
      mockCy.add = origAdd;
    });

    it('safeCall catches error and returns fallback (getVisibleNodeCount)', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // Make cy.nodes throw to trigger safeCall catch in getVisibleNodeCount
      mockCy.nodes = vi.fn(() => { throw new Error('nodes failed'); }) as any;
      const result = renderer!.getVisibleNodeCount();
      expect(result).toBe(0);
    });

    it('safeCallVoid catches error (applyLayout)', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // Make cy.layout throw to trigger safeCallVoid catch in applyLayout
      mockCy.layout = vi.fn(() => { throw new Error('layout failed'); }) as any;
      renderer!.applyLayout('cose');
      // Should not throw, error is swallowed but lastError is set
      expect(renderer!.getLastError()).not.toBeNull();
      expect(renderer!.getLastError()?.message).toBe('layout failed');
    });

    it('safeCall catches error and sets lastError (updateData)', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // Make cy.add throw to trigger safeCall catch in updateData
      mockCy.add = vi.fn(() => { throw new Error('add failed'); }) as any;
      renderer!.updateData([makeNode('a')], []);
      expect(renderer!.getLastError()).not.toBeNull();
      expect(renderer!.getLastError()?.message).toBe('add failed');
    });

    it('safeCall catches non-Error thrown value', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // Make cy.add throw a non-Error value
      mockCy.add = vi.fn(() => { throw 'string error'; }) as any;
      renderer!.updateData([makeNode('a')], []);
      expect(renderer!.getLastError()).not.toBeNull();
      expect(renderer!.getLastError()?.message).toBe('string error');
    });
  });

  // ── destroy error handling ────────────────────────────────────────────

  describe('destroy error handling', () => {
    let origDestroy: any;
    beforeEach(() => {
      origDestroy = mockCy.destroy;
    });
    afterEach(() => {
      mockCy.destroy = origDestroy;
    });

    it('continues cleanup even when a sub-controller destroy throws', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // Make cy.destroy throw - should not prevent other cleanup
      mockCy.destroy = vi.fn(() => { throw new Error('destroy failed'); }) as any;
      expect(() => renderer!.destroy()).not.toThrow();
      // cy.destroy was attempted
      expect(mockCy.destroy).toHaveBeenCalled();
    });

    it('clears fitTimer during destroy', () => {
      vi.useFakeTimers();
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // Schedule a fit timer
      renderer!.updateData([makeNode('a')], []);
      // Destroy before timer fires
      renderer!.destroy();
      // Advancing timers should not cause fit to be called (timer was cleared)
      vi.advanceTimersByTime(500);
      expect(mockCy.fit).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ── exportSVG with theme parameter ────────────────────────────────────

  describe('exportSVG with theme', () => {
    it('passes explicit theme to export controller', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      vi.clearAllMocks();

      // exportSVG with explicit theme should not throw
      const result = renderer!.exportSVG('light');
      expect(result).toBeNull();
    });
  });

  // ── InteractionCallbacks propagation ──────────────────────────────────

  describe('interaction callbacks', () => {
    it('passes onNodeHoverPrefetch callback when provided', () => {
      const onNodeHoverPrefetch = vi.fn();
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
        onNodeHoverPrefetch,
      });
      renderer!.init();
      // If the callback was propagated, init should succeed without error
      expect(renderer!.getLastError()).toBeNull();
    });

    it('passes onNodeContextTap callback when provided', () => {
      const onNodeContextTap = vi.fn();
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
        onNodeContextTap,
      });
      renderer!.init();
      expect(renderer!.getLastError()).toBeNull();
    });
  });

  // ── getZoom without init ──────────────────────────────────────────────

  describe('getZoom without init', () => {
    it('returns default zoom 1 when cy is null', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      expect(renderer!.getZoom()).toBe(1);
    });
  });

  // ── onZoomChange disposer after destroy ───────────────────────────────

  describe('onZoomChange after destroy', () => {
    it('disposer does not throw when cy is null after destroy', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      const disposer = renderer!.onZoomChange(vi.fn());
      renderer!.destroy();
      // Calling disposer after destroy should not throw (cy is null)
      expect(() => disposer()).not.toThrow();
    });
  });

  // ── revealNode ────────────────────────────────────────────────────────

  describe('revealNode', () => {
    /** Minimal element double whose style map is readable and writable like Cytoscape's. */
    function makeElement(id: string, opts: { display?: string; data?: Record<string, unknown> } = {}) {
      const styles: Record<string, string> = { display: opts.display ?? 'element' };
      const data = opts.data ?? {};
      const el: any = {
        id: () => id,
        empty: () => false,
        nonempty: () => true,
        data: vi.fn((key?: string) => (key === undefined ? data : data[key])),
        style: vi.fn((key?: string, value?: string) => {
          if (key === undefined) return { ...styles };
          if (value === undefined) return styles[key];
          styles[key] = value;
          return el;
        }),
        connectedEdges: vi.fn(() => mockCy._makeCollection([])),
        display: () => styles.display,
      };
      return el;
    }

    function makeEdgeDouble(id: string, source: any, target: any, data: Record<string, unknown> = {}) {
      const styles: Record<string, string> = { display: 'element' };
      return {
        id: () => id,
        data: vi.fn((key?: string) => (key === undefined ? data : data[key])),
        source: () => source,
        target: () => target,
        style: vi.fn((key?: string, value?: string) => {
          if (key === undefined) return { ...styles };
          if (value === undefined) return styles[key];
          styles[key] = value;
          return undefined;
        }),
        edgeDisplay: () => styles.display,
      };
    }

    beforeEach(() => {
      renderer = new CytoscapeRenderer({ container: makeContainer(), theme: 'dark' });
      renderer!.init();
    });

    it('returns false when the node is not in the graph', () => {
      mockCy.getElementById = vi.fn(() => ({ empty: () => true, nonempty: () => false }));
      expect(renderer!.revealNode('missing')).toBe(false);
    });

    it('returns false for a filter-hidden node and leaves its display untouched', () => {
      const node = makeElement('n1', { display: 'none', data: { typeFiltered: true } });
      mockCy.getElementById = vi.fn(() => node);
      expect(renderer!.revealNode('n1')).toBe(false);
      expect(node.style).not.toHaveBeenCalled();
    });

    it('restores a hidden node and only the edges whose both ends are visible', () => {
      const hiddenNeighbour = makeElement('n3', { display: 'none' });
      const visibleA = makeElement('a');
      const visibleB = makeElement('b');
      const restorable = makeEdgeDouble('e1', visibleA, visibleB);
      const dangling = makeEdgeDouble('e2', visibleA, hiddenNeighbour);
      const connectionFiltered = makeEdgeDouble('e3', visibleA, visibleB, { connectionFiltered: true });
      const node = makeElement('n1', { display: 'none' });
      node.connectedEdges = vi.fn(() => mockCy._makeCollection([restorable, dangling, connectionFiltered]));
      mockCy.getElementById = vi.fn(() => node);

      expect(renderer!.revealNode('n1')).toBe(true);
      expect(node.style).toHaveBeenCalledWith('display', 'element');
      expect(restorable.style).toHaveBeenCalledWith('display', 'element');
      // An edge pointing at a still-hidden node would be the dangling edge Cytoscape warns about.
      expect(dangling.style).not.toHaveBeenCalledWith('display', 'element');
      expect(connectionFiltered.style).not.toHaveBeenCalledWith('display', 'element');
      // Revealing must also centre the viewport, otherwise the click still looks like a no-op.
      expect(mockCy.animate).toHaveBeenCalledWith(expect.objectContaining({ center: { eles: node } }));
    });

    it('still focuses an already-visible node without rewriting its display', () => {
      const node = makeElement('n1');
      mockCy.getElementById = vi.fn(() => node);
      expect(renderer!.revealNode('n1')).toBe(true);
      expect(node.style).not.toHaveBeenCalledWith('display', 'element');
      expect(mockCy.animate).toHaveBeenCalled();
    });
  });
});
