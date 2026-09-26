import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCy } = vi.hoisted(() => ({ mockCy: {} as any }));

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
  const cytoscapeFn = vi.fn(() => mockCy);
  (cytoscapeFn as any).use = vi.fn();
  return { default: cytoscapeFn };
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
    it('sets dagre rank direction without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.setDagreRankDir('LR')).not.toThrow();
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
    it('sets multi dimension mapping without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.setMultiDimensionMapping('fanIn', 'complexity')).not.toThrow();
    });
  });

  // ── setFocusMode ──────────────────────────────────────────────────────

  describe('setFocusMode', () => {
    it('sets focus mode without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.setFocusMode(NodeId('a'), 2)).not.toThrow();
    });
  });

  // ── clearFocusMode ────────────────────────────────────────────────────

  describe('clearFocusMode', () => {
    it('clears focus mode without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.clearFocusMode()).not.toThrow();
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
    it('filters by path without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.filterByPath('src/', null)).not.toThrow();
    });

    it('filters by path with exclude pattern without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.filterByPath('src/', 'test')).not.toThrow();
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
});
