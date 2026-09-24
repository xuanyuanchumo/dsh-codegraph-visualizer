import { describe, it, expect, vi } from 'vitest';

function makeMockNode(id: string, data: Record<string, unknown> = {}) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  return {
    id: () => id,
    data: vi.fn((key?: string, value?: unknown) => {
      if (key === undefined && value === undefined) {
        return Object.fromEntries(dataMap);
      }
      if (value !== undefined) { dataMap.set(key!, value); return undefined; }
      return dataMap.get(key!);
    }),
    removeData: vi.fn((key: string) => dataMap.delete(key)),
    style: vi.fn(),
    addClass: vi.fn((cls: string) => classes.add(cls)),
    removeClass: vi.fn((cls: string) => classes.delete(cls)),
    toggleClass: vi.fn((cls: string, on: boolean) => { if (on) classes.add(cls); else classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    nonempty: vi.fn(() => true),
    empty: vi.fn(() => false),
    length: 1,
    isNode: vi.fn(() => true),
    isEdge: vi.fn(() => false),
    position: vi.fn(() => ({ x: 0, y: 0 })),
    indegree: vi.fn(() => 0),
    outdegree: vi.fn(() => 0),
    degree: vi.fn(() => 0),
    _classes: classes,
    _dataMap: dataMap,
  };
}

function makeMockEdge(id: string, sourceId: string, targetId: string, data: Record<string, unknown> = {}, sourceNode?: any, targetNode?: any) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const src = sourceNode ?? makeMockNode(sourceId);
  const tgt = targetNode ?? makeMockNode(targetId);
  return {
    id: () => id,
    source: () => src,
    target: () => tgt,
    data: vi.fn((key?: string, value?: unknown) => {
      if (key === undefined && value === undefined) {
        return Object.fromEntries(dataMap);
      }
      if (value !== undefined) { dataMap.set(key!, value); return undefined; }
      return dataMap.get(key!);
    }),
    style: vi.fn(),
    addClass: vi.fn((cls: string) => classes.add(cls)),
    removeClass: vi.fn((cls: string) => classes.delete(cls)),
    toggleClass: vi.fn((cls: string, on: boolean) => { if (on) classes.add(cls); else classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    nonempty: vi.fn(() => true),
    empty: vi.fn(() => false),
    length: 1,
    isNode: vi.fn(() => false),
    isEdge: vi.fn(() => true),
    _classes: classes,
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const nodeMap = new Map<string, any>();
  const edgeMap = new Map<string, any>();
  for (const n of nodeList) nodeMap.set(n.id(), n);
  for (const e of edgeList) edgeMap.set(e.id(), e);

  const buildCollection = (items: any[]) => ({
    forEach: vi.fn((cb: (el: any) => void) => items.forEach(cb)),
    length: items.length,
    filter: vi.fn((pred: (el: any) => boolean) => items.filter(pred)),
    addClass: vi.fn((cls: string) => items.forEach(el => el.addClass(cls))),
    removeClass: vi.fn((cls: string) => items.forEach(el => el.removeClass(cls))),
    remove: vi.fn(() => { items.length = 0; }),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
  });

  let elementsList = [...nodeList, ...edgeList];

  const cy: any = {
    nodes: vi.fn(() => buildCollection(nodeList)),
    edges: vi.fn(() => buildCollection(edgeList)),
    elements: vi.fn(() => buildCollection(elementsList)),
    batch: vi.fn((cb: () => void) => cb()),
    getElementById: vi.fn((id: string) => {
      const node = nodeMap.get(id);
      if (node) return node;
      const edge = edgeMap.get(id);
      if (edge) return edge;
      return {
        nonempty: vi.fn(() => false),
        empty: vi.fn(() => true),
        length: 0,
        addClass: vi.fn(),
        removeClass: vi.fn(),
        data: vi.fn(),
        remove: vi.fn(),
      };
    }),
    add: vi.fn((spec: any) => {
      if (spec.group === 'nodes') {
        const node = makeMockNode(spec.data.id, spec.data);
        nodeMap.set(spec.data.id, node);
        nodeList.push(node);
        elementsList.push(node);
      } else if (spec.group === 'edges') {
        const srcExists = nodeMap.has(spec.data.source);
        const tgtExists = nodeMap.has(spec.data.target);
        if (srcExists && tgtExists) {
          const edge = makeMockEdge(spec.data.id, spec.data.source, spec.data.target, spec.data);
          edgeMap.set(spec.data.id, edge);
          edgeList.push(edge);
          elementsList.push(edge);
        }
      }
    }),
    remove: vi.fn((els: any) => {
      if (els && els.forEach) {
        els.forEach((el: any) => {
          nodeMap.delete(el.id());
          edgeMap.delete(el.id());
          const ni = nodeList.findIndex(n => n.id() === el.id());
          if (ni >= 0) nodeList.splice(ni, 1);
          const ei = edgeList.findIndex(e => e.id() === el.id());
          if (ei >= 0) edgeList.splice(ei, 1);
        });
      } else if (els && els.id) {
        nodeMap.delete(els.id());
        edgeMap.delete(els.id());
      }
    }),
    json: vi.fn(() => ({ nodes: [], edges: [] })),
    png: vi.fn(() => 'data:image/png;base64,mock'),
    _nodeMap: nodeMap,
    _edgeMap: edgeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };
  return cy;
}

describe('SearchController', () => {
  it('search with matching query returns > 0', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'myFunc' });
    const rawToVisibleMap = new Map<string, string>();
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('myFunc');
    expect(matches).toBeGreaterThan(0);
  });

  it('search with empty query returns 0 and clears search-match', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'myFunc' });
    const rawToVisibleMap = new Map<string, string>();
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    sc.search('myFunc');
    const result = sc.search('');
    expect(result).toBe(0);
  });

  it('search with no matches returns 0', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    const rawToVisibleMap = new Map<string, string>();
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    expect(sc.search('xyz')).toBe(0);
  });

  it('simple prefix query uses Trie index for fast lookup', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'getUserById' });
    rawNodesMap.set('b', { id: 'b', label: 'getUserByName' });
    rawNodesMap.set('c', { id: 'c', label: 'setUserName' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    rawToVisibleMap.set('c', 'c');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('getUser');
    expect(matches).toBe(2);
  });

  it('complex query with quotes falls back to full scan', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'myFunc' });
    rawNodesMap.set('b', { id: 'b', label: 'myOtherFunc' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('"myFunc"');
    expect(matches).toBe(1);
  });

  it('query with + operator requires both terms', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'getUserById' });
    rawNodesMap.set('b', { id: 'b', label: 'getUser' });
    rawNodesMap.set('c', { id: 'c', label: 'ById' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    rawToVisibleMap.set('c', 'c');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('getUser +ById');
    expect(matches).toBe(1);
  });

  it('query with space uses OR semantics for optional terms', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    rawNodesMap.set('b', { id: 'b', label: 'bar' });
    rawNodesMap.set('c', { id: 'c', label: 'baz' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    rawToVisibleMap.set('c', 'c');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('foo bar');
    expect(matches).toBe(2);
  });

  it('mapToVisible maps raw node to visible cy node', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const visibleNode = makeMockNode('vis-a', { label: 'myFunc' });
    const cy = makeMockCy([visibleNode], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('raw-a', { id: 'raw-a', label: 'myFunc' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('raw-a', 'vis-a');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('myFunc');
    expect(matches).toBe(1);
  });

  it('mapToVisible traverses parentId chain when visible node not found', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const parentNode = makeMockNode('parent-vis', { label: 'module' });
    const cy = makeMockCy([parentNode], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('raw-func', { id: 'raw-func', label: 'myFunc', parentId: 'raw-module' });
    rawNodesMap.set('raw-module', { id: 'raw-module', label: 'module', parentId: 'raw-root' });
    rawNodesMap.set('raw-root', { id: 'raw-root', label: 'root' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('raw-root', 'parent-vis');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('myFunc');
    expect(matches).toBe(1);
  });

  it('mapToVisible handles missing parentId gracefully', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'orphan' });
    const rawToVisibleMap = new Map<string, string>();
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('orphan');
    expect(matches).toBe(1);
  });

  it('fallback to cy nodes when rawNodesMap has no matches', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const node = makeMockNode('cy-1', { label: 'cyFunc' });
    const cy = makeMockCy([node], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    const rawToVisibleMap = new Map<string, string>();
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('cyFunc');
    expect(matches).toBe(1);
  });

  it('search toggles search-match class on matched nodes', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const nodeA = makeMockNode('a', { label: 'foo' });
    const nodeB = makeMockNode('b', { label: 'bar' });
    const cy = makeMockCy([nodeA, nodeB], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    rawNodesMap.set('b', { id: 'b', label: 'bar' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    sc.search('foo');
    expect(nodeA.toggleClass).toHaveBeenCalledWith('search-match', true);
    expect(nodeB.toggleClass).toHaveBeenCalledWith('search-match', false);
  });

  it('rebuildIndex resets and rebuilds Trie', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'oldFunc' });
    rawNodesMap.set('b', { id: 'b', label: 'oldOther' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    sc.search('oldFunc');
    rawNodesMap.set('a', { id: 'a', label: 'newFunc' });
    rawNodesMap.set('b', { id: 'b', label: 'newOther' });
    sc.rebuildIndex();
    const matches = sc.search('new');
    expect(matches).toBe(2);
  });

  it('destroy clears search-match class and resets Trie', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const nodeA = makeMockNode('a', { label: 'foo' });
    const cy = makeMockCy([nodeA], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    sc.search('foo');
    sc.destroy();
    expect(nodeA.removeClass).toHaveBeenCalledWith('search-match');
    const matches = sc.search('foo');
    expect(matches).toBeGreaterThan(0);
  });

  it('multiple searches reuse Trie index without rebuild', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'getUser' });
    rawNodesMap.set('b', { id: 'b', label: 'setUser' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const m1 = sc.search('getUser');
    const m2 = sc.search('setUser');
    expect(m1).toBe(1);
    expect(m2).toBe(1);
  });

  it('case-insensitive matching via Trie', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'MyFunction' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('myfunction');
    expect(matches).toBe(1);
  });

  it('search with whitespace-only query matches all (empty terms)', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    rawNodesMap.set('b', { id: 'b', label: 'bar' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('   ');
    expect(matches).toBe(2);
  });

  it('isSimplePrefixQuery: query with space is not simple', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo bar' });
    rawNodesMap.set('b', { id: 'b', label: 'foo' });
    rawNodesMap.set('c', { id: 'c', label: 'bar' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    rawToVisibleMap.set('c', 'c');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('foo bar');
    expect(matches).toBe(3);
  });

  it('Trie prefix search returns empty for no matches, falls back to full scan', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('xyz');
    expect(matches).toBe(0);
  });

  it('mapToVisible: rawToVisibleMap points to non-existent cy node, traverses parentId', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const grandParent = makeMockNode('gp-vis', { label: 'root' });
    const cy = makeMockCy([grandParent], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('r-fn', { id: 'r-fn', label: 'deepFunc', parentId: 'r-mod' });
    rawNodesMap.set('r-mod', { id: 'r-mod', label: 'module', parentId: 'r-gp' });
    rawNodesMap.set('r-gp', { id: 'r-gp', label: 'root' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('r-fn', 'missing-vis');
    rawToVisibleMap.set('r-gp', 'gp-vis');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('deepFunc');
    expect(matches).toBe(1);
  });

  it('search matches multiple raw nodes with same prefix', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'testFuncA' });
    rawNodesMap.set('b', { id: 'b', label: 'testFuncB' });
    rawNodesMap.set('c', { id: 'c', label: 'testFuncC' });
    rawNodesMap.set('d', { id: 'd', label: 'otherFunc' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    rawToVisibleMap.set('c', 'c');
    rawToVisibleMap.set('d', 'd');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('testFunc');
    expect(matches).toBe(3);
  });

  it('exact phrase search with quotes matches only exact label', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo bar' });
    rawNodesMap.set('b', { id: 'b', label: 'foo' });
    rawNodesMap.set('c', { id: 'c', label: 'bar' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    rawToVisibleMap.set('b', 'b');
    rawToVisibleMap.set('c', 'c');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    const matches = sc.search('"foo bar"');
    expect(matches).toBe(1);
  });

  it('cy batch is called during search to toggle classes', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const nodeA = makeMockNode('a', { label: 'foo' });
    const cy = makeMockCy([nodeA], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    sc.search('foo');
    expect(cy.batch).toHaveBeenCalled();
  });

  it('search after destroy rebuilds Trie on next search', async () => {
    const { SearchController } = await import('../../src/client/renderer/SearchController.ts');
    const cy = makeMockCy([], []);
    const rawNodesMap = new Map<string, { id: string; label: string; parentId?: string }>();
    rawNodesMap.set('a', { id: 'a', label: 'foo' });
    const rawToVisibleMap = new Map<string, string>();
    rawToVisibleMap.set('a', 'a');
    const sc = new SearchController(cy as any, rawNodesMap, rawToVisibleMap);
    sc.search('foo');
    sc.destroy();
    const matches = sc.search('foo');
    expect(matches).toBe(1);
  });
});
