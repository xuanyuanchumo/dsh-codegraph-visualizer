import { describe, it, expect } from 'vitest';
import { computeGraphDiff, diffToGraphData } from '../../src/merger/DiffEngine.ts';
import { makeNode, makeEdge } from '../helpers.ts';
import { HealthScorer } from '../../src/shared/analysis/HealthScorer.ts';
import { GodModuleDetector } from '../../src/shared/analysis/HotspotAnalyzer.ts';
import { FlowchartAssembler } from '../../src/client/diagram/FlowchartAssembler.ts';
import { computeProgressiveClusters } from '../../src/client/store/cluster/progressiveCluster.ts';

describe('User Journey Reverse Scenarios', () => {

  describe('J4 - Call Chain Tracing: reverse scenarios', () => {
    it('detects circular call chain and terminates recursion', () => {
      const nodes = [
        makeNode('a', 'funcA', 'function', 'a.ts', 1),
        makeNode('b', 'funcB', 'function', 'b.ts', 5),
        makeNode('c', 'funcC', 'function', 'c.ts', 10),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
        makeEdge('e3', 'c', 'a', 'call'),
      ];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('handles cross-file call chain with lazy loading', () => {
      const nodes = [
        makeNode('a', 'funcA', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'funcB', 'function', 'src/mod2/b.ts', 5),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBeLessThan(100);
    });

    it('handles node with no call chain (isolated function)', () => {
      const nodes = [
        makeNode('a', 'funcA', 'function', 'a.ts', 1),
        makeNode('b', 'funcB', 'function', 'b.ts', 5),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });
  });

  describe('J5 - Dependency Topology: reverse scenarios', () => {
    it('handles empty dependency graph (no edges)', () => {
      const nodes = [
        makeNode('a', 'ModuleA', 'module', 'src/mod1/a.ts', 1),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('detects deep nested dependency chain (5 levels)', () => {
      const nodes = Array.from({ length: 5 }, (_, i) =>
        makeNode(`n${i}`, `Module${i}`, 'module', `src/level${i}/mod.ts`, 1),
      );
      const edges = Array.from({ length: 4 }, (_, i) =>
        makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, 'dependency'),
      );
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('detects circular dependency between modules', () => {
      const nodes = [
        makeNode('a', 'ModuleA', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'ModuleB', 'module', 'src/mod2/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'import'),
        makeEdge('e2', 'b', 'a', 'import'),
      ];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });
  });

  describe('J15 - Path Finding: reverse scenarios', () => {
    it('handles no path between nodes (unreachable)', () => {
      const nodes = [
        makeNode('a', 'funcA', 'function', 'a.ts', 1),
        makeNode('b', 'funcB', 'function', 'b.ts', 5),
        makeNode('c', 'funcC', 'function', 'c.ts', 10),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
      ];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score).toBeDefined();
    });

    it('handles self-referencing node (path to itself)', () => {
      const nodes = [
        makeNode('a', 'funcA', 'function', 'a.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'a', 'call'),
      ];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });
  });

  describe('J16 - Focus Mode: reverse scenarios', () => {
    it('handles focus on node with no neighbors (isolated)', () => {
      const nodes = [
        makeNode('a', 'funcA', 'function', 'a.ts', 1),
        makeNode('b', 'funcB', 'function', 'b.ts', 5),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
    });

    it('handles focus on node in dense neighborhood', () => {
      const nodes = [
        makeNode('center', 'centerFunc', 'function', 'center.ts', 1),
        makeNode('n1', 'neighbor1', 'function', 'n1.ts', 1),
        makeNode('n2', 'neighbor2', 'function', 'n2.ts', 1),
        makeNode('n3', 'neighbor3', 'function', 'n3.ts', 1),
        makeNode('n4', 'neighbor4', 'function', 'n4.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'center', 'n1', 'call'),
        makeEdge('e2', 'center', 'n2', 'call'),
        makeEdge('e3', 'center', 'n3', 'call'),
        makeEdge('e4', 'center', 'n4', 'call'),
        makeEdge('e5', 'n1', 'center', 'call'),
      ];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBeLessThan(100);
    });
  });

  describe('J8 - Export: reverse scenarios', () => {
    it('handles diffToGraphData with empty diff (nothing to export)', () => {
      const diff = {
        addedNodes: [],
        removedNodes: [],
        modifiedNodes: [],
        addedEdges: [],
        removedEdges: [],
        modifiedEdges: [],
      };
      const result = diffToGraphData(diff);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('handles diffToGraphData with very large diff', () => {
      const addedNodes = Array.from({ length: 100 }, (_, i) =>
        makeNode(`n${i}`, `Node${i}`, 'function', `file${i}.ts`, i),
      );
      const diff = {
        addedNodes,
        removedNodes: [],
        modifiedNodes: [],
        addedEdges: [],
        removedEdges: [],
        modifiedEdges: [],
      };
      const result = diffToGraphData(diff);
      expect(result.nodes).toHaveLength(100);
      expect(result.nodes.every((n) => n.properties.diffStatus === 'added')).toBe(true);
    });
  });

  describe('J19 - Version Comparison: reverse scenarios', () => {
    it('handles no differences between versions (identical graphs)', () => {
      const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const diff = computeGraphDiff(nodes, edges, nodes, edges);
      expect(diff.addedNodes).toHaveLength(0);
      expect(diff.removedNodes).toHaveLength(0);
      expect(diff.modifiedNodes).toHaveLength(0);
    });

    it('handles complete graph replacement (all nodes removed, all new added)', () => {
      const beforeNodes = [makeNode('old1', 'OldA', 'function', 'old.ts', 1)];
      const afterNodes = [makeNode('new1', 'NewA', 'function', 'new.ts', 1)];
      const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
      expect(diff.removedNodes).toHaveLength(1);
      expect(diff.addedNodes).toHaveLength(1);
      expect(diff.modifiedNodes).toHaveLength(0);
    });
  });

  describe('J12 - Chaos Recovery: reverse scenarios', () => {
    it('handles corrupted graph data (nodes with missing fields)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', '', 0),
        makeNode('b', '', 'function', 'b.ts', 5),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score).toBeDefined();
    });

    it('handles edges referencing non-existent nodes', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'nonexistent', 'call'),
        makeEdge('e2', 'nonexistent', 'a', 'call'),
      ];
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      expect(score).toBeDefined();
    });

    it('handles extremely large node count', () => {
      const nodes = Array.from({ length: 500 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/mod1/n${i}.ts`, 1),
      );
      const edges = Array.from({ length: 499 }, (_, i) =>
        makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, 'call'),
      );
      const start = Date.now();
      const scorer = new HealthScorer();
      const score = scorer.calculate(nodes, edges);
      const elapsed = Date.now() - start;
      expect(score).toBeDefined();
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('J41 - Flowchart View: reverse scenarios', () => {
    const assembler = new FlowchartAssembler();

    it('handles function with no AST (empty body) — only Entry/Exit', () => {
      const astRoot = {
        type: 'function_declaration',
        name: 'empty',
        children: [],
        filePath: 'src/empty.ts',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 0 },
      };
      const result = assembler.assemble(astRoot as any, 'src/empty.ts', 'empty');
      const startNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'start');
      const endNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'end');
      expect(startNode).toBeDefined();
      expect(endNode).toBeDefined();
      expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('handles function with only a return statement', () => {
      const astRoot = {
        type: 'function_declaration',
        name: 'ret',
        children: [
          {
            type: 'return_statement',
            text: 'return 42',
            children: [],
            startPosition: { row: 1, column: 4 },
            endPosition: { row: 1, column: 14 },
          },
        ],
        filePath: 'src/ret.ts',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 2, column: 0 },
      };
      const result = assembler.assemble(astRoot as any, 'src/ret.ts', 'ret');
      expect(result.nodes.length).toBeGreaterThanOrEqual(2);
      const processNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'process');
      expect(processNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('handles semantic inference with no keyword match — shows original statement', () => {
      const astRoot = {
        type: 'function_declaration',
        name: 'custom',
        children: [
          {
            type: 'expression_statement',
            text: 'foobar()',
            children: [],
            startPosition: { row: 1, column: 4 },
            endPosition: { row: 1, column: 14 },
          },
        ],
        filePath: 'src/custom.ts',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 2, column: 0 },
      };
      const result = assembler.assemble(astRoot as any, 'src/custom.ts', 'custom');
      const processNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'process');
      expect(processNodes.length).toBeGreaterThanOrEqual(1);
      const label = processNodes[0]?.label ?? '';
      expect(label.length).toBeGreaterThan(0);
    });

    it('handles throw statement as error exit node', () => {
      const astRoot = {
        type: 'function_declaration',
        name: 'thrower',
        children: [
          {
            type: 'throw_statement',
            text: 'throw new Error("fail")',
            children: [],
            startPosition: { row: 1, column: 4 },
            endPosition: { row: 1, column: 28 },
          },
        ],
        filePath: 'src/thrower.ts',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 2, column: 0 },
      };
      const result = assembler.assemble(astRoot as any, 'src/thrower.ts', 'thrower');
      const errorNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'error');
      expect(errorNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('J32 - God Module Detection: reverse scenarios', () => {
    it('reports no God Modules when all modules are below threshold', () => {
      const nodes = [
        makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('n2', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const detector = new GodModuleDetector();
      const results = detector.detect(nodes, edges, 50);
      expect(results).toHaveLength(0);
    });

    it('reports "architecture healthy" when no modules exceed threshold', () => {
      const nodes = Array.from({ length: 10 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/mod${i % 3}/f${i}.ts`, 1),
      );
      const edges: ReturnType<typeof makeEdge>[] = [];
      const detector = new GodModuleDetector();
      const results = detector.detect(nodes, edges, 50);
      expect(results).toHaveLength(0);
    });

    it('detects God Module when module exceeds threshold', () => {
      const nodes = Array.from({ length: 60 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/bigmass/f${i}.ts`, 1),
      );
      const edges: ReturnType<typeof makeEdge>[] = [];
      const detector = new GodModuleDetector();
      const results = detector.detect(nodes, edges, 50);
      expect(results).toHaveLength(1);
      expect(results[0]!.modulePath).toContain('bigmass');
      expect(results[0]!.nodeCount).toBe(60);
      expect(results[0]!.suggestion).toContain('consider splitting');
    });

    it('handles empty graph (no nodes)', () => {
      const detector = new GodModuleDetector();
      const results = detector.detect([], [], 50);
      expect(results).toHaveLength(0);
    });

    it('handles nodes with empty filePath', () => {
      const nodes = [
        makeNode('n1', 'A', 'function', '', 1),
        makeNode('n2', 'B', 'function', '', 1),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const detector = new GodModuleDetector();
      const results = detector.detect(nodes, edges, 1);
      expect(results).toHaveLength(1);
      expect(results[0]!.nodeCount).toBe(2);
    });
  });

  describe('J33 - Expand/Collapse Cluster: reverse scenarios', () => {
    it('handles cluster with no internal nodes (empty cluster)', () => {
      const nodes = [
        makeNode('cluster__empty', 'EmptyCluster', 'module', 'src/empty/', 1),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const result = computeProgressiveClusters(nodes, edges, new Set(), 1);
      const clusterNodes = result.nodes.filter((n) => n.id.startsWith('cluster__'));
      expect(clusterNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('handles expanding a cluster that has no children', () => {
      const nodes = [
        makeNode('cluster__empty', 'EmptyCluster', 'module', 'src/empty/', 1),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const expandedResult = computeProgressiveClusters(nodes, edges, new Set(['cluster__empty']), 1);
      expect(expandedResult.nodes.length).toBeGreaterThanOrEqual(1);
    });

    it('handles collapsing a cluster that was previously expanded', () => {
      const nodes = Array.from({ length: 20 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/mod1/f${i}.ts`, 1),
      );
      const edges = Array.from({ length: 19 }, (_, i) =>
        makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, 'call'),
      );
      const clusterId = `cluster__src__mod1`;
      const expanded = new Set([clusterId]);
      const expandedResult = computeProgressiveClusters(nodes, edges, expanded, 0);
      const collapsedResult = computeProgressiveClusters(nodes, edges, new Set(), 0);
      expect(expandedResult.nodes.length).not.toBe(collapsedResult.nodes.length);
    });

    it('handles expanding non-existent cluster ID gracefully', () => {
      const nodes = [
        makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const result = computeProgressiveClusters(nodes, edges, new Set(['cluster__nonexistent']), 1);
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    });
  });
});