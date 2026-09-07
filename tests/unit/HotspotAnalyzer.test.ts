import { describe, it, expect } from 'vitest';
import { HotspotAnalyzer, GodModuleDetector } from '../../src/shared/analysis/HotspotAnalyzer.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('HotspotAnalyzer', () => {
  const analyzer = new HotspotAnalyzer();

  describe('analyze', () => {
    it('returns empty for no edges', () => {
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      expect(analyzer.analyze(nodes, [])).toEqual([]);
    });

    it('filters out nodes with indegree < 5', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'hub', 'call'),
        makeEdge('e2', 'b', 'hub', 'call'),
      ];
      expect(analyzer.analyze(nodes, edges)).toEqual([]);
    });

    it('detects low-level hotspot (indegree 5-9)', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        ...Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = Array.from({ length: 5 }, (_, i) => makeEdge(`e${i}`, `n${i}`, 'hub', 'call'));
      const result = analyzer.analyze(nodes, edges);
      expect(result).toHaveLength(1);
      expect(result[0]!.level).toBe('low');
      expect(result[0]!.indegree).toBe(5);
      expect(result[0]!.label).toBe('Hub');
    });

    it('detects medium-level hotspot (indegree 10-19)', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        ...Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = Array.from({ length: 10 }, (_, i) => makeEdge(`e${i}`, `n${i}`, 'hub', 'call'));
      const result = analyzer.analyze(nodes, edges);
      expect(result[0]!.level).toBe('medium');
      expect(result[0]!.indegree).toBe(10);
    });

    it('detects high-level hotspot (indegree >= 20)', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        ...Array.from({ length: 20 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = Array.from({ length: 20 }, (_, i) => makeEdge(`e${i}`, `n${i}`, 'hub', 'call'));
      const result = analyzer.analyze(nodes, edges);
      expect(result[0]!.level).toBe('high');
      expect(result[0]!.indegree).toBe(20);
    });

    it('sorts results by indegree descending', () => {
      const nodes = [
        makeNode('low', 'Low', 'function', 'src/low.ts', 1),
        makeNode('high', 'High', 'function', 'src/high.ts', 1),
        ...Array.from({ length: 20 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = [
        ...Array.from({ length: 5 }, (_, i) => makeEdge(`el${i}`, `n${i}`, 'low', 'call')),
        ...Array.from({ length: 20 }, (_, i) => makeEdge(`eh${i}`, `n${i}`, 'high', 'call')),
      ];
      const result = analyzer.analyze(nodes, edges);
      expect(result[0]!.label).toBe('High');
      expect(result[1]!.label).toBe('Low');
    });

    it('ignores edges whose target node is not in nodes list', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        ...Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = [
        ...Array.from({ length: 5 }, (_, i) => makeEdge(`e${i}`, `n${i}`, 'hub', 'call')),
        makeEdge('ghost', 'n0', 'nonexistent', 'call'),
      ];
      const result = analyzer.analyze(nodes, edges);
      expect(result).toHaveLength(1);
      expect(result[0]!.label).toBe('Hub');
    });
  });
});

describe('GodModuleDetector', () => {
  describe('detect', () => {
    it('returns empty when no module reaches threshold', () => {
      const detector = new GodModuleDetector();
      const nodes = [
        makeNode('a', 'A', 'function', 'src/mod1/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/mod2/b.ts', 1),
      ];
      expect(detector.detect(nodes, [])).toEqual([]);
    });

    it('detects module with node count >= threshold', () => {
      const detector = new GodModuleDetector();
      const nodes = Array.from({ length: 50 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/bigmod/file${i}.ts`, 1),
      );
      const result = detector.detect(nodes, [], 50);
      expect(result).toHaveLength(1);
      expect(result[0]!.modulePath).toBe('src/bigmod');
      expect(result[0]!.nodeCount).toBe(50);
      expect(result[0]!.suggestion).toContain('consider splitting');
    });

    it('respects custom threshold', () => {
      const detector = new GodModuleDetector();
      const nodes = Array.from({ length: 10 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/mod/file${i}.ts`, 1),
      );
      expect(detector.detect(nodes, [], 50)).toEqual([]);
      expect(detector.detect(nodes, [], 5)).toHaveLength(1);
    });

    it('respects maxModuleDepth', () => {
      const detector = new GodModuleDetector(2);
      const nodes = Array.from({ length: 50 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `src/a/b/c/file${i}.ts`, 1),
      );
      const result = detector.detect(nodes, [], 50);
      expect(result[0]!.modulePath).toBe('src/a');
    });

    it('strips file: and import: prefixes from filePath', () => {
      const detector = new GodModuleDetector();
      const nodes = Array.from({ length: 50 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `file:src/mod/file${i}.ts`, 1),
      );
      const result = detector.detect(nodes, [], 50);
      expect(result[0]!.modulePath).toBe('src/mod');
    });

    it('handles single-segment paths', () => {
      const detector = new GodModuleDetector();
      const nodes = Array.from({ length: 50 }, (_, i) =>
        makeNode(`n${i}`, `N${i}`, 'function', `mod${i % 2}.ts`, 1),
      );
      const result = detector.detect(nodes, [], 25);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('counts edges within and across modules', () => {
      const detector = new GodModuleDetector();
      const nodes = [
        ...Array.from({ length: 50 }, (_, i) =>
          makeNode(`n${i}`, `N${i}`, 'function', `src/bigmod/file${i}.ts`, 1),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeNode(`m${i}`, `M${i}`, 'function', `src/smallmod/file${i}.ts`, 1),
        ),
      ];
      const edges = [
        makeEdge('e1', 'n0', 'm0', 'call'),
        makeEdge('e2', 'n1', 'n2', 'call'),
      ];
      const result = detector.detect(nodes, edges, 50);
      expect(result[0]!.edgeCount).toBeGreaterThan(0);
    });

    it('sorts results by nodeCount descending', () => {
      const detector = new GodModuleDetector();
      const bigNodes = Array.from({ length: 60 }, (_, i) =>
        makeNode(`b${i}`, `B${i}`, 'function', `src/big/file${i}.ts`, 1),
      );
      const medNodes = Array.from({ length: 55 }, (_, i) =>
        makeNode(`m${i}`, `M${i}`, 'function', `src/med/file${i}.ts`, 1),
      );
      const result = detector.detect([...bigNodes, ...medNodes], [], 50);
      expect(result[0]!.nodeCount).toBe(60);
      expect(result[1]!.nodeCount).toBe(55);
    });
  });
});