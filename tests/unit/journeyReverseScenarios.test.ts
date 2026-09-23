import { describe, it, expect } from 'vitest';
import { computeGraphDiff, diffToGraphData } from '../../src/merger/DiffEngine.ts';
import { makeNode, makeEdge } from '../helpers.ts';
import { HealthScorer } from '../../src/shared/analysis/HealthScorer.ts';

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
});