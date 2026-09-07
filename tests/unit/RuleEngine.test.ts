import { describe, it, expect } from 'vitest';
import { RuleEngine, getPresetRules } from '../../src/shared/analysis/RuleEngine.ts';
import type { RuleDefinition } from '../../src/shared/analysis/RuleEngine.ts';
import type { GraphEdge } from '../../src/types/index.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('RuleEngine', () => {
  const engine = new RuleEngine();

  describe('getPresetRules', () => {
    it('returns 5 preset rules', () => {
      const rules = getPresetRules();
      expect(rules).toHaveLength(5);
      expect(rules.map((r) => r.id)).toEqual([
        'no-circular-deps',
        'max-indegree-10',
        'max-outdegree-15',
        'required-call-edge',
        'no-cross-layer-call',
      ]);
    });

    it('returns copies (not references)', () => {
      const rules1 = getPresetRules();
      const rules2 = getPresetRules();
      expect(rules1).not.toBe(rules2);
      expect(rules1[0]).not.toBe(rules2[0]);
    });

    it('all presets are disabled by default', () => {
      const rules = getPresetRules();
      expect(rules.every((r) => !r.enabled)).toBe(true);
    });
  });

  describe('check - disabled rules', () => {
    it('skips disabled rules', () => {
      const rule: RuleDefinition = {
        id: 'test',
        name: 'Test',
        type: 'max-indegree',
        params: { threshold: 1 },
        severity: 'warning',
        enabled: false,
      };
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      const edges = [makeEdge('e1', 'b', 'a', 'call'), makeEdge('e2', 'c', 'a', 'call')];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });
  });

  describe('ForbiddenEdgeDetector (circular deps)', () => {
    const rule: RuleDefinition = {
      id: 'no-circular',
      name: 'No Circular',
      type: 'forbidden-edge',
      params: { edgeTypes: ['call', 'import', 'dependency'] },
      severity: 'error',
      enabled: true,
    };

    it('returns empty for DAG (no cycles)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
      ];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });

    it('detects 2-node cycle (a→b→a)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.ruleId).toBe('no-circular');
      expect(violations[0]!.severity).toBe('error');
      expect(violations[0]!.message).toContain('Circular dependency');
    });

    it('detects 3-node cycle (a→b→c→a)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
        makeEdge('e3', 'c', 'a', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
    });

    it('detects self-loop as cycle', () => {
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      const edges = [makeEdge('e1', 'a', 'a', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
    });

    it('does not report same cycle twice (deduplication)', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
    });

    it('only checks specified edge types', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'extend'),
        makeEdge('e2', 'b', 'a', 'extend'),
      ];
      const ruleExtend: RuleDefinition = {
        ...rule,
        params: { edgeTypes: ['call'] },
      };
      expect(engine.check([ruleExtend], nodes, edges)).toEqual([]);
    });
  });

  describe('MaxIndegreeDetector', () => {
    const rule: RuleDefinition = {
      id: 'max-in',
      name: 'Max In',
      type: 'max-indegree',
      params: { threshold: 3 },
      severity: 'warning',
      enabled: true,
    };

    it('returns empty when all nodes are within threshold', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'b', 'a', 'call'),
        makeEdge('e2', 'c', 'a', 'call'),
      ];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });

    it('reports nodes exceeding threshold', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'hub', 'call'),
        makeEdge('e2', 'b', 'hub', 'call'),
        makeEdge('e3', 'c', 'hub', 'call'),
        makeEdge('e4', 'd', 'hub', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('indegree 4');
      expect(violations[0]!.message).toContain('max 3');
    });

    it('uses default threshold of 10 when not specified', () => {
      const ruleDefault: RuleDefinition = {
        id: 'max-in-default',
        name: 'Max In Default',
        type: 'max-indegree',
        params: {},
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        ...Array.from({ length: 11 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = Array.from({ length: 11 }, (_, i) => makeEdge(`e${i}`, `n${i}`, 'hub', 'call'));
      const violations = engine.check([ruleDefault], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('max 10');
    });
  });

  describe('MaxOutdegreeDetector', () => {
    const rule: RuleDefinition = {
      id: 'max-out',
      name: 'Max Out',
      type: 'max-outdegree',
      params: { threshold: 2 },
      severity: 'warning',
      enabled: true,
    };

    it('returns empty when all nodes are within threshold', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
      ];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });

    it('reports nodes exceeding threshold', () => {
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'hub', 'a', 'call'),
        makeEdge('e2', 'hub', 'b', 'call'),
        makeEdge('e3', 'hub', 'c', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('outdegree 3');
      expect(violations[0]!.message).toContain('max 2');
    });

    it('uses default threshold of 15 when not specified', () => {
      const ruleDefault: RuleDefinition = {
        id: 'max-out-default',
        name: 'Max Out Default',
        type: 'max-outdegree',
        params: {},
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        ...Array.from({ length: 16 }, (_, i) => makeNode(`n${i}`, `N${i}`, 'function', `src/n${i}.ts`, 1)),
      ];
      const edges = Array.from({ length: 16 }, (_, i) => makeEdge(`e${i}`, 'hub', `n${i}`, 'call'));
      const violations = engine.check([ruleDefault], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('max 15');
    });
  });

  describe('RequiredEdgeDetector', () => {
    const rule: RuleDefinition = {
      id: 'req-call',
      name: 'Required Call',
      type: 'required-edge',
      params: { edgeType: 'call', sourceType: 'function' },
      severity: 'warning',
      enabled: true,
    };

    it('reports functions with no outgoing call edges', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'class', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'c', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('B');
      expect(violations[0]!.message).toContain('missing required call edge');
    });

    it('does not report non-function nodes when sourceType is function', () => {
      const nodes = [
        makeNode('cls', 'Cls', 'class', 'src/cls.ts', 1),
        makeNode('fn', 'Fn', 'function', 'src/fn.ts', 1),
      ];
      const edges = [makeEdge('e1', 'fn', 'cls', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(0);
    });

    it('checks all nodes when no sourceType filter', () => {
      const ruleNoFilter: RuleDefinition = {
        id: 'req-any',
        name: 'Required Any',
        type: 'required-edge',
        params: { edgeType: 'call' },
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'class', 'src/b.ts', 1),
      ];
      const edges: GraphEdge[] = [];
      const violations = engine.check([ruleNoFilter], nodes, edges);
      expect(violations).toHaveLength(2);
    });

    it('filters by targetType when specified', () => {
      const ruleWithTarget: RuleDefinition = {
        id: 'req-call-target',
        name: 'Required Call to Class',
        type: 'required-edge',
        params: { edgeType: 'call', sourceType: 'function', targetType: 'class' },
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'class', 'src/c.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const violations = engine.check([ruleWithTarget], nodes, edges);
      expect(violations).toHaveLength(2);
      expect(violations.some((v) => v.message.includes('A'))).toBe(true);
      expect(violations.some((v) => v.message.includes('B'))).toBe(true);
    });

    it('does not report when edge has correct sourceType and targetType', () => {
      const ruleWithTarget: RuleDefinition = {
        id: 'req-call-target',
        name: 'Required Call to Class',
        type: 'required-edge',
        params: { edgeType: 'call', sourceType: 'function', targetType: 'class' },
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('c', 'C', 'class', 'src/c.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'c', 'call')];
      const violations = engine.check([ruleWithTarget], nodes, edges);
      expect(violations).toHaveLength(0);
    });

    it('skips edges with wrong edge type', () => {
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'a', 'b', 'import')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(2);
    });
  });

  describe('CrossLayerCallDetector', () => {
    const rule: RuleDefinition = {
      id: 'no-cross',
      name: 'No Cross Layer',
      type: 'cross-layer-call',
      params: {
        layers: { 'view': ['model'], 'model': ['view'] },
        edgeType: 'call',
      },
      severity: 'error',
      enabled: true,
    };

    it('returns empty when no layers defined', () => {
      const ruleEmpty: RuleDefinition = {
        ...rule,
        params: { layers: {}, edgeType: 'call' },
      };
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      const edges = [makeEdge('e1', 'a', 'a', 'call')];
      expect(engine.check([ruleEmpty], nodes, edges)).toEqual([]);
    });

    it('detects view→model cross-layer call', () => {
      const nodes = [
        makeNode('v', 'View', 'function', 'src/view/page.ts', 1),
        makeNode('m', 'Model', 'function', 'src/model/data.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v', 'm', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('view');
      expect(violations[0]!.message).toContain('model');
    });

    it('does not flag non-call edges', () => {
      const nodes = [
        makeNode('v', 'View', 'function', 'src/view/page.ts', 1),
        makeNode('m', 'Model', 'function', 'src/model/data.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v', 'm', 'import')];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });

    it('does not flag calls within same layer', () => {
      const nodes = [
        makeNode('v1', 'View1', 'function', 'src/view/a.ts', 1),
        makeNode('v2', 'View2', 'function', 'src/view/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v1', 'v2', 'call')];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });

    it('matches layers by label name', () => {
      const ruleLabel: RuleDefinition = {
        ...rule,
        params: {
          layers: { 'view': ['model'], 'model': ['view'] },
          edgeType: 'call',
        },
      };
      const nodes = [
        makeNode('v', 'view', 'function', 'src/x.ts', 1),
        makeNode('m', 'model', 'function', 'src/y.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v', 'm', 'call')];
      const violations = engine.check([ruleLabel], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('view');
      expect(violations[0]!.message).toContain('model');
    });

    it('skips edges where source or target has no layer', () => {
      const nodes = [
        makeNode('v', 'View', 'function', 'src/view/a.ts', 1),
        makeNode('x', 'X', 'function', 'src/other.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v', 'x', 'call')];
      expect(engine.check([rule], nodes, edges)).toEqual([]);
    });
  });

  describe('registerDetector', () => {
    it('allows registering custom detectors', () => {
      const customRule: RuleDefinition = {
        id: 'custom',
        name: 'Custom',
        type: 'forbidden-edge',
        params: { edgeTypes: ['call'] },
        severity: 'warning',
        enabled: true,
      };
      const customEngine = new RuleEngine();
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const violations = customEngine.check([customRule], nodes, edges);
      expect(violations).toHaveLength(1);
    });
  });

  describe('check - multiple rules', () => {
    it('aggregates violations from multiple enabled rules', () => {
      const rules: RuleDefinition[] = [
        {
          id: 'max-in-2',
          name: 'Max In 2',
          type: 'max-indegree',
          params: { threshold: 2 },
          severity: 'warning',
          enabled: true,
        },
        {
          id: 'max-out-2',
          name: 'Max Out 2',
          type: 'max-outdegree',
          params: { threshold: 2 },
          severity: 'warning',
          enabled: true,
        },
      ];
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'hub', 'call'),
        makeEdge('e2', 'b', 'hub', 'call'),
        makeEdge('e3', 'c', 'hub', 'call'),
        makeEdge('e4', 'hub', 'a', 'call'),
        makeEdge('e5', 'hub', 'b', 'call'),
        makeEdge('e6', 'hub', 'c', 'call'),
      ];
      const violations = engine.check(rules, nodes, edges);
      expect(violations.length).toBe(2);
      expect(violations.some((v) => v.ruleId === 'max-in-2')).toBe(true);
      expect(violations.some((v) => v.ruleId === 'max-out-2')).toBe(true);
    });
  });
});