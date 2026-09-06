import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryManager, type HistorySnapshot } from '../../src/client/history/HistoryManager.ts';
import { GraphCache } from '../../src/client/cache/GraphCache.ts';
import { parsePackageJson, parseCargoToml, parseGoMod } from '../../src/adapters/DependencyAdapter.ts';
import { computeGraphDiff } from '../../src/merger/DiffEngine.ts';
import { TreeSitterAdapter } from '../../src/adapters/TreeSitterAdapter.ts';
import { McpServer } from '../../src/host/McpServer.ts';
import { makeNode, makeEdge } from '../helpers.ts';

function makeSnapshot(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    layout: 'cose',
    filterType: 'all',
    graphType: 'all',
    clusterLevel: 'file',
    selectedNodeId: null,
    expandedNodeIds: new Set<string>(),
    ...overrides,
  };
}

describe('Chaos: HistoryManager edge cases (FR-31)', () => {
  it('should handle rapid push/undo/redo without corruption', () => {
    const manager = new HistoryManager();
    for (let i = 0; i < 100; i++) {
      manager.push(makeSnapshot({ layout: i % 2 === 0 ? 'cose' : 'dagre' }));
    }
    for (let i = 0; i < 50; i++) {
      manager.undo();
    }
    for (let i = 0; i < 25; i++) {
      manager.redo();
    }
    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(true);
  });

  it('should handle undo when only one snapshot exists', () => {
    const manager = new HistoryManager();
    manager.push(makeSnapshot());
    const result = manager.undo();
    expect(result).toBeNull();
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);
  });

  it('should handle clear during active undo/redo session', () => {
    const manager = new HistoryManager();
    manager.push(makeSnapshot({ layout: 'cose' }));
    manager.push(makeSnapshot({ layout: 'dagre' }));
    manager.undo();
    manager.clear();
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
    expect(manager.getCurrent()).toBeNull();
  });
});

describe('Chaos: GraphCache LRU eviction under pressure (FR-53)', () => {
  it('should maintain exactly maxEntries under rapid insertions', () => {
    const cache = new GraphCache();
    for (let i = 0; i < 100; i++) {
      cache.set(`repo-${i}`, [], []);
    }
    expect(cache.size()).toBe(5);
    expect(cache.has('repo-99')).toBe(true);
    expect(cache.has('repo-0')).toBe(false);
  });

  it('should handle setLayoutPositions on evicted entry gracefully', () => {
    const cache = new GraphCache();
    cache.set('repo-1', [], []);
    for (let i = 2; i < 7; i++) {
      cache.set(`repo-${i}`, [], []);
    }
    expect(cache.has('repo-1')).toBe(false);
    cache.setLayoutPositions('repo-1', new Map([['n1', { x: 1, y: 2 }]]), 'cose');
    expect(cache.getLayoutPositions('repo-1')).toBeNull();
  });

  it('should preserve layout positions when updating existing entry', () => {
    const cache = new GraphCache();
    const positions = new Map([['n1', { x: 100, y: 200 }]]);
    cache.set('repo-1', [makeNode('n1', 'A', 'function', 'a.ts', 1)], [], positions, 'cose');
    cache.set('repo-1', [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'class', 'b.ts', 5)], []);
    const cached = cache.getLayoutPositions('repo-1');
    expect(cached).not.toBeNull();
    expect(cached!.get('n1')).toEqual({ x: 100, y: 200 });
  });
});

describe('Chaos: DependencyAdapter malformed inputs (FR-21)', () => {
  it('should handle package.json with circular-like references', () => {
    const content = JSON.stringify({
      name: 'a',
      dependencies: { b: '1.0' },
      devDependencies: { b: '1.0' },
      peerDependencies: { b: '1.0' },
      optionalDependencies: { b: '1.0' },
    });
    const result = parsePackageJson(content);
    const bNodes = result.nodes.filter((n) => n.name === 'b');
    expect(bNodes).toHaveLength(1);
  });

  it('should handle Cargo.toml with malformed lines', () => {
    const content = `
name = "test"
[dependencies
serde = 
invalid line
`;
    const result = parseCargoToml(content);
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle go.mod with no require block', () => {
    const content = `
module github.com/test/app

go 1.21
`;
    const result = parseGoMod(content);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.name).toBe('github.com/test/app');
  });

  it('should handle empty strings', () => {
    expect(parsePackageJson('').nodes).toHaveLength(0);
    expect(parseCargoToml('').nodes).toHaveLength(1);
    expect(parseGoMod('').nodes).toHaveLength(1);
  });
});

describe('Chaos: DiffEngine with extreme inputs (FR-24)', () => {
  it('should handle diff with 10000 nodes', () => {
    const beforeNodes: ReturnType<typeof makeNode>[] = [];
    const afterNodes: ReturnType<typeof makeNode>[] = [];
    for (let i = 0; i < 10000; i++) {
      beforeNodes.push(makeNode(`n${i}`, `Node${i}`, 'function', `f${i}.ts`, i));
      afterNodes.push(makeNode(`n${i}`, `Node${i}`, 'function', `f${i}.ts`, i));
    }
    afterNodes.push(makeNode('nNew', 'NewNode', 'class', 'new.ts', 1));
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('should handle diff where all nodes are removed', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const diff = computeGraphDiff(beforeNodes, [], [], []);
    expect(diff.removedNodes).toHaveLength(1);
    expect(diff.addedNodes).toHaveLength(0);
  });

  it('should handle diff where all nodes are added', () => {
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const diff = computeGraphDiff([], [], afterNodes, []);
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.removedNodes).toHaveLength(0);
  });
});

describe('Chaos: TreeSitterAdapter failure recovery (FR-20)', () => {
  it('should recover from init failure and still detect languages', () => {
    const adapter = new TreeSitterAdapter();
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.detectLanguage('foo.ts')).toBe('typescript');
    expect(adapter.detectLanguage('foo.py')).toBe('python');
    adapter.destroy();
    expect(adapter.detectLanguage('foo.ts')).toBe('typescript');
  });

  it('should handle destroy called twice', () => {
    const adapter = new TreeSitterAdapter();
    adapter.destroy();
    adapter.destroy();
    expect(adapter.isAvailable()).toBe(false);
  });
});

describe('Chaos: McpServer tool registration edge cases (FR-46)', () => {
  it('should handle registering tool with same name (overwrite)', () => {
    const server = new McpServer();
    server.registerTool({
      name: 'test',
      description: 'first',
      inputSchema: {},
      handler: async () => 'first',
    });
    server.registerTool({
      name: 'test',
      description: 'second',
      inputSchema: {},
      handler: async () => 'second',
    });
    expect(server.isRunning()).toBe(false);
  });

  it('should handle stop called without start', () => {
    const server = new McpServer();
    server.stop();
    expect(server.isRunning()).toBe(false);
  });
});

describe('Chaos: graphStore error recovery', () => {
  it('should recover from error state when new data arrives', () => {
    const { useGraphStore } = require('../../src/client/store/graphStore.ts');
    useGraphStore.getState().clearGraph();
    useGraphStore.getState().setError('catastrophic failure');
    expect(useGraphStore.getState().error).toBe('catastrophic failure');
    expect(useGraphStore.getState().isLoading).toBe(false);
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'recovered');
    expect(useGraphStore.getState().error).toBeNull();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });
});