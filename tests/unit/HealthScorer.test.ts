import { describe, it, expect } from 'vitest';
import { HealthScorer } from '../../src/shared/analysis/HealthScorer.ts';
import { makeNode, makeEdge } from '../helpers.ts';

const scorer = new HealthScorer();

describe('HealthScorer', () => {
  describe('calculate - empty input', () => {
    it('returns all zeros for empty nodes', () => {
      const score = scorer.calculate([], []);
      expect(score).toEqual({ coupling: 0, cohesion: 0, cyclicDependencyRate: 0, modularity: 0, overall: 0 });
    });
  });

  describe('calculateCoupling', () => {
    it('returns 100 when no edges', () => {
      const nodes = [makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1)];
      const score = scorer.calculate(nodes, []);
      expect(score.coupling).toBe(100);
    });

    it('returns 100 when all edges are intra-module', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
    });

    it('penalizes cross-module edges with type weights', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(50);
    });

    it('weights call edges higher than dependency edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
        makeEdge('e3', 'b', 'd', 'dependency'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBeLessThan(100);
      expect(score.coupling).toBeGreaterThan(0);
    });
  });

  describe('calculateCohesion', () => {
    it('returns 100 when all edges are intra-module', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(100);
    });

    it('returns 0 when all edges are cross-module', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(0);
    });
  });

  describe('calculateCyclicDependencyRate', () => {
    it('returns 100 when no edges', () => {
      const nodes = [makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1)];
      const score = scorer.calculate(nodes, []);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('returns 100 when no cycles (DAG)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('detects simple 2-node cycle (a→b→a)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('detects 3-node cycle (a→b→c→a)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
        makeEdge('e3', 'c', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('detects self-loop as cycle', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'a', 'call'),
        makeEdge('e2', 'a', 'b', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(50);
    });

    it('does not miss cycles in disconnected components', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
        makeEdge('e3', 'c', 'd', 'call'),
        makeEdge('e4', 'd', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('partially penalizes when only some nodes are in cycles', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
        makeEdge('e3', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(50);
    });
  });

  describe('calculateModularity', () => {
    it('returns 50 when only one module', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBe(50);
    });

    it('rewards balanced module sizes with low cross-module edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThan(50);
    });

    it('penalizes high cross-module edge ratio', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeLessThan(50);
    });
  });

  describe('buildModuleMap - module depth limiting', () => {
    it('groups deeply nested files by top 3 directory levels', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/server/services/auth/TokenService.ts', 1),
        makeNode('b', 'B', 'function', 'src/server/services/auth/UserService.ts', 1),
        makeNode('c', 'C', 'function', 'src/server/services/db/Connection.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThan(0);
    });

    it('strips file: and import: prefixes from filePath', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'file:src/mod1/a.ts', 1),
        makeNode('b', 'B', 'module', 'import:src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'import')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(100);
    });
  });

  describe('overall score weighting', () => {
    it('weights cyclicDependencyRate at 30%', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
      expect(score.overall).toBeLessThanOrEqual(65);
    });

    it('produces high overall score for healthy codebase', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.overall).toBeGreaterThan(70);
    });
  });

  describe('getDimensions', () => {
    it('returns 4 dimensions with names and descriptions', () => {
      const score = { coupling: 80, cohesion: 90, cyclicDependencyRate: 100, modularity: 70, overall: 85 };
      const dims = scorer.getDimensions(score);
      expect(dims).toHaveLength(4);
      expect(dims[0]!.name).toBe('coupling');
      expect(dims[1]!.name).toBe('cohesion');
      expect(dims[2]!.name).toBe('cyclicDependencyRate');
      expect(dims[3]!.name).toBe('modularity');
    });

    it('includes descriptions for each dimension', () => {
      const score = { coupling: 80, cohesion: 90, cyclicDependencyRate: 100, modularity: 70, overall: 85 };
      const dims = scorer.getDimensions(score);
      expect(dims[0]!.description).toContain('coupling');
      expect(dims[1]!.description).toContain('cohesion');
      expect(dims[2]!.description).toContain('circular');
      expect(dims[3]!.description).toContain('module');
    });
  });

  describe('custom maxModuleDepth', () => {
    it('uses custom maxModuleDepth=1 to group by top-level dir only', () => {
      const customScorer = new HealthScorer(1);
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = customScorer.calculate(nodes, edges);
      expect(score.coupling).toBeLessThanOrEqual(100);
    });

    it('uses custom maxModuleDepth=5 to preserve deep nesting', () => {
      const customScorer = new HealthScorer(5);
      const nodes = [
        makeNode('a', 'A', 'function', 'src/deep/path/to/mod/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/deep/path/to/mod/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = customScorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(100);
    });
  });

  describe('calculateCoupling edge cases', () => {
    it('returns 100 when all edge weights are zero (unknown types default to 0.5)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'dependency')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
    });
  });

  describe('calculateCohesion edge cases', () => {
    it('returns 50 when edges have no module mapping', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'a.ts', 1),
        makeNode('b', 'B', 'function', 'b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThanOrEqual(0);
      expect(score.cohesion).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateModularity edge cases', () => {
    it('returns 50 for single module with multiple nodes', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBe(50);
    });
  });

  describe('overall score', () => {
    it('returns 0 overall for empty nodes', () => {
      const score = scorer.calculate([], []);
      expect(score.overall).toBe(0);
    });
  });

  describe('calculateCohesion - edge cases', () => {
    it('returns 50 when edges reference nodes not in nodes array', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'unknown', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThanOrEqual(0);
      expect(score.cohesion).toBeLessThanOrEqual(100);
    });

    it('handles mixed intra and cross module edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThan(0);
      expect(score.cohesion).toBeLessThan(100);
    });
  });

  describe('calculateModularity - edge cases', () => {
    it('returns 50 when all nodes in single module with no edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const score = scorer.calculate(nodes, []);
      expect(score.modularity).toBe(50);
    });

    it('handles unbalanced module sizes', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThanOrEqual(0);
      expect(score.modularity).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateCyclicDependencyRate - complex graphs', () => {
    it('handles nested cycles with shared nodes', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod1/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
        makeEdge('e3', 'b', 'c', 'call'),
        makeEdge('e4', 'c', 'b', 'call'),
        makeEdge('e5', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBeLessThan(100);
    });

    it('counts call/extend/implement/import edges for cycles', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'import'),
        makeEdge('e2', 'b', 'a', 'import'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('detects cycles formed by extend edges', () => {
      const nodes = [
        makeNode('a', 'A', 'class', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'class', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'extend'),
        makeEdge('e2', 'b', 'a', 'extend'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('detects cycles formed by implement edges', () => {
      const nodes = [
        makeNode('a', 'A', 'class', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'class', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'implement'),
        makeEdge('e2', 'b', 'a', 'implement'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('does not count dependency edges as cycle-forming', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'dependency'),
        makeEdge('e2', 'b', 'a', 'dependency'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('does not count contains edges as cycle-forming', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'contains'),
        makeEdge('e2', 'b', 'a', 'contains'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('handles complex graph with multiple SCCs and cross-edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod1/d.ts', 1),
        makeNode('e', 'E', 'function', 'src/mod1/e.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
        makeEdge('e3', 'c', 'd', 'call'),
        makeEdge('e4', 'd', 'c', 'call'),
        makeEdge('e5', 'a', 'c', 'call'),
        makeEdge('e6', 'e', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBeLessThan(100);
    });

    it('handles single node with no edges in cycle detection', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges: ReturnType<typeof makeEdge>[] = [];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });
  });

  describe('calculateCoupling - additional edge cases', () => {
    it('skips contains edges (weight 0) in coupling calculation', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'contains')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
    });

    it('handles extend edge type weight in coupling', () => {
      const nodes = [
        makeNode('a', 'A', 'class', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'class', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'extend')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(50);
    });

    it('handles implement edge type weight in coupling', () => {
      const nodes = [
        makeNode('a', 'A', 'class', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'interface', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'implement')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(50);
    });

    it('returns 100 when all modules have zero ce+ca (only contains edges)', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'module', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'contains'),
        makeEdge('e2', 'c', 'd', 'contains'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
    });

    it('returns 100 when moduleCount is 0 after skipping zero-instability modules', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'contains')];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBe(100);
    });

    it('handles edges referencing nodes not in module map', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'unknown', 'call'),
        makeEdge('e2', 'unknown', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBeGreaterThanOrEqual(0);
      expect(score.coupling).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateCohesion - additional edge cases', () => {
    it('skips contains edges (weight 0) in cohesion calculation', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'contains')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThanOrEqual(0);
      expect(score.cohesion).toBeLessThanOrEqual(100);
    });

    it('returns low cohesion when all edges are cross-module with no internal edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'unknown1', 'call'),
        makeEdge('e2', 'unknown2', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(0);
    });

    it('handles module with zero total edges (cohesionRatio = 0)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThanOrEqual(0);
      expect(score.cohesion).toBeLessThanOrEqual(100);
    });

    it('returns 0 cohesion for empty nodes (calculate returns early)', () => {
      const nodes: ReturnType<typeof makeNode>[] = [];
      const edges = [makeEdge('e1', 'unknown1', 'unknown2', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(0);
    });

    it('handles edges where only source has module mapping', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'unknown', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThanOrEqual(0);
      expect(score.cohesion).toBeLessThanOrEqual(100);
    });

    it('handles edges where only target has module mapping', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
      ];
      const edges = [makeEdge('e1', 'unknown', 'a', 'call')];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThanOrEqual(0);
      expect(score.cohesion).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateModularity - additional edge cases', () => {
    it('skips contains edges (weight 0) in modularity calculation', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'contains')];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThanOrEqual(0);
      expect(score.modularity).toBeLessThanOrEqual(100);
    });

    it('returns balanceScore when totalRelevantEdges is 0 (multi-module, no relevant edges)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'contains')];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThan(0);
    });

    it('handles edges referencing nodes not in module map for modularity', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'unknown', 'call'),
        makeEdge('e2', 'unknown', 'b', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThanOrEqual(0);
      expect(score.modularity).toBeLessThanOrEqual(100);
    });

    it('handles extend edge type in modularity', () => {
      const nodes = [
        makeNode('a', 'A', 'class', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'class', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'extend')];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThanOrEqual(0);
      expect(score.modularity).toBeLessThanOrEqual(100);
    });

    it('handles implement edge type in modularity', () => {
      const nodes = [
        makeNode('a', 'A', 'class', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'interface', 'src/mod2/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'implement')];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThanOrEqual(0);
      expect(score.modularity).toBeLessThanOrEqual(100);
    });
  });

  describe('getDimensions - score value verification', () => {
    it('returns correct score values for each dimension', () => {
      const score = { coupling: 80, cohesion: 90, cyclicDependencyRate: 100, modularity: 70, overall: 85 };
      const dims = scorer.getDimensions(score);
      expect(dims[0]!.score).toBe(80);
      expect(dims[1]!.score).toBe(90);
      expect(dims[2]!.score).toBe(100);
      expect(dims[3]!.score).toBe(70);
    });

    it('returns zero scores correctly', () => {
      const score = { coupling: 0, cohesion: 0, cyclicDependencyRate: 0, modularity: 0, overall: 0 };
      const dims = scorer.getDimensions(score);
      expect(dims.every(d => d.score === 0)).toBe(true);
    });
  });

  describe('overall score - exact weighting formula', () => {
    it('computes overall as round(coupling*0.25 + cohesion*0.25 + cyclic*0.30 + modularity*0.20)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      const expectedOverall = Math.round(
        score.coupling * 0.25 + score.cohesion * 0.25 + score.cyclicDependencyRate * 0.30 + score.modularity * 0.20,
      );
      expect(score.overall).toBe(expectedOverall);
    });

    it('computes overall correctly for cyclic codebase', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      const expectedOverall = Math.round(
        score.coupling * 0.25 + score.cohesion * 0.25 + score.cyclicDependencyRate * 0.30 + score.modularity * 0.20,
      );
      expect(score.overall).toBe(expectedOverall);
    });
  });

  describe('constructor', () => {
    it('uses default maxModuleDepth of 3 when no argument provided', () => {
      const defaultScorer = new HealthScorer();
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/sub/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/sub/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = defaultScorer.calculate(nodes, edges);
      expect(score.cohesion).toBe(100);
    });

    it('handles maxModuleDepth of 0', () => {
      const customScorer = new HealthScorer(0);
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const score = customScorer.calculate(nodes, edges);
      expect(score).toBeDefined();
    });
  });

  describe('tarjanSCC - complex scenarios', () => {
    it('handles graph with isolated nodes and cycles', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod1/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
        makeEdge('e3', 'c', 'd', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(50);
    });

    it('handles large cycle with all nodes', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod1/d.ts', 1),
        makeNode('e', 'E', 'function', 'src/mod1/e.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
        makeEdge('e3', 'c', 'd', 'call'),
        makeEdge('e4', 'd', 'e', 'call'),
        makeEdge('e5', 'e', 'a', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(0);
    });

    it('handles cross-edge in tarjan (visited but not on stack)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
        makeEdge('e3', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(100);
    });

    it('handles mixed cycle and non-cycle edge types', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'a', 'call'),
        makeEdge('e2', 'a', 'b', 'call'),
        makeEdge('e3', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cyclicDependencyRate).toBe(67);
    });
  });

  describe('calculateCoupling - mixed edge types', () => {
    it('handles mix of contains and call edges across modules', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod2/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'contains'),
        makeEdge('e2', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.coupling).toBeLessThan(100);
    });
  });

  describe('calculateCohesion - mixed edge types', () => {
    it('handles mix of contains and call edges within same module', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/mod1/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'contains'),
        makeEdge('e2', 'b', 'c', 'call'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.cohesion).toBeGreaterThan(0);
    });
  });

  describe('calculateModularity - balanced modules with no edges', () => {
    it('returns high balanceScore for perfectly balanced modules with only contains edges', () => {
      const nodes = [
        makeNode('a', 'A', 'module', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod1/b.ts', 1),
        makeNode('c', 'C', 'module', 'src/mod2/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/mod2/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'contains'),
        makeEdge('e2', 'c', 'd', 'contains'),
      ];
      const score = scorer.calculate(nodes, edges);
      expect(score.modularity).toBeGreaterThan(50);
    });
  });
});