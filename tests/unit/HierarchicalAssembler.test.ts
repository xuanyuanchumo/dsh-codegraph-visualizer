import { describe, it, expect } from 'vitest';
import { HierarchicalAssembler, type HierarchicalAssemblerConfig } from '../../src/client/diagram/HierarchicalAssembler.ts';
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

class TestHierarchicalAssembler extends HierarchicalAssembler {
  protected config: HierarchicalAssemblerConfig = {
    nodePrefix: 'test',
    edgeIdPrefix: 'test-edge',
    isDirProperty: 'isTestDir',
    isEdgeProperty: 'isTestEdge',
    edgeTypes: new Set(['import', 'dependency']),
    getDirectory: (filePath: string) => {
      const parts = filePath.split('/');
      parts.pop();
      return parts.join('/') || '/';
    },
    getLabel: (dir: string) => dir.split('/').pop() || dir,
  };
}

describe('HierarchicalAssembler', () => {
  const assembler = new TestHierarchicalAssembler();

  it('groups nodes by directory into module nodes', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/components/Button.tsx'),
      makeNode('f2', 'module', 'file2', 'src/components/Input.tsx'),
      makeNode('f3', 'module', 'file3', 'src/utils/helpers.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = assembler.assemble(nodes, edges);

    expect(result.nodes).toHaveLength(2);
    const labels = result.nodes.map((n) => n.label);
    expect(labels).toContain('components');
    expect(labels).toContain('utils');
  });

  it('sets directory property on created module nodes', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
    ];
    const result = assembler.assemble(nodes, []);

    expect(result.nodes[0]!.properties.isTestDir).toBe(true);
    expect(result.nodes[0]!.properties.directory).toBe('src/a');
  });

  it('aggregates edges between directories', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.properties.aggregatedCount).toBe(1);
    expect(result.edges[0]!.type).toBe('import');
  });

  it('skips edges within the same directory', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file1.ts'),
      makeNode('f2', 'module', 'file2', 'src/a/file2.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(0);
  });

  it('aggregates multiple edges between same directories', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file1.ts'),
      makeNode('f2', 'module', 'file2', 'src/a/file2.ts'),
      makeNode('f3', 'module', 'file3', 'src/b/file1.ts'),
      makeNode('f4', 'module', 'file4', 'src/b/file2.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f3', 'import'),
      makeEdge('e2', 'f2', 'f4', 'dependency'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.properties.aggregatedCount).toBe(2);
  });

  it('computes depth for directory nodes', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    const nodeA = result.nodes.find((n) => n.properties.directory === 'src/a');
    const nodeB = result.nodes.find((n) => n.properties.directory === 'src/b');
    expect(nodeA?.properties.depth).toBe(0);
    expect(nodeB?.properties.depth).toBe(1);
  });

  it('sets isRoot for nodes with no incoming edges', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    const nodeA = result.nodes.find((n) => n.properties.directory === 'src/a');
    const nodeB = result.nodes.find((n) => n.properties.directory === 'src/b');
    expect(nodeA?.properties.isRoot).toBe(true);
    expect(nodeB?.properties.isRoot).toBe(false);
  });

  it('computes inDegree and outDegree', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
      makeNode('f3', 'module', 'file3', 'src/c/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
      makeEdge('e2', 'f1', 'f3', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    const nodeA = result.nodes.find((n) => n.properties.directory === 'src/a');
    const nodeB = result.nodes.find((n) => n.properties.directory === 'src/b');
    expect(nodeA?.properties.outDegree).toBe(2);
    expect(nodeA?.properties.inDegree).toBe(0);
    expect(nodeB?.properties.inDegree).toBe(1);
    expect(nodeB?.properties.outDegree).toBe(0);
  });

  it('includes childCount and typeDistribution in properties', () => {
    const nodes = [
      makeNode('f1', 'class', 'ClassA', 'src/a/file1.ts'),
      makeNode('f2', 'function', 'funcB', 'src/a/file2.ts'),
    ];

    const result = assembler.assemble(nodes, []);

    const nodeA = result.nodes.find((n) => n.properties.directory === 'src/a');
    expect(nodeA?.properties.childCount).toBe(2);
    expect(nodeA?.properties.typeDistribution).toEqual({ class: 1, function: 1 });
  });

  it('returns correct metadata', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'import'),
    ];

    const result = assembler.assemble(nodes, edges);

    expect(result.metadata.nodeCount).toBe(2);
    expect(result.metadata.edgeCount).toBe(1);
    expect(result.metadata.maxDepth).toBe(1);
    expect(result.metadata.rootIds).toHaveLength(1);
  });

  it('handles empty input', () => {
    const result = assembler.assemble([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.metadata.nodeCount).toBe(0);
    expect(result.metadata.maxDepth).toBe(0);
  });

  it('uses filterNodes when provided', () => {
    class FilteredAssembler extends HierarchicalAssembler {
      protected config: HierarchicalAssemblerConfig = {
        nodePrefix: 'filtered',
        edgeIdPrefix: 'filtered-edge',
        isDirProperty: 'isFilteredDir',
        isEdgeProperty: 'isFilteredEdge',
        edgeTypes: new Set(['import']),
        getDirectory: (filePath: string) => filePath.split('/')[0] || '/',
        getLabel: (dir: string) => dir,
        filterNodes: (nodes: GraphNode[]) => nodes.filter((n) => n.type === 'class'),
      };
    }

    const filteredAssembler = new FilteredAssembler();
    const nodes = [
      makeNode('f1', 'class', 'ClassA', 'src/a/file.ts'),
      makeNode('f2', 'function', 'funcB', 'src/b/file.ts'),
    ];

    const result = filteredAssembler.assemble(nodes, []);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.properties.directory).toBe('src');
  });

  it('uses excludeTypesFromDist to exclude types from distribution', () => {
    class ExcludedAssembler extends HierarchicalAssembler {
      protected config: HierarchicalAssemblerConfig = {
        nodePrefix: 'excluded',
        edgeIdPrefix: 'excluded-edge',
        isDirProperty: 'isExcludedDir',
        isEdgeProperty: 'isExcludedEdge',
        edgeTypes: new Set(['import']),
        getDirectory: (filePath: string) => filePath.split('/')[0] || '/',
        getLabel: (dir: string) => dir,
        excludeTypesFromDist: new Set(['interface']),
      };
    }

    const excludedAssembler = new ExcludedAssembler();
    const nodes = [
      makeNode('f1', 'class', 'ClassA', 'src/a/file.ts'),
      makeNode('f2', 'interface', 'IB', 'src/b/file.ts'),
    ];

    const result = excludedAssembler.assemble(nodes, []);
    const srcNode = result.nodes.find((n) => n.properties.directory === 'src');
    expect(srcNode?.properties.typeDistribution).toEqual({ class: 1 });
  });

  it('sets edge type to dependency when no import type in aggregated set', () => {
    const nodes = [
      makeNode('f1', 'module', 'file1', 'src/a/file.ts'),
      makeNode('f2', 'module', 'file2', 'src/b/file.ts'),
    ];
    const edges = [
      makeEdge('e1', 'f1', 'f2', 'dependency'),
    ];

    const result = assembler.assemble(nodes, edges);
    expect(result.edges[0]!.type).toBe('dependency');
  });

  it('generates umlLabel with child count and type distribution', () => {
    const nodes = [
      makeNode('f1', 'class', 'ClassA', 'src/a/file1.ts'),
      makeNode('f2', 'function', 'funcB', 'src/a/file2.ts'),
    ];

    const result = assembler.assemble(nodes, []);
    const nodeA = result.nodes.find((n) => n.properties.directory === 'src/a');
    expect(nodeA?.properties.umlLabel).toContain('2 items');
    expect(nodeA?.properties.umlLabel).toContain('class: 1');
    expect(nodeA?.properties.umlLabel).toContain('function: 1');
  });
});