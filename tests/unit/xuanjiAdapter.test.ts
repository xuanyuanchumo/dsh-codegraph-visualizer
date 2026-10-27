/**
 * XuanjiAdapter 宿主集成测试。
 *
 * 三个层次，缺一不可：
 * 1) **映射正确性**：GraphData ⇄ GraphSpace 的字段/边类型/多重边不丢信息；
 * 2) **读法正确性**：路径枚举、环枚举、可达集合在已知图上得到可手算的答案；
 * 3) **增量等价（宿主级 C3）**：通过 applyDelta 维护的索引，与「用新图重新
 *    loadGraph + 全量枚举」得到的 live 路径集合逐哈希一致。这一条是「璇玑图
 *    改一字只重读经过该字的诗」在真实宿主数据结构上的唯一可信证据。
 */
import { describe, it, expect } from 'vitest';
import {
  XuanjiAdapter,
  DEFAULT_PATH_EDGE_TYPES,
} from '../../src/shared/analysis/XuanjiAdapter.ts';
import type { GraphData, GraphDelta, GraphEdge, GraphNode } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { PathRule } from '../../src/xuanji/core/path-rule.ts';
import { enumerate } from '../../src/xuanji/query/query-engine.ts';

let seq = 0;
function node(id: string, type: GraphNode['type'] = 'function', properties: Record<string, unknown> = {}): GraphNode {
  return { id: NodeId(id), label: id, type, filePath: `src/${id}.ts`, properties };
}

function edge(source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(`e${++seq}`), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

function graphData(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  return {
    nodes,
    edges,
    metadata: {
      repoId: 'repo' as GraphData['metadata']['repoId'],
      timestamp: 1,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

function emptyDelta(): GraphDelta {
  return {
    addedNodes: [],
    removedNodes: [],
    modifiedNodes: [],
    addedEdges: [],
    removedEdges: [],
    modifiedEdges: [],
  };
}

const CYCLES_RULE: PathRule = {
  name: 'cycles',
  version: 1,
  start: () => true,
  edgeTypes: new Set(['call']),
  lMin: 1,
  lMax: 4,
  simple: true,
  closed: true,
  normalize: 'canonical',
  output: (nodes) => nodes,
};

function indexHashes(adapter: XuanjiAdapter, ruleName: string): string[] {
  const index = adapter.getIndex(ruleName);
  if (!index) return [];
  return [...index.hashIndex.values()].filter((e) => !e.stale).map((e) => e.hash).sort();
}

function materializeAll(adapter: XuanjiAdapter, rule: PathRule): void {
  const index = adapter.getIndex(rule.name) ?? adapter.registerRule(rule);
  enumerate(adapter.graph, rule, [...adapter.graph.nodeIds()], index);
}

describe('XuanjiAdapter 映射层', () => {
  it('loadGraph 映射节点属性与边类型', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a'), node('b')], [edge('a', 'b', 'import')]));
    expect(adapter.stats()).toMatchObject({ nodes: 2, edges: 1 });
    const attrs = adapter.graph.getNodeAttrs('a');
    expect(attrs?.role).toBe('function');
    expect(attrs?.filePath).toBe('src/a.ts');
  });

  it('同端不同型的两条边都进入图空间（多重边不被覆盖）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a'), node('b')], [edge('a', 'b', 'call'), edge('a', 'b', 'import')]));
    expect(adapter.stats().edges).toBe(2);
    expect(adapter.graph.hasEdge('a', 'b', 'call')).toBe(true);
    expect(adapter.graph.hasEdge('a', 'b', 'import')).toBe(true);
  });

  it('isExported 从两种宿主属性拼写映射', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a', 'function', { isExported: true }), node('b', 'function', { is_exported: 1 })], []));
    expect(adapter.graph.getNodeAttrs('a')?.isExported).toBe(true);
    expect(adapter.graph.getNodeAttrs('b')?.isExported).toBe(true);
  });

  it('未知节点不抛错，只返回空结果', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a')], []));
    expect(adapter.findPathsBetween('a', 'ghost').paths).toEqual([]);
    expect(adapter.reachableFrom(['ghost']).size).toBe(0);
  });
});

describe('XuanjiAdapter.findPathsBetween', () => {
  it('菱形图枚举出两条不同路径', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    ));
    const result = adapter.findPathsBetween('a', 'd');
    expect(result.total).toBe(2);
    expect(result.paths.map((p) => p.join('>')).sort()).toEqual(['a>b>d', 'a>c>d']);
    expect(result.truncated).toBe(false);
  });

  it('minHops/maxHops 限定长度区间', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'd')],
    ));
    expect(adapter.findPathsBetween('a', 'd', { minHops: 1, maxHops: 1 }).paths).toEqual([['a', 'd']]);
    expect(adapter.findPathsBetween('a', 'd', { minHops: 2, maxHops: 2 }).paths).toEqual([]);
    expect(adapter.findPathsBetween('a', 'd', { minHops: 3, maxHops: 3 }).paths).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('edgeTypes 过滤只走指定边类型', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b', 'import'), edge('b', 'c', 'call')],
    ));
    expect(adapter.findPathsBetween('a', 'c').total).toBe(1);
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['call'] }).total).toBe(0);
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['import'] }).total).toBe(0);
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['import', 'call'] }).total).toBe(1);
  });

  it('limit 截断并置 truncated', () => {
    const adapter = new XuanjiAdapter();
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id));
    const edges = ['b', 'c', 'd', 'e'].flatMap((mid) => [edge('a', mid), edge(mid, 'z')]);
    adapter.loadGraph(graphData([...nodes, node('z')], edges));
    const result = adapter.findPathsBetween('a', 'z', { limit: 2 });
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(true);
    expect(adapter.findPathsBetween('a', 'z', { limit: 10 }).truncated).toBe(false);
  });

  it('简单路径不重复节点（有环图不会无限展开）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('c', 'd'), edge('d', 'b')],
    ));
    const result = adapter.findPathsBetween('a', 'd', { maxHops: 6 });
    expect(result.paths).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('默认边类型不含 contains（结构包含不是调用路径）', () => {
    expect(DEFAULT_PATH_EDGE_TYPES).not.toContain('contains');
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('m', 'module'), node('f')], [edge('m', 'f', 'contains')]));
    expect(adapter.findPathsBetween('m', 'f').total).toBe(0);
    expect(adapter.findPathsBetween('m', 'f', { edgeTypes: ['contains'] }).total).toBe(1);
  });
});

describe('XuanjiAdapter.cycles（闭合路径 + Booth 规范化）', () => {
  it('三角形只出现一次（三个起点同一等价类）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    ));
    const result = adapter.cycles();
    expect(result.total).toBe(1);
    const cycleNodes = result.paths[0]!;
    expect(cycleNodes[0]).toBe(cycleNodes[cycleNodes.length - 1]);
    expect(new Set(cycleNodes).size).toBe(3);
  });

  it('两个独立环各出现一次', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'a'), edge('c', 'd'), edge('d', 'c')],
    ));
    expect(adapter.cycles().total).toBe(2);
  });

  it('自环是长度 1 的环', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a')], [edge('a', 'a')]));
    const result = adapter.cycles();
    expect(result.total).toBe(1);
    expect(result.paths[0]).toEqual(['a', 'a']);
  });

  it('maxLength 截断长环', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'a')],
    ));
    expect(adapter.cycles({ maxLength: 3 }).total).toBe(0);
    expect(adapter.cycles({ maxLength: 4 }).total).toBe(1);
  });

  it('与 detectCyclesDFS 的环集合兼容：DFS 找到的每个环都能被适配层找到', async () => {
    const { detectCyclesDFS } = await import('../../src/shared/analysis/CycleDFS.ts');
    const adapter = new XuanjiAdapter();
    const edges = [
      edge('a', 'b'), edge('b', 'c'), edge('c', 'a'),
      edge('c', 'd'), edge('d', 'a'),
      edge('e', 'f'), edge('f', 'e'),
    ];
    adapter.loadGraph(graphData(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)), edges));

    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.source as string) ?? [];
      list.push(e.target as string);
      adjacency.set(e.source as string, list);
    }
    const dfsCycles = detectCyclesDFS(adjacency);
    expect(dfsCycles.length).toBeGreaterThan(0);
    const adapterCycles = adapter.cycles({ maxLength: 6 }).paths;
    const keyOf = (nodes: string[]): string => {
      const open = nodes[nodes.length - 1] === nodes[0] ? nodes.slice(0, -1) : nodes;
      const rotations = open.map((_, i) => [...open.slice(i), ...open.slice(0, i)].join('>'));
      return rotations.sort()[0]!;
    };
    const adapterKeys = new Set(adapterCycles.map(keyOf));
    for (const cycle of dfsCycles) {
      expect(adapterKeys.has(keyOf(cycle))).toBe(true);
    }
  });
});

describe('XuanjiAdapter.reachableFrom', () => {
  it('沿边类型 BFS', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('d', 'a')],
    ));
    expect([...adapter.reachableFrom(['a'])].sort()).toEqual(['a', 'b', 'c']);
    expect([...adapter.reachableFrom(['a'], ['call'])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('多个起点合并结果且去重', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'c'), edge('b', 'c')],
    ));
    expect([...adapter.reachableFrom(['a', 'b', 'a'])].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('XuanjiAdapter.applyDelta 增量等价（宿主级 C3）', () => {
  it('注册规则后增量加边 = 新图全量枚举', () => {
    const base = graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(base);
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);

    const newEdge = edge('c', 'a');
    const delta = emptyDelta();
    delta.addedEdges.push(newEdge);
    const result = adapter.applyDelta(delta);
    expect(result.addedPaths).toBeGreaterThan(0);

    const fresh = new XuanjiAdapter();
    fresh.loadGraph(graphData(base.nodes, [...base.edges, newEdge]));
    fresh.registerRule(CYCLES_RULE);
    materializeAll(fresh, CYCLES_RULE);

    expect(indexHashes(adapter, 'cycles')).toEqual(indexHashes(fresh, 'cycles'));
  });

  it('删除边只置 stale、不重建索引，且查询结果排除失效路径', () => {
    const base = graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('a', 'c'), edge('c', 'b')],
    );
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(base);
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);
    expect(indexHashes(adapter, 'cycles').length).toBeGreaterThan(0);

    const removed = base.edges.find((e) => e.source === 'c' && e.target === 'a')!;
    const delta = emptyDelta();
    delta.removedEdges.push(removed);
    const result = adapter.applyDelta(delta);
    expect(result.stalePaths).toBeGreaterThan(0);

    const fresh = new XuanjiAdapter();
    fresh.loadGraph(graphData(base.nodes, base.edges.filter((e) => e !== removed)));
    fresh.registerRule(CYCLES_RULE);
    materializeAll(fresh, CYCLES_RULE);
    expect(indexHashes(adapter, 'cycles')).toEqual(indexHashes(fresh, 'cycles'));
  });
});
