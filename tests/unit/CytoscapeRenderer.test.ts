import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  const mockCy = {
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
  };
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
    it('constructs without throwing', () => {
      expect(() => new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      })).not.toThrow();
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
    it('initializes without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      expect(() => renderer!.init()).not.toThrow();
    });

    it('is idempotent (calling init twice does not throw)', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.init()).not.toThrow();
    });
  });

  describe('delegation after init', () => {
    beforeEach(() => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
    });

    it('updateData delegates without throwing', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];
      expect(() => renderer!.updateData(nodes, edges)).not.toThrow();
    });

    it('setRawNodes delegates without throwing', () => {
      expect(() => renderer!.setRawNodes([makeNode('a')])).not.toThrow();
    });

    it('applyLayout delegates without throwing', () => {
      expect(() => renderer!.applyLayout('cose')).not.toThrow();
    });

    it('applyIncrementalLayout delegates without throwing', () => {
      expect(() => renderer!.applyIncrementalLayout('cose', new Set(['a']))).not.toThrow();
    });

    it('isWorkerLayoutAvailable returns boolean', () => {
      expect(typeof renderer!.isWorkerLayoutAvailable()).toBe('boolean');
    });

    it('applyLayoutWithWorker returns promise', async () => {
      const result = renderer!.applyLayoutWithWorker([], [], 'cose');
      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    it('applyWorkerLayout does not throw', () => {
      expect(() => renderer!.applyWorkerLayout({})).not.toThrow();
    });

    it('enableVirtualScroll does not throw', () => {
      expect(() => renderer!.enableVirtualScroll()).not.toThrow();
    });

    it('disableVirtualScroll does not throw', () => {
      expect(() => renderer!.disableVirtualScroll()).not.toThrow();
    });

    it('isVirtualScrollEnabled returns boolean', () => {
      expect(typeof renderer!.isVirtualScrollEnabled()).toBe('boolean');
    });

    it('shouldEnableVirtualScroll returns boolean', () => {
      expect(typeof renderer!.shouldEnableVirtualScroll(100)).toBe('boolean');
    });

    it('highlightNodes does not throw', () => {
      expect(() => renderer!.highlightNodes([NodeId('a')])).not.toThrow();
    });

    it('selectNode does not throw', () => {
      expect(() => renderer!.selectNode(NodeId('a'))).not.toThrow();
      expect(() => renderer!.selectNode(null)).not.toThrow();
    });

    it('filterByType does not throw', () => {
      expect(() => renderer!.filterByType('function')).not.toThrow();
    });

    it('filterByGraphType does not throw', () => {
      expect(() => renderer!.filterByGraphType('all')).not.toThrow();
    });

    it('applyConnectionFilters does not throw', () => {
      expect(() => renderer!.applyConnectionFilters(0, 0, new Set(), new Set())).not.toThrow();
    });

    it('search returns number', () => {
      expect(typeof renderer!.search('test')).toBe('number');
    });

    it('focusOnNode does not throw', () => {
      expect(() => renderer!.focusOnNode('a')).not.toThrow();
    });

    it('highlightCallChain does not throw', () => {
      expect(() => renderer!.highlightCallChain(NodeId('a'))).not.toThrow();
      expect(() => renderer!.highlightCallChain(null)).not.toThrow();
    });

    it('detectCycles returns Set', () => {
      expect(renderer!.detectCycles()).toBeInstanceOf(Set);
    });

    it('detectCyclesDetailed returns array', () => {
      expect(Array.isArray(renderer!.detectCyclesDetailed())).toBe(true);
    });

    it('highlightCycles does not throw', () => {
      expect(() => renderer!.highlightCycles(new Set(['a']))).not.toThrow();
    });

    it('isolateCycles does not throw', () => {
      expect(() => renderer!.isolateCycles(new Set(['a']))).not.toThrow();
    });

    it('relayoutCycles does not throw', () => {
      expect(() => renderer!.relayoutCycles(new Set(['a']))).not.toThrow();
    });

    it('restoreIsolation does not throw', () => {
      expect(() => renderer!.restoreIsolation()).not.toThrow();
    });

    it('highlightImpact does not throw', () => {
      expect(() => renderer!.highlightImpact(NodeId('a'))).not.toThrow();
      expect(() => renderer!.highlightImpact(null)).not.toThrow();
    });

    it('getImpactStats returns null or object', () => {
      const result = renderer!.getImpactStats(NodeId('a'));
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('highlightInheritance does not throw', () => {
      expect(() => renderer!.highlightInheritance(NodeId('a'))).not.toThrow();
      expect(() => renderer!.highlightInheritance(null)).not.toThrow();
    });

    it('focusNeighborhood does not throw', () => {
      expect(() => renderer!.focusNeighborhood(NodeId('a'))).not.toThrow();
      expect(() => renderer!.focusNeighborhood(null)).not.toThrow();
    });

    it('getThumbnail returns null or string', () => {
      const result = renderer!.getThumbnail();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('getViewportInfo returns null or object', () => {
      const result = renderer!.getViewportInfo();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('focusOnArea does not throw', () => {
      expect(() => renderer!.focusOnArea(0, 0, 1)).not.toThrow();
    });

    it('exportJSON returns string', () => {
      expect(typeof renderer!.exportJSON()).toBe('string');
    });

    it('exportMermaid returns string', () => {
      expect(typeof renderer!.exportMermaid()).toBe('string');
    });

    it('exportPNG returns null or string', () => {
      const result = renderer!.exportPNG();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('exportSVG returns null or string', () => {
      const result = renderer!.exportSVG();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('getSelectedNodeData returns null or object', () => {
      const result = renderer!.getSelectedNodeData();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('getNodeData returns null or object', () => {
      const result = renderer!.getNodeData('a');
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('getEdgeData returns null or object', () => {
      const result = renderer!.getEdgeData('e1');
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('resize does not throw', () => {
      expect(() => renderer!.resize()).not.toThrow();
    });

    it('updateTheme does not throw', () => {
      expect(() => renderer!.updateTheme('light')).not.toThrow();
    });

    it('setHeatmapMode does not throw', () => {
      expect(() => renderer!.setHeatmapMode('none')).not.toThrow();
    });

    it('getHeatmapMode returns string', () => {
      expect(typeof renderer!.getHeatmapMode()).toBe('string');
    });

    it('findPath returns null or object', () => {
      const result = renderer!.findPath(NodeId('a'), NodeId('b'));
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('highlightPath does not throw', () => {
      expect(() => renderer!.highlightPath([NodeId('a'), NodeId('b')])).not.toThrow();
      expect(() => renderer!.highlightPath(null)).not.toThrow();
    });

    it('expandNeighborhood returns Set', () => {
      expect(renderer!.expandNeighborhood(NodeId('a'), 1)).toBeInstanceOf(Set);
    });
  });

  describe('destroy', () => {
    it('destroy without init does not throw', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      expect(() => renderer!.destroy()).not.toThrow();
    });

    it('destroy after init does not throw', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.destroy()).not.toThrow();
    });

    it('destroy is idempotent', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      renderer!.destroy();
      expect(() => renderer!.destroy()).not.toThrow();
    });
  });

  describe('updateTheme', () => {
    it('updates theme without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.updateTheme('light')).not.toThrow();
    });
  });

  describe('setHeatmapMode', () => {
    it('sets heatmap mode without throwing', () => {
      renderer = new CytoscapeRenderer({
        container: makeContainer(),
        theme: 'dark',
      });
      renderer!.init();
      expect(() => renderer!.setHeatmapMode('instability')).not.toThrow();
    });
  });
});
