import { describe, it, expect } from 'vitest';
import {
  CoreFunctionAnalyzer,
  legacyTruncatedReach,
} from '../../src/shared/analysis/CoreFunctionAnalyzer.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import { CORE_FUNCTION } from '../../src/shared/constants.ts';

/** 从边集合构造前向邻接表（与分析器内部的 outEdges 同构，供旧实现对照）。 */
function outEdgesOf(edges: GraphEdge[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const list = out.get(edge.source) ?? [];
    list.push(edge.target);
    out.set(edge.source, list);
  }
  return out;
}

function makeFunction(id: string, label: string, filePath = 'src/app.ts', props: Record<string, unknown> = {}): GraphNode {
  return {
    id: NodeId(id),
    label,
    type: 'function',
    filePath,
    lineNumber: 1,
    properties: props,
  };
}

function makeCall(source: string, target: string): GraphEdge {
  return {
    id: EdgeId(`call-${source}-${target}`),
    source: NodeId(source),
    target: NodeId(target),
    type: 'call',
    properties: {},
  };
}

describe('CoreFunctionAnalyzer', () => {
  it('returns empty for empty input', () => {
    const analyzer = new CoreFunctionAnalyzer();
    expect(analyzer.analyze([], [])).toEqual([]);
  });

  it('returns empty when no function nodes', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes: GraphNode[] = [
      { id: NodeId('c1'), label: 'ClassA', type: 'class', filePath: 'a.ts', lineNumber: 1, properties: {} },
    ];
    expect(analyzer.analyze(nodes, [])).toEqual([]);
  });

  it('identifies entry points (indegree=0, outdegree>0)', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('main', 'main'),
      makeFunction('helper', 'helper'),
    ];
    const edges = [makeCall('main', 'helper')];
    const result = analyzer.analyze(nodes, edges);
    const mainFn = result.find((r) => r.nodeId === 'main');
    expect(mainFn).toBeDefined();
    expect(mainFn!.reasons).toContain('entry-point');
    expect(mainFn!.category).toBe('entry');
  });

  it('identifies hub functions (high indegree and outdegree)', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('hub', 'hub'),
      ...Array.from({ length: 6 }, (_, i) => makeFunction(`in${i}`, `in${i}`)),
      ...Array.from({ length: 6 }, (_, i) => makeFunction(`out${i}`, `out${i}`)),
    ];
    const edges = [
      ...Array.from({ length: 6 }, (_, i) => makeCall(`in${i}`, 'hub')),
      ...Array.from({ length: 6 }, (_, i) => makeCall('hub', `out${i}`)),
    ];
    const result = analyzer.analyze(nodes, edges);
    const hubFn = result.find((r) => r.nodeId === 'hub');
    expect(hubFn).toBeDefined();
    expect(hubFn!.reasons).toContain('hub-function');
    expect(hubFn!.category).toBe('hub');
    expect(hubFn!.inDegree).toBe(6);
    expect(hubFn!.outDegree).toBe(6);
  });

  it('identifies handler pattern functions', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('h1', 'handleRequest'),
      makeFunction('h2', 'UserController'),
      makeFunction('normal', 'doSomething'),
    ];
    const edges = [
      makeCall('h1', 'normal'),
      makeCall('h2', 'normal'),
    ];
    const result = analyzer.analyze(nodes, edges);
    const h1 = result.find((r) => r.nodeId === 'h1');
    expect(h1).toBeDefined();
    expect(h1!.reasons).toContain('handler-pattern');
    expect(h1!.category).toBe('api');
  });

  it('identifies CLI pattern functions', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('main', 'main'),
      makeFunction('helper', 'helper'),
    ];
    const edges = [makeCall('main', 'helper')];
    const result = analyzer.analyze(nodes, edges);
    const mainFn = result.find((r) => r.nodeId === 'main');
    expect(mainFn).toBeDefined();
    expect(mainFn!.reasons).toContain('cli-pattern');
    expect(mainFn!.category).toBe('entry');
  });

  it('identifies exported functions', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('exp', 'exportedFunc', 'src/api.ts', { isExported: true }),
      makeFunction('internal', 'internalFunc'),
    ];
    const edges = [makeCall('exp', 'internal')];
    const result = analyzer.analyze(nodes, edges);
    const expFn = result.find((r) => r.nodeId === 'exp');
    expect(expFn).toBeDefined();
    expect(expFn!.reasons).toContain('exported');
  });

  it('identifies event pattern functions', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('e1', 'onClick'),
      makeFunction('e2', 'handleSubmit'),
      makeFunction('normal', 'process'),
    ];
    const edges = [
      makeCall('e1', 'normal'),
      makeCall('e2', 'normal'),
    ];
    const result = analyzer.analyze(nodes, edges);
    const e1 = result.find((r) => r.nodeId === 'e1');
    expect(e1).toBeDefined();
    expect(e1!.reasons).toContain('event-pattern');
  });

  it('computes influence reach correctly', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('a', 'a'),
      makeFunction('b', 'b'),
      makeFunction('c', 'c'),
      makeFunction('d', 'd'),
      makeFunction('e', 'e'),
      ...Array.from({ length: 12 }, (_, i) => makeFunction(`leaf${i}`, `leaf${i}`)),
    ];
    const edges = [
      makeCall('a', 'b'),
      makeCall('b', 'c'),
      makeCall('c', 'd'),
      makeCall('d', 'e'),
      ...Array.from({ length: 12 }, (_, i) => makeCall('e', `leaf${i}`)),
    ];
    const result = analyzer.analyze(nodes, edges);
    const aFn = result.find((r) => r.nodeId === 'a');
    expect(aFn).toBeDefined();
    expect(aFn!.influenceReach).toBeGreaterThanOrEqual(10);
    expect(aFn!.reasons).toContain('large-influence');
  });

  it('computes call chain depth correctly', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('l0', 'l0'),
      makeFunction('l1', 'l1'),
      makeFunction('l2', 'l2'),
      makeFunction('l3', 'l3'),
      makeFunction('l4', 'l4'),
    ];
    const edges = [
      makeCall('l0', 'l1'),
      makeCall('l1', 'l2'),
      makeCall('l2', 'l3'),
      makeCall('l3', 'l4'),
    ];
    const result = analyzer.analyze(nodes, edges);
    const l0Fn = result.find((r) => r.nodeId === 'l0');
    expect(l0Fn).toBeDefined();
    expect(l0Fn!.callChainDepth).toBeGreaterThanOrEqual(3);
    expect(l0Fn!.reasons).toContain('deep-call-chain');
  });

  it('sorts results by score descending', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('low', 'low'),
      makeFunction('high', 'main'),
      makeFunction('mid', 'handler'),
    ];
    const edges = [
      makeCall('high', 'mid'),
      makeCall('mid', 'low'),
    ];
    const result = analyzer.analyze(nodes, edges);
    expect(result.length).toBeGreaterThan(0);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it('skips functions with no reasons', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('isolated', 'isolated'),
    ];
    const edges: GraphEdge[] = [];
    const result = analyzer.analyze(nodes, edges);
    expect(result.find((r) => r.nodeId === 'isolated')).toBeUndefined();
  });

  it('handles recursion without infinite loop', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('recursive', 'recursive'),
      makeFunction('other', 'other'),
    ];
    const edges = [
      makeCall('recursive', 'recursive'),
      makeCall('recursive', 'other'),
    ];
    const result = analyzer.analyze(nodes, edges);
    expect(result.length).toBeGreaterThan(0);
  });

  it('only considers call edges, not other types', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('a', 'a'),
      makeFunction('b', 'b'),
    ];
    const edges: GraphEdge[] = [
      {
        id: EdgeId('import-1'),
        source: NodeId('a'),
        target: NodeId('b'),
        type: 'import',
        properties: {},
      },
    ];
    const result = analyzer.analyze(nodes, edges);
    expect(result.find((r) => r.nodeId === 'a')).toBeUndefined();
  });

  it('identifies exported functions via is_exported: 1', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('exp', 'exportedFunc', 'src/api.ts', { is_exported: 1 }),
      makeFunction('internal', 'internalFunc'),
    ];
    const edges = [makeCall('exp', 'internal')];
    const result = analyzer.analyze(nodes, edges);
    const expFn = result.find((r) => r.nodeId === 'exp');
    expect(expFn).toBeDefined();
    expect(expFn!.reasons).toContain('exported');
  });

  it('classifies as critical when no specific pattern matches', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('exp', 'someFunc', 'src/api.ts', { isExported: true }),
    ];
    const edges: GraphEdge[] = [];
    const result = analyzer.analyze(nodes, edges);
    const expFn = result.find((r) => r.nodeId === 'exp');
    expect(expFn).toBeDefined();
    expect(expFn!.category).toBe('critical');
  });

  it('skips self-loop edges', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('self', 'selfLoop'),
      makeFunction('target', 'target'),
    ];
    const edges = [
      makeCall('self', 'self'),
      makeCall('self', 'target'),
    ];
    const result = analyzer.analyze(nodes, edges);
    const selfFn = result.find((r) => r.nodeId === 'self');
    expect(selfFn).toBeDefined();
    expect(selfFn!.outDegree).toBe(1);
  });

  it('handles circular call chains without infinite loop', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('a', 'a'),
      makeFunction('b', 'b'),
      makeFunction('c', 'c'),
    ];
    const edges = [
      makeCall('a', 'b'),
      makeCall('b', 'c'),
      makeCall('c', 'a'),
    ];
    const result = analyzer.analyze(nodes, edges);
    expect(result.length).toBeGreaterThan(0);
  });

  it('respects MAX_BFS_NODES limit for influence reach', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('root', 'root'),
      ...Array.from({ length: 600 }, (_, i) => makeFunction(`n${i}`, `n${i}`)),
    ];
    const edges = [
      ...Array.from({ length: 600 }, (_, i) => makeCall('root', `n${i}`)),
    ];
    const result = analyzer.analyze(nodes, edges);
    const rootFn = result.find((r) => r.nodeId === 'root');
    expect(rootFn).toBeDefined();
    expect(rootFn!.influenceReach).toBeGreaterThan(0);
  });

  it('filters out non-function nodes from call edges', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes: GraphNode[] = [
      makeFunction('fn', 'handler'),
      { id: NodeId('cls'), label: 'ClassA', type: 'class', filePath: 'a.ts', lineNumber: 1, properties: {} },
    ];
    const edges = [
      makeCall('fn', 'cls'),
      makeCall('cls', 'fn'),
    ];
    const result = analyzer.analyze(nodes, edges);
    const fnResult = result.find((r) => r.nodeId === 'fn');
    expect(fnResult).toBeDefined();
    expect(fnResult!.inDegree).toBe(0);
    expect(fnResult!.outDegree).toBe(0);
  });

  it('identifies multiple reasons for a single function', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('main', 'main', 'src/app.ts', { isExported: true }),
      ...Array.from({ length: 6 }, (_, i) => makeFunction(`dep${i}`, `dep${i}`)),
    ];
    const edges = [
      ...Array.from({ length: 6 }, (_, i) => makeCall('main', `dep${i}`)),
    ];
    const result = analyzer.analyze(nodes, edges);
    const mainFn = result.find((r) => r.nodeId === 'main');
    expect(mainFn).toBeDefined();
    expect(mainFn!.reasons).toContain('cli-pattern');
    expect(mainFn!.reasons).toContain('entry-point');
    expect(mainFn!.reasons).toContain('exported');
    expect(mainFn!.reasons).toContain('high-outdegree');
  });

  it('handler pattern takes precedence over cli pattern in classification', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('h', 'handleRequest'),
      makeFunction('target', 'target'),
    ];
    const edges = [makeCall('h', 'target')];
    const result = analyzer.analyze(nodes, edges);
    const hFn = result.find((r) => r.nodeId === 'h');
    expect(hFn).toBeDefined();
    expect(hFn!.category).toBe('api');
  });

  it('hub-function reason requires both indegree and outdegree >= threshold', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('hub', 'hub'),
      ...Array.from({ length: 6 }, (_, i) => makeFunction(`in${i}`, `in${i}`)),
      makeFunction('out1', 'out1'),
    ];
    const edges = [
      ...Array.from({ length: 6 }, (_, i) => makeCall(`in${i}`, 'hub')),
      makeCall('hub', 'out1'),
    ];
    const result = analyzer.analyze(nodes, edges);
    const hubFn = result.find((r) => r.nodeId === 'hub');
    expect(hubFn).toBeDefined();
    expect(hubFn!.reasons).not.toContain('hub-function');
    expect(hubFn!.reasons).toContain('high-indegree');
  });

  it('score is capped for high-indegree', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('hub', 'hub'),
      ...Array.from({ length: 20 }, (_, i) => makeFunction(`in${i}`, `in${i}`)),
      ...Array.from({ length: 6 }, (_, i) => makeFunction(`out${i}`, `out${i}`)),
    ];
    const edges = [
      ...Array.from({ length: 20 }, (_, i) => makeCall(`in${i}`, 'hub')),
      ...Array.from({ length: 6 }, (_, i) => makeCall('hub', `out${i}`)),
    ];
    const result = analyzer.analyze(nodes, edges);
    const hubFn = result.find((r) => r.nodeId === 'hub');
    expect(hubFn).toBeDefined();
    expect(hubFn!.score).toBeLessThanOrEqual(200);
  });

  it('event pattern matches on* prefixed labels', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('e1', 'onChange'),
      makeFunction('e2', 'onSubmit'),
      makeFunction('e3', 'onUpdate'),
      makeFunction('target', 'target'),
    ];
    const edges = [
      makeCall('e1', 'target'),
      makeCall('e2', 'target'),
      makeCall('e3', 'target'),
    ];
    const result = analyzer.analyze(nodes, edges);
    for (const id of ['e1', 'e2', 'e3']) {
      const fn = result.find((r) => r.nodeId === id);
      expect(fn).toBeDefined();
      expect(fn!.reasons).toContain('event-pattern');
      expect(fn!.category).toBe('api');
    }
  });

  it('returns correct CoreFunction structure', () => {
    const analyzer = new CoreFunctionAnalyzer();
    const nodes = [
      makeFunction('main', 'main'),
      makeFunction('helper', 'helper'),
    ];
    const edges = [makeCall('main', 'helper')];
    const result = analyzer.analyze(nodes, edges);
    const mainFn = result.find((r) => r.nodeId === 'main');
    expect(mainFn).toBeDefined();
    expect(mainFn).toHaveProperty('nodeId');
    expect(mainFn).toHaveProperty('label');
    expect(mainFn).toHaveProperty('filePath');
    expect(mainFn).toHaveProperty('score');
    expect(mainFn).toHaveProperty('reasons');
    expect(mainFn).toHaveProperty('inDegree');
    expect(mainFn).toHaveProperty('outDegree');
    expect(mainFn).toHaveProperty('influenceReach');
    expect(mainFn).toHaveProperty('callChainDepth');
    expect(mainFn).toHaveProperty('category');
    expect(mainFn!.label).toBe('main');
    expect(mainFn!.filePath).toBe('src/app.ts');
  });

  // ---------------------------------------------------------------------------
  // cycle-107 · C-4：精确可达（SCC + bitset）与旧截断 BFS 的语义差异
  // ---------------------------------------------------------------------------
  describe('influence reach · exact vs truncated (cycle-107 C-4)', () => {
    it('reports the exact fan-out (600) instead of a truncated value', () => {
      const analyzer = new CoreFunctionAnalyzer();
      const nodes = [
        makeFunction('root', 'root'),
        ...Array.from({ length: 600 }, (_, i) => makeFunction(`leaf${i}`, `leaf${i}`)),
      ];
      const edges = Array.from({ length: 600 }, (_, i) => makeCall('root', `leaf${i}`));
      const result = analyzer.analyze(nodes, edges);
      const rootFn = result.find((r) => r.nodeId === 'root');
      expect(rootFn).toBeDefined();
      expect(rootFn!.influenceReach).toBe(600);
    });

    it('is exact on a 601-node chain while the legacy value stays an under-estimate (old ≤ new)', () => {
      const analyzer = new CoreFunctionAnalyzer();
      const nodes = Array.from({ length: 601 }, (_, i) => makeFunction(`n${i}`, `n${i}`));
      const edges = Array.from({ length: 600 }, (_, i) => makeCall(`n${i}`, `n${i + 1}`));

      const result = analyzer.analyze(nodes, edges);
      const head = result.find((r) => r.nodeId === 'n0');
      expect(head).toBeDefined();
      expect(head!.influenceReach).toBe(600);

      const legacy = legacyTruncatedReach('n0', outEdgesOf(edges));
      expect(legacy).toBeLessThanOrEqual(head!.influenceReach);
      // 旧实现截断在 visited.size == MAX_BFS_NODES，长链上恰好返回 499
      expect(legacy).toBe(CORE_FUNCTION.MAX_BFS_NODES - 1);
    });

    it('matches the legacy value node-by-node when the exact value is below MAX_BFS_NODES', () => {
      const analyzer = new CoreFunctionAnalyzer();
      const ids = ['main', 'b', 'c', 'd', 'e'];
      const nodes = ids.map((id) => makeFunction(id, id === 'main' ? 'main' : id));
      const edges = [
        makeCall('main', 'b'),
        makeCall('b', 'c'),
        makeCall('c', 'd'),
        makeCall('d', 'e'),
      ];

      const result = analyzer.analyze(nodes, edges);
      const head = result.find((r) => r.nodeId === 'main');
      expect(head).toBeDefined();
      expect(head!.influenceReach).toBe(4);
      expect(legacyTruncatedReach('main', outEdgesOf(edges))).toBe(head!.influenceReach);
    });

    it('counts a 2-cycle as one SCC (reach 1 each, no infinite growth)', () => {
      const analyzer = new CoreFunctionAnalyzer();
      const nodes = [
        makeFunction('a', 'main'),
        makeFunction('b', 'b'),
      ];
      const edges = [makeCall('a', 'b'), makeCall('b', 'a')];
      const result = analyzer.analyze(nodes, edges);
      const a = result.find((r) => r.nodeId === 'a');
      expect(a).toBeDefined();
      expect(a!.influenceReach).toBe(1);
    });

    it('reports reach 0 for a function with no outgoing call edges', () => {
      const analyzer = new CoreFunctionAnalyzer();
      const nodes = [
        makeFunction('exp', 'someFunc', 'src/api.ts', { isExported: true }),
      ];
      const result = analyzer.analyze(nodes, []);
      const expFn = result.find((r) => r.nodeId === 'exp');
      expect(expFn).toBeDefined();
      expect(expFn!.influenceReach).toBe(0);
    });

    it('keeps the large-influence threshold semantics on a small exact graph', () => {
      const analyzer = new CoreFunctionAnalyzer();
      const nodes = [
        makeFunction('hub', 'hub'),
        ...Array.from({ length: 12 }, (_, i) => makeFunction(`d${i}`, `d${i}`)),
      ];
      const edges = Array.from({ length: 12 }, (_, i) => makeCall('hub', `d${i}`));
      const result = analyzer.analyze(nodes, edges);
      const hub = result.find((r) => r.nodeId === 'hub');
      expect(hub).toBeDefined();
      expect(hub!.influenceReach).toBe(12);
      expect(hub!.reasons).toContain('large-influence');
    });
  });
});