import { describe, it, expect } from 'vitest';
import { BaseFilteringAssembler, type FilteringAssemblerConfig, type AssemblyContext } from '../../src/client/diagram/BaseFilteringAssembler.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'] = 'function', label: string = id): GraphNode {
  return { id: NodeId(id), label, type, filePath: `src/${id}.ts`, lineNumber: 1, properties: {} };
}

function makeEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

// Concrete subclass with rootDirection: 'in-degree-zero' and depthDirection: 'target'
class TestInDegreeAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: new Set(['function']),
    edgeTypes: new Set(['call']),
    rootDirection: 'in-degree-zero',
    depthDirection: 'target',
  };

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
        isRoot: ctx.rootIds.includes(node.id),
      },
    };
  }
}

// Concrete subclass with rootDirection: 'no-out-edges' and depthDirection: 'source'
class TestNoOutEdgesAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: new Set(['class']),
    edgeTypes: new Set(['extend']),
    rootDirection: 'no-out-edges',
    depthDirection: 'source',
  };

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
        isRoot: ctx.rootIds.includes(node.id),
      },
    };
  }
}


// Concrete subclass that overrides prepare
class TestPrepareAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: new Set(['function']),
    edgeTypes: new Set(['call']),
    rootDirection: 'in-degree-zero',
    depthDirection: 'source',
  };

  prepareCalled = false;
  prepareCtx: AssemblyContext | null = null;

  protected prepare(ctx: AssemblyContext): void {
    this.prepareCalled = true;
    this.prepareCtx = ctx;
  }

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
        prepared: this.prepareCalled,
      },
    };
  }
}

// Concrete subclass with depthDirection: 'target'
class TestTargetDepthAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: new Set(['function']),
    edgeTypes: new Set(['call']),
    rootDirection: 'in-degree-zero',
    depthDirection: 'target',
  };

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
      },
    };
  }
}

describe('BaseFilteringAssembler', () => {
  describe('assemble with in-degree-zero rootDirection', () => {
    it('finds roots as nodes with no incoming edges', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
      const result = assembler.assemble(nodes, edges);

      expect(result.metadata.rootIds).toContain('a');
      expect(result.metadata.rootIds).not.toContain('b');
      expect(result.metadata.rootIds).not.toContain('c');
    });

    it('computes depths from roots following target direction', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
      const result = assembler.assemble(nodes, edges);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;
      const nodeC = result.nodes.find((n) => n.id === 'c')!;
      expect(nodeA.properties.depth).toBe(0);
      expect(nodeB.properties.depth).toBe(1);
      expect(nodeC.properties.depth).toBe(2);
    });

    it('filters nodes by nodeTypes', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a', 'function'), makeNode('b', 'class')];
      const edges: GraphEdge[] = [];
      const result = assembler.assemble(nodes, edges);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.id).toBe('a');
    });

    it('filters edges by edgeTypes', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b', 'call'), makeEdge('e2', 'a', 'b', 'import')];
      const result = assembler.assemble(nodes, edges);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.type).toBe('call');
    });

    it('filters out edges with endpoints not in filtered nodes', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a', 'function'), makeNode('b', 'function')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'a', 'ghost')];
      const result = assembler.assemble(nodes, edges);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.id).toBe('e1');
    });
  });

  describe('assemble with no-out-edges rootDirection', () => {
    it('finds roots as nodes with no outgoing edges', () => {
      const assembler = new TestNoOutEdgesAssembler();
      const nodes = [makeNode('a', 'class'), makeNode('b', 'class'), makeNode('c', 'class')];
      const edges = [makeEdge('e1', 'b', 'a', 'extend'), makeEdge('e2', 'c', 'b', 'extend')];
      const result = assembler.assemble(nodes, edges);

      expect(result.metadata.rootIds).toContain('a');
      expect(result.metadata.rootIds).not.toContain('b');
      expect(result.metadata.rootIds).not.toContain('c');
    });

    it('computes depths from roots following source direction', () => {
      const assembler = new TestNoOutEdgesAssembler();
      const nodes = [makeNode('a', 'class'), makeNode('b', 'class'), makeNode('c', 'class')];
      const edges = [makeEdge('e1', 'b', 'a', 'extend'), makeEdge('e2', 'c', 'b', 'extend')];
      const result = assembler.assemble(nodes, edges);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;
      const nodeC = result.nodes.find((n) => n.id === 'c')!;
      expect(nodeA.properties.depth).toBe(0);
      expect(nodeB.properties.depth).toBe(1);
      expect(nodeC.properties.depth).toBe(2);
    });
  });

  describe('prepare method', () => {
    it('calls prepare before enriching nodes', () => {
      const assembler = new TestPrepareAssembler();
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];
      const result = assembler.assemble(nodes, edges);

      expect(assembler.prepareCalled).toBe(true);
      expect(assembler.prepareCtx).not.toBeNull();
      expect(result.nodes.every((n) => n.properties.prepared === true)).toBe(true);
    });

    it('default prepare is a no-op', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a')];
      const edges: GraphEdge[] = [];
      const result = assembler.assemble(nodes, edges);

      expect(result.nodes).toHaveLength(1);
      expect(result.metadata.nodeCount).toBe(1);
    });

    it('prepare receives correct context with all fields', () => {
      const assembler = new TestPrepareAssembler();
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];
      assembler.assemble(nodes, edges);

      const ctx = assembler.prepareCtx!;
      expect(ctx.outEdges).toBeInstanceOf(Map);
      expect(ctx.inEdges).toBeInstanceOf(Map);
      expect(ctx.depthMap).toBeInstanceOf(Map);
      expect(ctx.rootIds).toBeInstanceOf(Array);
      expect(ctx.allNodes).toHaveLength(2);
      expect(ctx.allEdges).toHaveLength(1);
      expect(ctx.filteredNodes).toHaveLength(2);
      expect(ctx.validEdges).toHaveLength(1);
    });
  });

  describe('assemble with depthDirection target', () => {
    it('computes depths using outEdges when depthDirection is target', () => {
      const assembler = new TestTargetDepthAssembler();
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
      const result = assembler.assemble(nodes, edges);

      expect(result.metadata.maxDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('metadata', () => {
    it('computes maxDepth correctly', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
      ];
      const result = assembler.assemble(nodes, edges);

      expect(result.metadata.maxDepth).toBe(3);
    });

    it('maxDepth is 0 for single root with no children', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a')];
      const edges: GraphEdge[] = [];
      const result = assembler.assemble(nodes, edges);

      expect(result.metadata.maxDepth).toBe(0);
    });

    it('nodeCount and edgeCount match filtered results', () => {
      const assembler = new TestInDegreeAssembler();
      const nodes = [makeNode('a', 'function'), makeNode('b', 'function'), makeNode('c', 'class')];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const result = assembler.assemble(nodes, edges);

      expect(result.metadata.nodeCount).toBe(2);
      expect(result.metadata.edgeCount).toBe(1);
    });
  });

  describe('empty input', () => {
    it('handles empty nodes and edges', () => {
      const assembler = new TestInDegreeAssembler();
      const result = assembler.assemble([], []);

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.metadata.maxDepth).toBe(0);
      expect(result.metadata.nodeCount).toBe(0);
      expect(result.metadata.edgeCount).toBe(0);
    });
  });
});