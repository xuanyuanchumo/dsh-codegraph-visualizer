/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { buildTour } from '../../src/shared/analysis/TourBuilder.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

function makeNode(id: string, label: string, type: GraphNode['type'], filePath: string): GraphNode {
  return { id: NodeId(id), label, type, filePath, lineNumber: 1, properties: {} };
}

function makeEdge(source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(`${source}-${target}`), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

describe('TourBuilder', () => {
  describe('buildTour', () => {
    it('returns empty tour for empty nodes', () => {
      const tour = buildTour([], []);
      expect(tour.steps).toEqual([]);
      expect(tour.totalSteps).toBe(0);
      expect(tour.entryPoints).toEqual([]);
    });

    it('identifies entry points as nodes with no incoming edges', () => {
      const nodes = [
        makeNode('a', 'main', 'function', 'src/main.ts'),
        makeNode('b', 'util', 'function', 'src/util.ts'),
      ];
      const edges = [makeEdge('a', 'b')];
      const tour = buildTour(nodes, edges);
      expect(tour.entryPoints).toContain('a');
    });

    it('uses naming patterns to find entry points when all nodes have incoming edges', () => {
      const nodes = [
        makeNode('a', 'index', 'function', 'src/index.ts'),
        makeNode('b', 'util', 'function', 'src/util.ts'),
      ];
      const edges = [makeEdge('b', 'a'), makeEdge('a', 'b')];
      const tour = buildTour(nodes, edges);
      expect(tour.entryPoints).toContain('a');
    });

    it('generates steps with correct titles from node labels', () => {
      const nodes = [makeNode('a', 'main', 'function', 'src/main.ts')];
      const tour = buildTour(nodes, []);
      expect(tour.steps[0]?.title).toBe('main');
    });

    it('classifies nodes into architectural layers', () => {
      const nodes = [
        makeNode('entry', 'main', 'function', 'src/main.ts'),
        makeNode('api', 'router', 'function', 'src/api/router.ts'),
        makeNode('svc', 'service', 'function', 'src/service/user.ts'),
        makeNode('data', 'model', 'class', 'src/data/model.ts'),
        makeNode('ui', 'component', 'class', 'src/ui/component.tsx'),
        makeNode('util', 'helper', 'function', 'src/util/helper.ts'),
      ];
      const tour = buildTour(nodes, []);
      const layers = tour.steps.map((s) => s.layer);
      expect(layers).toContain('entry');
      expect(layers).toContain('api');
      expect(layers).toContain('service');
      expect(layers).toContain('data');
      expect(layers).toContain('ui');
      expect(layers).toContain('utility');
    });

    it('orders steps by layer (entry first, then api, service, data, ui, utility)', () => {
      const nodes = [
        makeNode('util', 'helper', 'function', 'src/util/helper.ts'),
        makeNode('entry', 'main', 'function', 'src/main.ts'),
        makeNode('api', 'router', 'function', 'src/api/router.ts'),
      ];
      const tour = buildTour(nodes, []);
      expect(tour.steps[0]?.layer).toBe('entry');
      expect(tour.steps[1]?.layer).toBe('api');
      expect(tour.steps[2]?.layer).toBe('utility');
    });

    it('includes dependency and dependent counts in step metadata', () => {
      const nodes = [
        makeNode('a', 'main', 'function', 'src/main.ts'),
        makeNode('b', 'util', 'function', 'src/util.ts'),
        makeNode('c', 'helper', 'function', 'src/helper.ts'),
      ];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
      const tour = buildTour(nodes, edges);
      const stepB = tour.steps.find((s) => s.nodeId === 'b');
      expect(stepB?.dependencies).toEqual(['c']);
      expect(stepB?.dependents).toEqual(['a']);
    });

    it('respects maxSteps limit', () => {
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 50; i++) {
        nodes.push(makeNode(`n${i}`, `func${i}`, 'function', `src/file${i}.ts`));
      }
      const tour = buildTour(nodes, [], 10);
      expect(tour.steps.length).toBe(10);
      expect(tour.totalSteps).toBe(10);
    });

    it('generates meaningful descriptions', () => {
      const nodes = [
        makeNode('a', 'main', 'function', 'src/main.ts'),
        makeNode('b', 'util', 'function', 'src/util.ts'),
      ];
      const edges = [makeEdge('a', 'b')];
      const tour = buildTour(nodes, edges);
      const stepA = tour.steps.find((s) => s.nodeId === 'a');
      expect(stepA?.description).toContain('main');
      expect(stepA?.description).toContain('src/main.ts');
      expect(stepA?.description).toContain('依赖');
    });

    it('handles isolated nodes (no dependencies or dependents)', () => {
      const nodes = [makeNode('a', 'isolated', 'variable', 'src/standalone.ts')];
      const tour = buildTour(nodes, []);
      const stepA = tour.steps[0];
      expect(stepA?.description).toContain('独立节点');
    });

    it('uses topological sort for ordering within layers', () => {
      const nodes = [
        makeNode('a', 'main', 'function', 'src/main.ts'),
        makeNode('b', 'util', 'function', 'src/util.ts'),
        makeNode('c', 'helper', 'function', 'src/helper.ts'),
      ];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
      const tour = buildTour(nodes, edges);
      const ids = tour.steps.map((s) => s.nodeId);
      expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
      expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
    });
  });
});