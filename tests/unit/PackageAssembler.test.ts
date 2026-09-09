import { describe, it, expect } from 'vitest';
import { PackageAssembler } from '../../src/client/diagram/PackageAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], label: string, filePath: string): GraphNode {
  return {
    id: NodeId(id),
    label,
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

describe('PackageAssembler', () => {
  const assembler = new PackageAssembler();

  it('creates package nodes from module nodes grouped by directory', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/components/Input.tsx'),
      makeNode('f3', 'module', 'file3', 'src/utils/helpers.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes).toHaveLength(2);
    const dirs = result.nodes.map((n) => n.properties.directory);
    expect(dirs).toContain('src/components');
    expect(dirs).toContain('src/utils');
  });

  it('sets isPackage property on package nodes', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes[0]?.properties.isPackage).toBe(true);
  });

  it('counts child files per package', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/components/Input.tsx'),
      makeNode('f3', 'module', 'file3', 'src/components/Modal.tsx'),
      makeNode('f4', 'module', 'file4', 'src/utils/helpers.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const componentsPkg = result.nodes.find((n) => n.properties.directory === 'src/components');
    const utilsPkg = result.nodes.find((n) => n.properties.directory === 'src/utils');
    expect(componentsPkg?.properties.childCount).toBe(3);
    expect(utilsPkg?.properties.childCount).toBe(1);
  });

  it('aggregates import edges between packages', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/utils/helpers.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.properties.aggregatedCount).toBe(1);
  });

  it('aggregates multiple import edges into single package edge', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/components/Input.tsx'),
      makeNode('f3', 'module', 'file3', 'src/utils/helpers.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f3', 'import'),
      makeEdge('e2', 'f2', 'f3', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.properties.aggregatedCount).toBe(2);
  });

  it('skips import edges within the same package', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/components/Input.tsx'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(0);
  });

  it('computes inDegree and outDegree for packages', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
      makeNode('f3', 'module', 'file3', 'src/c/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
      makeEdge('e2', 'f1', 'f3', 'import'),
      makeEdge('e3', 'f2', 'f3', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    const pkgA = result.nodes.find((n) => n.properties.directory === 'src/a');
    const pkgB = result.nodes.find((n) => n.properties.directory === 'src/b');
    const pkgC = result.nodes.find((n) => n.properties.directory === 'src/c');

    expect(pkgA?.properties.outDegree).toBe(2);
    expect(pkgA?.properties.inDegree).toBe(0);
    expect(pkgB?.properties.outDegree).toBe(1);
    expect(pkgB?.properties.inDegree).toBe(1);
    expect(pkgC?.properties.outDegree).toBe(0);
    expect(pkgC?.properties.inDegree).toBe(2);
  });

  it('identifies root packages (no incoming edges)', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.rootIds).toHaveLength(1);
    expect(result.metadata.rootIds[0]).toContain('src/a');
  });

  it('computes type distribution for non-module nodes', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('cls1', 'class', 'Button', 'src/components/Button.tsx'),
      makeNode('fn1', 'function', 'handleClick', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/utils/helpers.ts'),
      makeNode('fn2', 'function', 'formatDate', 'src/utils/helpers.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    const componentsPkg = result.nodes.find((n) => n.properties.directory === 'src/components');
    const utilsPkg = result.nodes.find((n) => n.properties.directory === 'src/utils');

    expect(componentsPkg?.properties.typeDistribution).toEqual({ class: 1, function: 1 });
    expect(utilsPkg?.properties.typeDistribution).toEqual({ function: 1 });
  });

  it('handles empty input', () => {
    const result = assembler.assemble([], []);

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.metadata.rootIds).toHaveLength(0);
  });
});