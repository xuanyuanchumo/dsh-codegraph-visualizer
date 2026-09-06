import { describe, it, expect } from 'vitest';
import { HealthScorer } from '../../src/client/analysis/HealthScorer.ts';
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
      expect(score.coupling).toBe(0);
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
      expect(score.overall).toBeLessThanOrEqual(60);
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
  });
});