import { describe, it, expect } from 'vitest';
import { CallGraphAssembler } from '../../src/client/diagram/CallGraphAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], label: string, props?: Record<string, unknown>): GraphNode {
  return {
    id: NodeId(id),
    label,
    type,
    filePath: `src/${id}.ts`,
    lineNumber: 1,
    properties: props ?? {},
  };
}

function makeEdge(id: string, source: string, target: string, type: GraphEdge['type']): GraphEdge {
  return {
    id: EdgeId(id),
    source: NodeId(source),
    target: NodeId(target),
    type,
    properties: {},
  };
}

describe('CallGraphAssembler', () => {
  const assembler = new CallGraphAssembler();

  it('filters to function nodes only', () => {
    const nodes = [
      makeNode('fn1', 'function', 'func1'),
      makeNode('cls1', 'class', 'Class1'),
      makeNode('fn2', 'function', 'func2'),
      makeNode('var1', 'variable', 'var1'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.id)).toEqual(['fn1', 'fn2']);
  });

  it('filters to call edges only', () => {
    const nodes = [
      makeNode('A', 'function', 'funcA'),
      makeNode('B', 'function', 'funcB'),
      makeNode('C', 'function', 'funcC'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'B', 'call'),
      makeEdge('e2', 'A', 'C', 'import'),
      makeEdge('e3', 'B', 'C', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(2);
    expect(result.edges.map((e) => e.type)).toEqual(['call', 'call']);
  });

  it('identifies entry functions (in-degree 0)', () => {
    const nodes = [
      makeNode('A', 'function', 'main'),
      makeNode('B', 'function', 'helper'),
      makeNode('C', 'function', 'util'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'B', 'call'),
      makeEdge('e2', 'B', 'C', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toEqual(['A']);
    const nodeA = result.nodes.find((n) => n.id === 'A');
    expect(nodeA?.properties.isEntry).toBe(true);
  });

  it('computes call depth from entry points', () => {
    const nodes = [
      makeNode('A', 'function', 'main'),
      makeNode('B', 'function', 'helper'),
      makeNode('C', 'function', 'util'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'B', 'call'),
      makeEdge('e2', 'B', 'C', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.depth).toBe(0);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.depth).toBe(1);
    expect(result.nodes.find((n) => n.id === 'C')?.properties.depth).toBe(2);
    expect(result.metadata.maxDepth).toBe(2);
  });

  it('computes in-degree and out-degree', () => {
    const nodes = [
      makeNode('A', 'function', 'main'),
      makeNode('B', 'function', 'helper'),
      makeNode('C', 'function', 'util'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'B', 'call'),
      makeEdge('e2', 'A', 'C', 'call'),
      makeEdge('e3', 'B', 'C', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.inDegree).toBe(0);
    expect(result.nodes.find((n) => n.id === 'A')?.properties.outDegree).toBe(2);
    expect(result.nodes.find((n) => n.id === 'C')?.properties.inDegree).toBe(2);
    expect(result.nodes.find((n) => n.id === 'C')?.properties.outDegree).toBe(0);
  });

  it('detects recursive functions', () => {
    const nodes = [
      makeNode('A', 'function', 'recursive'),
      makeNode('B', 'function', 'normal'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'A', 'call'),
      makeEdge('e2', 'A', 'B', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isRecursive).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isRecursive).toBe(false);
  });

  it('detects mutual recursion', () => {
    const nodes = [
      makeNode('A', 'function', 'funcA'),
      makeNode('B', 'function', 'funcB'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'B', 'call'),
      makeEdge('e2', 'B', 'A', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isRecursive).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isRecursive).toBe(true);
  });

  it('classifies entry types', () => {
    const nodes = [
      makeNode('main', 'function', 'main'),
      makeNode('handler', 'function', 'handleRequest'),
      makeNode('onClick', 'function', 'onClick'),
      makeNode('testFoo', 'function', 'testFoo'),
      makeNode('exported', 'function', 'exported', { isExported: true }),
      makeNode('regular', 'function', 'regular'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'main')?.properties.entryType).toBe('cli');
    expect(result.nodes.find((n) => n.id === 'handler')?.properties.entryType).toBe('handler');
    expect(result.nodes.find((n) => n.id === 'onClick')?.properties.entryType).toBe('event');
    expect(result.nodes.find((n) => n.id === 'testFoo')?.properties.entryType).toBe('test');
    expect(result.nodes.find((n) => n.id === 'exported')?.properties.entryType).toBe('export');
    expect(result.nodes.find((n) => n.id === 'regular')?.properties.entryType).toBe('none');
  });

  it('handles multiple entry points (forest)', () => {
    const nodes = [
      makeNode('A', 'function', 'main'),
      makeNode('B', 'function', 'other'),
      makeNode('C', 'function', 'shared'),
    ];
    const edges = [
      makeEdge('e1', 'A', 'C', 'call'),
      makeEdge('e2', 'B', 'C', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toHaveLength(2);
    expect(result.metadata.rootIds).toContain('A');
    expect(result.metadata.rootIds).toContain('B');
  });

  it('filters out edges with dangling references', () => {
    const nodes = [makeNode('A', 'function', 'funcA')];
    const edges = [
      makeEdge('e1', 'A', 'Missing', 'call'),
      makeEdge('e2', 'Missing', 'A', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(0);
  });
});