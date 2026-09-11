import { describe, it, expect, vi } from 'vitest';
import { CallChainAggregator } from '../../src/client/diagram/CallChainAggregator.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { ASTNode } from '../../src/shared/CFGTypes.ts';

function makeFunction(id: string, label: string, filePath = 'src/app.ts'): GraphNode {
  return {
    id: NodeId(id),
    label,
    type: 'function',
    filePath,
    lineNumber: 1,
    properties: {},
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

function makeMockAST(): ASTNode {
  return {
    type: 'function_declaration',
    text: 'function foo() { return 1; }',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 30 },
    children: [
      {
        type: 'return_statement',
        text: 'return 1;',
        startPosition: { row: 0, column: 20 },
        endPosition: { row: 0, column: 29 },
        children: [],
      },
    ],
  };
}

describe('CallChainAggregator', () => {
  it('returns null for non-existent entry node', async () => {
    const aggregator = new CallChainAggregator();
    const result = await aggregator.aggregate(
      'nonexistent',
      [],
      [],
      async () => null,
    );
    expect(result).toBeNull();
  });

  it('returns null for non-function entry node', async () => {
    const aggregator = new CallChainAggregator();
    const nodes: GraphNode[] = [
      { id: NodeId('c1'), label: 'ClassA', type: 'class', filePath: 'a.ts', lineNumber: 1, properties: {} },
    ];
    const result = await aggregator.aggregate('c1', nodes, [], async () => null);
    expect(result).toBeNull();
  });

  it('aggregates a single function with no call chain', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [makeFunction('main', 'main')];
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate('main', nodes, [], astFetcher);
    expect(result).not.toBeNull();
    expect(result!.functionCount).toBe(1);
    expect(result!.includedFunctions).toEqual(['main']);
  });

  it('aggregates multiple functions along call chain', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [
      makeFunction('main', 'main'),
      makeFunction('helper1', 'helper1'),
      makeFunction('helper2', 'helper2'),
    ];
    const edges = [
      makeCall('main', 'helper1'),
      makeCall('helper1', 'helper2'),
    ];
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate(
      'main', nodes, edges, astFetcher,
      { depth: 2, maxFunctions: 20 },
    );
    expect(result).not.toBeNull();
    expect(result!.functionCount).toBe(3);
    expect(result!.includedFunctions).toContain('main');
    expect(result!.includedFunctions).toContain('helper1');
    expect(result!.includedFunctions).toContain('helper2');
  });

  it('respects depth limit', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [
      makeFunction('l0', 'l0'),
      makeFunction('l1', 'l1'),
      makeFunction('l2', 'l2'),
      makeFunction('l3', 'l3'),
    ];
    const edges = [
      makeCall('l0', 'l1'),
      makeCall('l1', 'l2'),
      makeCall('l2', 'l3'),
    ];
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate(
      'l0', nodes, edges, astFetcher,
      { depth: 1, maxFunctions: 20 },
    );
    expect(result).not.toBeNull();
    expect(result!.includedFunctions).toContain('l0');
    expect(result!.includedFunctions).toContain('l1');
    expect(result!.includedFunctions).not.toContain('l2');
    expect(result!.includedFunctions).not.toContain('l3');
  });

  it('respects maxFunctions limit', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = Array.from({ length: 10 }, (_, i) => makeFunction(`fn${i}`, `fn${i}`));
    const edges = Array.from({ length: 9 }, (_, i) => makeCall(`fn${i}`, `fn${i + 1}`));
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate(
      'fn0', nodes, edges, astFetcher,
      { depth: 10, maxFunctions: 3 },
    );
    expect(result).not.toBeNull();
    expect(result!.functionCount).toBeLessThanOrEqual(3);
    expect(result!.includedFunctions.length).toBeLessThanOrEqual(3);
  });

  it('skips self-call edges', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [
      makeFunction('recursive', 'recursive'),
      makeFunction('other', 'other'),
    ];
    const edges = [
      makeCall('recursive', 'recursive'),
      makeCall('recursive', 'other'),
    ];
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate(
      'recursive', nodes, edges, astFetcher,
      { depth: 2, maxFunctions: 20 },
    );
    expect(result).not.toBeNull();
    expect(result!.includedFunctions).toContain('recursive');
    expect(result!.includedFunctions).toContain('other');
  });

  it('caches AST fetches by file path', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [
      makeFunction('a', 'a', 'src/file1.ts'),
      makeFunction('b', 'b', 'src/file1.ts'),
    ];
    const edges = [makeCall('a', 'b')];
    const astFetcher = vi.fn(async () => makeMockAST());
    await aggregator.aggregate('a', nodes, edges, astFetcher);
    expect(astFetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null when AST fetch fails for all functions', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [makeFunction('main', 'main')];
    const astFetcher = vi.fn(async () => null);
    const result = await aggregator.aggregate('main', nodes, [], astFetcher);
    expect(result).toBeNull();
  });

  it('creates call chain edges between functions', async () => {
    const aggregator = new CallChainAggregator();
    const nodes = [
      makeFunction('main', 'main'),
      makeFunction('helper', 'helper'),
    ];
    const edges = [makeCall('main', 'helper')];
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate(
      'main', nodes, edges, astFetcher,
      { depth: 2, maxFunctions: 20 },
    );
    expect(result).not.toBeNull();
    const callChainEdges = result!.diagram.edges.filter(
      (e) => e.properties?.callChainEdge === true,
    );
    expect(callChainEdges.length).toBeGreaterThan(0);
  });

  it('only follows call edges, not other types', async () => {
    const aggregator = new CallChainAggregator();
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
    const astFetcher = vi.fn(async () => makeMockAST());
    const result = await aggregator.aggregate(
      'a', nodes, edges, astFetcher,
      { depth: 2, maxFunctions: 20 },
    );
    expect(result).not.toBeNull();
    expect(result!.includedFunctions).toEqual(['a']);
  });
});