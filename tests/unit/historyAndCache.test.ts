import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryManager, type HistorySnapshot } from '../../src/client/history/HistoryManager.ts';
import { GraphCache } from '../../src/client/cache/GraphCache.ts';
import { makeNode, makeEdge } from '../helpers.ts';

function makeSnapshot(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    layout: 'cose',
    filterType: 'all',
    graphType: 'all',
    clusterDepth: 1,
    selectedNodeId: null,
    expandedNodeIds: new Set<string>(),
    viewMode: 'code',
    ...overrides,
  };
}

describe('HistoryManager (FR-31)', () => {
  let manager: HistoryManager;

  beforeEach(() => {
    manager = new HistoryManager();
  });

  it('should initialize with empty stacks', () => {
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });

  it('should push snapshot and enable undo', () => {
    manager.push(makeSnapshot());
    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);
  });

  it('should undo and return previous snapshot', () => {
    const s1 = makeSnapshot({ layout: 'cose' });
    const s2 = makeSnapshot({ layout: 'dagre' });
    manager.push(s1);
    manager.push(s2);
    const result = manager.undo();
    expect(result).toEqual(s1);
    expect(manager.canRedo()).toBe(true);
  });

  it('should redo and return next snapshot', () => {
    const s1 = makeSnapshot({ layout: 'cose' });
    const s2 = makeSnapshot({ layout: 'dagre' });
    manager.push(s1);
    manager.push(s2);
    manager.undo();
    const result = manager.redo();
    expect(result).toEqual(s2);
  });

  it('should clear redo stack on new push after undo', () => {
    const s1 = makeSnapshot({ layout: 'cose' });
    const s2 = makeSnapshot({ layout: 'dagre' });
    const s3 = makeSnapshot({ layout: 'circle' });
    manager.push(s1);
    manager.push(s2);
    manager.undo();
    manager.push(s3);
    expect(manager.canRedo()).toBe(false);
  });

  it('should return null when no undo available', () => {
    const result = manager.undo();
    expect(result).toBeNull();
  });

  it('should return null when no redo available', () => {
    const result = manager.redo();
    expect(result).toBeNull();
  });

  it('should respect maxHistory limit', () => {
    for (let i = 0; i < 60; i++) {
      manager.push(makeSnapshot());
    }
    let undoCount = 0;
    while (manager.canUndo()) {
      manager.undo();
      undoCount++;
    }
    expect(undoCount).toBeLessThanOrEqual(50);
  });

  it('should clear history', () => {
    manager.push(makeSnapshot());
    manager.clear();
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });

  it('should getCurrent return latest snapshot', () => {
    const s1 = makeSnapshot({ layout: 'cose' });
    const s2 = makeSnapshot({ layout: 'dagre' });
    manager.push(s1);
    manager.push(s2);
    expect(manager.getCurrent()).toEqual(s2);
  });

  it('should getCurrent return null when empty', () => {
    expect(manager.getCurrent()).toBeNull();
  });

  it('should preserve expandedNodeIds in snapshot', () => {
    const snapshot = makeSnapshot({ expandedNodeIds: new Set(['n1', 'n2']) });
    manager.push(snapshot);
    const result = manager.undo();
    expect(result).toBeNull();
    manager.push(makeSnapshot());
    manager.push(snapshot);
    const undoResult = manager.undo();
    expect(undoResult).toEqual(makeSnapshot());
    expect(manager.canRedo()).toBe(true);
    const redoResult = manager.redo();
    expect(redoResult?.expandedNodeIds).toEqual(new Set(['n1', 'n2']));
  });
});

describe('GraphCache (FR-53)', () => {
  let cache: GraphCache;

  beforeEach(() => {
    cache = new GraphCache();
  });

  it('should cache and retrieve graph data', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    cache.set('repo-1', nodes, edges);
    const entry = cache.get('repo-1');
    expect(entry).not.toBeNull();
    expect(entry!.nodes).toEqual(nodes);
    expect(entry!.edges).toEqual(edges);
  });

  it('should return null for non-existent cache entry', () => {
    expect(cache.get('non-existent')).toBeNull();
  });

  it('should check if cache has entry', () => {
    cache.set('repo-1', [], []);
    expect(cache.has('repo-1')).toBe(true);
    expect(cache.has('repo-2')).toBe(false);
  });

  it('should evict oldest entry when maxEntries exceeded', () => {
    for (let i = 0; i < 6; i++) {
      cache.set(`repo-${i}`, [], []);
    }
    expect(cache.has('repo-0')).toBe(false);
    expect(cache.has('repo-5')).toBe(true);
    expect(cache.size()).toBe(5);
  });

  it('should cache and retrieve layout positions', () => {
    const positions = new Map([['n1', { x: 100, y: 200 }]]);
    cache.set('repo-1', [], []);
    cache.setLayoutPositions('repo-1', positions, 'cose');
    const cached = cache.getLayoutPositions('repo-1');
    expect(cached).not.toBeNull();
    expect(cached!.get('n1')).toEqual({ x: 100, y: 200 });
  });

  it('should return null for layout positions of non-existent entry', () => {
    expect(cache.getLayoutPositions('non-existent')).toBeNull();
  });

  it('should clear all cache entries', () => {
    cache.set('repo-1', [], []);
    cache.set('repo-2', [], []);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});