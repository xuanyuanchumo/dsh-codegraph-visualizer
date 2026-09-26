import { describe, it, expect } from 'vitest';
import { ClassAssembler } from '../../src/client/diagram/ClassAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], label: string, filePath: string, lineNumber: number, properties: Record<string, unknown> = {}): GraphNode {
  return {
    id: NodeId(id),
    label,
    type,
    filePath,
    lineNumber,
    properties,
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

  it('associates members by parentId when available', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('method1', 'function', 'method1', 'src/a.ts', 10),
    ];
    // Set parentId on method1 to point to ClassA
    nodes[1]!.parentId = NodeId('ClassA');
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    expect(classNode?.properties.methodCount).toBe(1);
    expect(classNode?.properties.members).toHaveLength(1);
  });

  it('infers protected visibility for _ prefixed members', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('_method', 'function', '_method', 'src/a.ts', 10),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const members = classNode?.properties.members as Array<{ visibility: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.visibility).toBe('protected');
  });

  it('infers private visibility for __ prefixed members', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('__private', 'function', '__private', 'src/a.ts', 10),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const members = classNode?.properties.members as Array<{ visibility: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.visibility).toBe('private');
  });

  it('infers public visibility for exported members with isExported=1', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('exportedFn', 'function', 'exportedFn', 'src/a.ts', 10, { isExported: 1 }),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const members = classNode?.properties.members as Array<{ visibility: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.visibility).toBe('public');
  });

  it('infers private visibility for non-exported members', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('internalFn', 'function', 'internalFn', 'src/a.ts', 10),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const members = classNode?.properties.members as Array<{ visibility: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.visibility).toBe('private');
  });

  it('includes member signatures in memberSignatures', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('method1', 'function', 'method1', 'src/a.ts', 10, { signature: '(x: number)' }),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const members = classNode?.properties.members as Array<{ signature?: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]?.signature).toBe('(x: number)');
  });

  it('builds umlLabel with interface stereotype', () => {
    const nodes = [
      makeNode('IFace', 'interface', 'IFace', 'src/a.ts', 1),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const ifaceNode = result.nodes.find((n) => n.id === 'IFace');
    expect(ifaceNode?.properties.umlLabel).toContain('«interface»');
    expect(ifaceNode?.properties.umlLabel).toContain('IFace');
  });

  it('builds umlLabel with property and method sections', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('_prop', 'variable', '_prop', 'src/a.ts', 8),
      makeNode('method1', 'function', 'method1', 'src/a.ts', 10),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const umlLabel = classNode?.properties.umlLabel as string;
    // Should contain separator, property line with # (protected), method line
    expect(umlLabel).toContain('#');
    expect(umlLabel).toContain('_prop');
    expect(umlLabel).toContain('method1');
  });

  it('builds umlLabel with public and private visibility markers', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('pubMethod', 'function', 'pubMethod', 'src/a.ts', 10, { isExported: true }),
      makeNode('__privMethod', 'function', '__privMethod', 'src/a.ts', 15),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const umlLabel = classNode?.properties.umlLabel as string;
    expect(umlLabel).toContain('+');
    expect(umlLabel).toContain('-');
    expect(umlLabel).toContain('pubMethod');
    expect(umlLabel).toContain('__privMethod');
  });

  it('marks interface as abstract', () => {
    const nodes = [
      makeNode('IFace', 'interface', 'IFace', 'src/a.ts', 1),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'IFace')?.properties.isAbstract).toBe(true);
  });

  it('does not mark regular class as abstract', () => {
    const nodes = [
      makeNode('Regular', 'class', 'Regular', 'src/a.ts', 1),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'Regular')?.properties.isAbstract).toBe(false);
  });

  it('associates properties (variable members) to classes', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('prop1', 'variable', 'prop1', 'src/a.ts', 8),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    expect(classNode?.properties.propertyCount).toBe(1);
    expect(classNode?.properties.methodCount).toBe(0);
  });

  it('limits memberSignatures to 10 entries', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
    ];
    // Add 12 function members
    for (let i = 0; i < 12; i++) {
      nodes.push(makeNode(`m${i}`, 'function', `m${i}`, 'src/a.ts', 10 + i));
    }
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const members = classNode?.properties.members as unknown[];
    expect(members).toHaveLength(10);
  });

  it('skips member nodes whose type is in CLASS_NODE_TYPES', () => {
    // A 'class' type node should not be associated as a member of another class
    const nodes = [
      makeNode('Outer', 'class', 'Outer', 'src/a.ts', 5),
      makeNode('Inner', 'class', 'Inner', 'src/a.ts', 10),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const outerNode = result.nodes.find((n) => n.id === 'Outer');
    expect(outerNode?.properties.methodCount).toBe(0);
    expect(outerNode?.properties.propertyCount).toBe(0);
  });

  it('sets isRoot to false for class with outgoing extend edge', () => {
    const nodes = [
      makeNode('A', 'class', 'ClassA', 'src/a.ts', 1),
      makeNode('B', 'class', 'ClassB', 'src/b.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes.find((n) => n.id === 'A')?.properties.isRoot).toBe(true);
    expect(result.nodes.find((n) => n.id === 'B')?.properties.isRoot).toBe(false);
  });

  it('builds umlLabel with property signature when available', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('prop1', 'variable', 'prop1', 'src/a.ts', 8, { signature: 'string' }),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const umlLabel = classNode?.properties.umlLabel as string;
    // Property line should contain ': string' suffix when signature is present
    expect(umlLabel).toContain(': string');
    expect(umlLabel).toContain('prop1');
  });

  it('builds umlLabel with method signature in parentheses', () => {
    const nodes = [
      makeNode('ClassA', 'class', 'ClassA', 'src/a.ts', 5),
      makeNode('method1', 'function', 'method1', 'src/a.ts', 10, { signature: 'x: number, y: string' }),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const classNode = result.nodes.find((n) => n.id === 'ClassA');
    const umlLabel = classNode?.properties.umlLabel as string;
    // Method line should contain signature in parentheses
    expect(umlLabel).toContain('method1(x: number, y: string)');
  });
});