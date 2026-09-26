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

  it('marks node as abstract when isAbstract property is true', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA'),
      makeNode('B', 'class', 'ClassB'),
    ];
    // Set isAbstract property on node A
    nodes[0]!.properties = { isAbstract: true };
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isAbstract).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isAbstract).toBe(false);
  });

  it('marks class as abstract when name matches I[A-Z][a-z] pattern', () => {
    const nodes = [
      makeNode('IController', 'class', 'IController'),
      makeNode('Regular', 'class', 'Regular'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'IController')?.properties.isAbstract).toBe(true);
    expect(result.nodes.find((n) => n.id === 'Regular')?.properties.isAbstract).toBe(false);
  });

  it('marks class as abstract when name starts with Abstract[A-Z]', () => {
    const nodes = [
      makeNode('AbstractBase', 'class', 'AbstractBase'),
      makeNode('NotAbstract', 'class', 'NotAbstract'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'AbstractBase')?.properties.isAbstract).toBe(true);
    expect(result.nodes.find((n) => n.id === 'NotAbstract')?.properties.isAbstract).toBe(false);
  });

  it('marks interface as abstract', () => {
    const nodes = [
      makeNode('IFace', 'interface', 'IFace'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'IFace')?.properties.isAbstract).toBe(true);
  });

  it('sets umlLabel with interface stereotype', () => {
    const nodes = [
      makeNode('IFace', 'interface', 'IFace'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const ifaceNode = result.nodes.find((n) => n.id === 'IFace');
    expect(ifaceNode?.properties.umlLabel).toContain('«interface»');
    expect(ifaceNode?.properties.umlLabel).toContain('IFace');
  });

  it('sets umlLabel without stereotype for class', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    expect(classNode?.properties.umlLabel).toBe('ClassA');
    expect(classNode?.properties.umlLabel).not.toContain('«interface»');
  });

  it('computes descendant counts with cycle detection', () => {
    // Create a cycle with a root: C is root, B extends C, A extends B, B extends A
    // This triggers the visited.has(id) cycle detection branch in computeDescendantCounts
    const nodes = [
      makeNode('C', 'class', 'ClassC'),
      makeNode('B', 'class', 'ClassB'),
      makeNode('A', 'class', 'ClassA'),
    ];
    const edges = [
      makeEdge('e1', 'B', 'C', 'extend'),
      makeEdge('e2', 'A', 'B', 'extend'),
      makeEdge('e3', 'B', 'A', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    // C is root (no outgoing edges), so descendant counts should be computed
    const descC = result.nodes.find((n) => n.id === 'C')?.properties.descendantCount;
    expect(descC).toBeDefined();
    // Should not infinite loop - cycle detection prevents it
  });

  it('sets parentCount and childCount for multiple inheritance', () => {
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
    expect(nodeC?.properties.childCount).toBe(0);
  });

  it('handles type nodes in inheritance graph', () => {
    const nodes = [
      makeNode('TypeA', 'type', 'TypeA'),
      makeNode('TypeB', 'type', 'TypeB'),
    ];
    const edges = [
      makeEdge('e1', 'TypeB', 'TypeA', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes).toHaveLength(2);
    expect(result.metadata.rootIds).toEqual(['TypeA']);
  });
});