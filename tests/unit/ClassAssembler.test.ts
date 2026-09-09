import { describe, it, expect } from 'vitest';
import { ClassAssembler } from '../../src/client/diagram/ClassAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], label: string, filePath: string, lineNumber: number): GraphNode {
  return {
    id: NodeId(id),
    label,
    type,
    filePath,
    lineNumber,
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

describe('ClassAssembler', () => {
  const assembler = new ClassAssembler();

  it('filters to class/interface/type nodes only', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'interface', 'IFaceB', 'src/b.ts', 1),
      makeNode('C', 'function', 'funcC', 'src/c.ts', 1),
      makeNode('D', 'variable', 'varD', 'src/d.ts', 1),
      makeNode('E', 'type', 'TypeE', 'src/e.ts', 1),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map((n) => n.id)).toEqual(['A', 'B', 'E']);
  });

  it('filters to extend/implement edges only', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'class', 'ClassB', 'src/b.ts', 1),
      makeNode('C', 'class', 'ClassC', 'src/c.ts', 1),
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

  it('identifies root classes (no outgoing extend/implement edges)', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'class', 'ClassB', 'src/b.ts', 1),
      makeNode('C', 'class', 'ClassC', 'src/c.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'A', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toEqual(['A']);
  });

  it('computes inheritance depth via BFS', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'class', 'ClassB', 'src/b.ts', 1),
      makeNode('C', 'class', 'ClassC', 'src/c.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'B', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.depth).toBe(0);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.depth).toBe(1);
    expect(result.nodes.find((n) => n.id === 'C')?.properties.depth).toBe(2);
    expect(result.metadata.maxDepth).toBe(2);
  });

  it('sets isRoot property correctly', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'class', 'ClassB', 'src/b.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isRoot).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isRoot).toBe(false);
  });

  it('associates methods to classes by file_path + start_line proximity', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('method1', 'function', 'method1', 'src/a.ts', 10),
      makeNode('method2', 'function', 'method2', 'src/a.ts', 20),
      makeNode('prop1', 'variable', 'prop1', 'src/a.ts', 8),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    expect(classNode?.properties.methodCount).toBe(2);
    expect(classNode?.properties.propertyCount).toBe(1);
    expect(classNode?.properties.members).toHaveLength(3);
  });

  it('does not associate members from different files', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('method1', 'function', 'method1', 'src/b.ts', 10),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    expect(classNode?.properties.methodCount).toBe(0);
  });

  it('computes parentCount and childCount', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'interface', 'IFaceB', 'src/b.ts', 1),
      makeNode('C', 'class', 'ClassC', 'src/c.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'C', 'A', 'extend'),
      makeEdge('e2', 'C', 'B', 'implement'),
    ];

    const result = assembler.assemble(nodes, edges);

    const nodeC = result.nodes.find((n) => n.id === 'C');
    expect(nodeC?.properties.parentCount).toBe(2);
    expect(nodeC?.properties.childCount).toBe(0);

    const nodeA = result.nodes.find((n) => n.id === 'A');
    expect(nodeA?.properties.parentCount).toBe(0);
    expect(nodeA?.properties.childCount).toBe(1);
  });

  it('filters out edges with dangling references', () => {
    const nodes = [makeNode('A', 'class', 'ClassA', 'src/a.ts', 1)];
    const edges = [
      makeEdge('e1', 'A', 'Missing', 'extend'),
      makeEdge('e2', 'Missing', 'A', 'extend'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(0);
  });

  it('marks abstract classes with isAbstract', () => {
    const nodes = [
      makeNode('A', 'class', 'AbstractClassA', 'src/a.ts', 1),
      makeNode('B', 'class', 'ClassB', 'src/b.ts', 1),
      makeNode('C', 'interface', 'IFaceC', 'src/c.ts', 1),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isAbstract).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isAbstract).toBe(false);
    expect(result.nodes.find((n) => n.id === 'C')?.properties.isAbstract).toBe(true);
  });

  it('handles empty input', () => {
    const result = assembler.assemble([], []);

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.metadata.maxDepth).toBe(0);
  });
});