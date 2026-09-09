import { describe, it, expect } from 'vitest';
import { InheritanceAssembler } from '../../src/client/diagram/InheritanceAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], label: string): GraphNode {
  return {
    id: NodeId(id),
    label,
    type,
    filePath: `src/${id}.ts`,
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

describe('InheritanceAssembler', () => {
  const assembler = new InheritanceAssembler();

  it('filters to class/interface/type nodes only', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'interface', 'IFaceB'),
      makeNode('C', 'function', 'funcC'),
      makeNode('D', 'variable', 'varD'),
      makeNode('E', 'type', 'TypeE'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map((n) => n.id)).toEqual(['A', 'B', 'E']);
  });

  it('filters to extend/implement edges only', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('C', 'class', 'ClassC'),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'A', 'implement'),
      makeEdge('e3', 'C', 'B', 'call'),
      makeEdge('e4', 'B', 'A', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(2);
    expect(result.edges.map((e) => e.type)).toEqual(['extend', 'implement']);
  });

  it('identifies root classes (no parent)', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('C', 'class', 'ClassC'),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'A', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toEqual(['A']);
  });

  it('computes inheritance depth', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('C', 'class', 'ClassC'),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'B', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    const depthA = result.nodes.find((n) => n.id === 'A')?.properties.depth;
    const depthB = result.nodes.find((n) => n.id === 'B')?.properties.depth;
    const depthC = result.nodes.find((n) => n.id === 'C')?.properties.depth;

    expect(depthA).toBe(0);
    expect(depthB).toBe(1);
    expect(depthC).toBe(2);
    expect(result.metadata.maxDepth).toBe(2);
  });

  it('computes descendant counts', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('C', 'class', 'ClassC'),
      makeNode('D', 'class', 'ClassD'),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'A', 'extend'),
      makeEdge('e3', 'D', 'B', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    const descA = result.nodes.find((n) => n.id === 'A')?.properties.descendantCount;
    const descB = result.nodes.find((n) => n.id === 'B')?.properties.descendantCount;
    const descC = result.nodes.find((n) => n.id === 'C')?.properties.descendantCount;

    expect(descA).toBe(3);
    expect(descB).toBe(1);
    expect(descC).toBe(0);
  });

  it('sets isRoot property correctly', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isRoot).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isRoot).toBe(false);
  });

  it('handles multiple roots (forest)', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('C', 'interface', 'IFaceC'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toHaveLength(3);
    expect(result.metadata.maxDepth).toBe(0);
  });

  it('handles multiple inheritance', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'interface', 'IFaceB'),
      makeNode('C', 'class', 'ClassC'),
    ];
    const edges = [
      makeEdge('e1', 'C', 'A', 'extend'),
      makeEdge('e2', 'C', 'B', 'implement'),
    ];

    const result = assembler.assemble(nodes, edges);

    const nodeC = result.nodes.find((n) => n.id === 'C');
    expect(nodeC?.properties.parentCount).toBe(2);
    expect(result.metadata.rootIds).toEqual(['A', 'B']);
  });

  it('filters out edges with dangling references', () => {
    const nodes = [makeNode('A', 'class', 'ClassA')];
    const edges = [
      makeEdge('e1', 'A', 'Missing', 'extend'),
      makeEdge('e2', 'Missing', 'A', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(0);
  });

  it('computes childCount for each node', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('C', 'class', 'ClassC'),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'A', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.childCount).toBe(2);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.childCount).toBe(0);
  });
});