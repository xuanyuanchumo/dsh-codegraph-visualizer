import { describe, it, expect } from 'vitest';
import { DependencyAssembler } from '../../src/client/diagram/DependencyAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], filePath: string): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type,
    filePath,
    lineNumber: 1,
    properties: {},
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

describe('DependencyAssembler', () => {
  const assembler = new DependencyAssembler();

  it('aggregates nodes by top-level directory', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'class', 'src/utils/b.ts'),
      makeNode('c', 'function', 'src/core/c.ts'),
      makeNode('d', 'class', 'src/core/d.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.length).toBe(2);
    expect(result.nodes.some((n) => n.label === 'src/utils')).toBe(true);
    expect(result.nodes.some((n) => n.label === 'src/core')).toBe(true);
  });

  it('creates directory nodes with isDependencyDir property', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].properties.isDependencyDir).toBe(true);
    expect(result.nodes[0].properties.directory).toBe('src/utils');
  });

  it('counts children per directory', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'class', 'src/utils/b.ts'),
      makeNode('c', 'function', 'src/core/c.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const utilsNode = result.nodes.find((n) => n.label === 'src/utils');
    const coreNode = result.nodes.find((n) => n.label === 'src/core');
    expect(utilsNode?.properties.childCount).toBe(2);
    expect(coreNode?.properties.childCount).toBe(1);
  });

  it('tracks type distribution per directory', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'class', 'src/utils/b.ts'),
      makeNode('c', 'function', 'src/utils/c.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const utilsNode = result.nodes.find((n) => n.label === 'src/utils');
    const dist = utilsNode?.properties.typeDistribution as Record<string, number>;
    expect(dist.function).toBe(2);
    expect(dist.class).toBe(1);
  });

  it('filters to import and dependency edges only', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
      makeNode('c', 'function', 'src/main/c.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'call'),
      makeEdge('e3', 'a', 'c', 'dependency'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges.length).toBe(2);
    expect(result.edges.every((e) => e.type === 'import' || e.type === 'dependency')).toBe(true);
  });

  it('aggregates edges between directories', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
      makeNode('c', 'function', 'src/core/c.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'c', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges.length).toBe(1);
    expect(result.edges[0].properties.aggregatedCount).toBe(2);
  });

  it('skips intra-directory edges', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/utils/b.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges.length).toBe(0);
  });

  it('computes in-degree and out-degree', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
      makeNode('c', 'function', 'src/main/c.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'c', 'import'),
      makeEdge('e3', 'b', 'c', 'dependency'),
    ];

    const result = assembler.assemble(nodes, edges);

    const utilsNode = result.nodes.find((n) => n.label === 'src/utils');
    const coreNode = result.nodes.find((n) => n.label === 'src/core');
    const mainNode = result.nodes.find((n) => n.label === 'src/main');
    expect(utilsNode?.properties.outDegree).toBe(2);
    expect(utilsNode?.properties.inDegree).toBe(0);
    expect(coreNode?.properties.outDegree).toBe(1);
    expect(coreNode?.properties.inDegree).toBe(1);
    expect(mainNode?.properties.inDegree).toBe(2);
    expect(mainNode?.properties.outDegree).toBe(0);
  });

  it('identifies root nodes (zero in-degree)', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toContain(NodeId('depdir:src/utils'));
    expect(result.metadata.rootIds).not.toContain(NodeId('depdir:src/core'));
  });

  it('computes depth via BFS from roots', () => {
    const nodes = [
      makeNode('a', 'function', 'src/l0/a.ts'),
      makeNode('b', 'function', 'src/l1/b.ts'),
      makeNode('c', 'function', 'src/l2/c.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'b', 'c', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    const l0Node = result.nodes.find((n) => n.label === 'src/l0');
    const l1Node = result.nodes.find((n) => n.label === 'src/l1');
    const l2Node = result.nodes.find((n) => n.label === 'src/l2');
    expect(l0Node?.properties.depth).toBe(0);
    expect(l1Node?.properties.depth).toBe(1);
    expect(l2Node?.properties.depth).toBe(2);
  });

  it('generates UML labels with child count and type summary', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'class', 'src/utils/b.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const utilsNode = result.nodes.find((n) => n.label === 'src/utils');
    const umlLabel = utilsNode?.properties.umlLabel as string;
    expect(umlLabel).toContain('src/utils');
    expect(umlLabel).toContain('2 items');
    expect(umlLabel).toContain('function: 1');
    expect(umlLabel).toContain('class: 1');
  });

  it('handles nodes with root path', () => {
    const nodes = [
      makeNode('a', 'function', 'a.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].label).toBe('root');
  });

  it('handles Windows-style paths', () => {
    const nodes = [
      makeNode('a', 'function', 'src\\utils\\a.ts'),
      makeNode('b', 'function', 'src\\core\\b.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.length).toBe(2);
    expect(result.nodes.some((n) => n.label === 'src/utils')).toBe(true);
    expect(result.nodes.some((n) => n.label === 'src/core')).toBe(true);
  });

  it('handles empty input', () => {
    const result = assembler.assemble([], []);
    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
    expect(result.metadata.maxDepth).toBe(0);
  });

  it('handles nodes with no dependency edges', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'call'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges.length).toBe(0);
    expect(result.metadata.maxDepth).toBe(0);
  });

  it('prefers import type over dependency when both exist', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'a', 'b', 'dependency'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges.length).toBe(1);
    expect(result.edges[0].type).toBe('import');
  });

  it('sets isRoot property on root nodes', () => {
    const nodes = [
      makeNode('a', 'function', 'src/utils/a.ts'),
      makeNode('b', 'function', 'src/core/b.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    const utilsNode = result.nodes.find((n) => n.label === 'src/utils');
    const coreNode = result.nodes.find((n) => n.label === 'src/core');
    expect(utilsNode?.properties.isRoot).toBe(true);
    expect(coreNode?.properties.isRoot).toBe(false);
  });
});