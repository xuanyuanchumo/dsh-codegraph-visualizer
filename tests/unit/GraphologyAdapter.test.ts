import { describe, it, expect } from 'vitest';
import { GraphologyAdapter } from '../../src/shared/GraphologyAdapter.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

function makeNodes(ids: string[]): GraphNode[] {
  return ids.map((id) => ({
    id: id as GraphNode['id'],
    label: id,
    type: 'function' as const,
    filePath: `src/${id}.ts`,
    properties: {},
  }));
}

function makeEdges(pairs: Array<[string, string]>): GraphEdge[] {
  return pairs.map(([source, target], i) => ({
    id: `e${i}` as GraphEdge['id'],
    source: source as GraphEdge['source'],
    target: target as GraphEdge['target'],
    type: 'call' as const,
    properties: {},
  }));
}

describe('GraphologyAdapter', () => {
  it('builds graph from nodes and edges', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(makeNodes(['a', 'b', 'c']), makeEdges([['a', 'b'], ['b', 'c']]));
    adapter.clear();
  });

  it('detects communities in a connected graph', async () => {
    const adapter = new GraphologyAdapter();
    const nodes = makeNodes(['a', 'b', 'c', 'd', 'e', 'f']);
    const edges = makeEdges([
      ['a', 'b'], ['b', 'c'], ['a', 'c'],
      ['d', 'e'], ['e', 'f'], ['d', 'f'],
    ]);
    await adapter.buildGraph(nodes, edges);
    const communities = await adapter.detectCommunities();
    expect(communities).toHaveLength(6);
    const communitySet = new Set(communities.map(r => r.community));
    expect(communitySet.size).toBeGreaterThanOrEqual(1);
    adapter.clear();
  });

  it('computes degree centrality', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(
      makeNodes(['hub', 'a', 'b', 'c']),
      makeEdges([['hub', 'a'], ['hub', 'b'], ['hub', 'c']]),
    );
    const centrality = adapter.computeDegreeCentrality();
    expect(centrality[0]!.nodeId).toBe('hub');
    expect(centrality[0]!.centrality).toBe(1);
    adapter.clear();
  });

  it('performs BFS from a starting node', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(
      makeNodes(['root', 'a', 'b', 'c']),
      makeEdges([['root', 'a'], ['root', 'b'], ['a', 'c']]),
    );
    const visited = adapter.bfs('root');
    expect(visited).toContain('root');
    expect(visited).toContain('a');
    expect(visited).toContain('b');
    expect(visited).toContain('c');
    adapter.clear();
  });

  it('respects maxDepth in BFS', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(
      makeNodes(['root', 'a', 'b', 'c']),
      makeEdges([['root', 'a'], ['a', 'b'], ['b', 'c']]),
    );
    const visited = adapter.bfs('root', 1);
    expect(visited).toContain('root');
    expect(visited).toContain('a');
    expect(visited).not.toContain('c');
    adapter.clear();
  });

  it('finds shortest path between two nodes', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(
      makeNodes(['a', 'b', 'c', 'd']),
      makeEdges([['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'd']]),
    );
    const path = adapter.shortestPath('a', 'd');
    expect(path).not.toBeNull();
    expect(path![0]).toBe('a');
    expect(path![path!.length - 1]).toBe('d');
    adapter.clear();
  });

  it('returns null for unreachable nodes', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(
      makeNodes(['a', 'b', 'c']),
      makeEdges([['a', 'b']]),
    );
    const path = adapter.shortestPath('a', 'c');
    expect(path).toBeNull();
    adapter.clear();
  });

  it('finds connected components', async () => {
    const adapter = new GraphologyAdapter();
    await adapter.buildGraph(
      makeNodes(['a', 'b', 'c', 'd', 'e']),
      makeEdges([['a', 'b'], ['c', 'd']]),
    );
    const components = adapter.findConnectedComponents();
    expect(components.length).toBeGreaterThanOrEqual(2);
    adapter.clear();
  });

  it('handles empty graph gracefully', async () => {
    const adapter = new GraphologyAdapter();
    const communities = await adapter.detectCommunities();
    expect(communities).toHaveLength(0);
    expect(adapter.computeDegreeCentrality()).toHaveLength(0);
    expect(adapter.bfs('nonexistent')).toHaveLength(0);
    expect(adapter.shortestPath('a', 'b')).toBeNull();
    expect(adapter.findConnectedComponents()).toHaveLength(0);
  });
});