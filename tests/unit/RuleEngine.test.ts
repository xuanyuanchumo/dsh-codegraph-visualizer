import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleEngine, getPresetRules } from '../../src/shared/analysis/RuleEngine.ts';
import type {
  AdjacencyProvider,
  RuleDefinition,
  RuleDetector,
  RuleViolation,
} from '../../src/shared/analysis/RuleEngine.ts';
import type { GraphEdge, GraphNode } from '../../src/types/index.ts';
import { NodeId } from '../../src/types/index.ts';
import type { RuleType } from '../../src/types/index.ts';
import { makeNode, makeEdge } from '../helpers.ts';

// cycle-107 · C-3：既要断言「同 edgeTypes 只建一次邻接」，也要断言「无环时不再枚举环」，
// 因此把这两个被观测函数换成「委托真实实现」的 spy——而不是替换整个模块：
// 仍然覆盖真实实现，只在旁边记调用次数。
vi.mock('../../src/shared/analysis/AdjacencyList.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/analysis/AdjacencyList.ts')>();
  return {
    ...actual,
    buildFilteredForwardAdjacency: vi.fn(actual.buildFilteredForwardAdjacency),
  };
});

vi.mock('../../src/shared/analysis/CycleDFS.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/analysis/CycleDFS.ts')>();
  return {
    ...actual,
    detectCyclesDFS: vi.fn(actual.detectCyclesDFS),
  };
});

import { buildFilteredForwardAdjacency } from '../../src/shared/analysis/AdjacencyList.ts';
import type { AdjacencyMap } from '../../src/shared/analysis/AdjacencyList.ts';
import { detectCyclesDFS } from '../../src/shared/analysis/CycleDFS.ts';

describe('J18: 规则引擎检测 - RuleEngine', () => {
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

  describe('check - unknown rule type', () => {
    it('skips rules with no registered detector (no error)', () => {
      const rule: RuleDefinition = {
        id: 'unknown-type',
        name: 'Unknown Type',
        type: 'forbidden-edge' as RuleType,
        params: {},
        severity: 'warning',
        enabled: true,
      };
      // Use a fresh engine and remove all detectors by overwriting with a no-op
      const freshEngine = new RuleEngine();
      // Register a custom detector for a type that the rule does not use
      freshEngine.registerDetector('max-indegree', {
        detect: () => [{ ruleId: 'custom', nodeId: NodeId('x'), message: 'custom', severity: 'warning' }],
      });
      // The rule type 'forbidden-edge' still has its original detector;
      // instead, test with a truly unregistered type by casting
      const unknownRule = { ...rule, type: 'nonexistent' as RuleType };
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      const edges: GraphEdge[] = [];
      const violations = freshEngine.check([unknownRule], nodes, edges);
      expect(violations).toEqual([]);
    });
  });

  describe('registerDetector - override', () => {
    it('overwrites existing detector when registering same type', () => {
      const freshEngine = new RuleEngine();
      const customDetector = {
        detect: (): RuleViolation[] => [
          { ruleId: 'custom-detector', nodeId: NodeId('custom'), message: 'overridden', severity: 'error' },
        ],
      };
      freshEngine.registerDetector('max-indegree', customDetector);
      const rule: RuleDefinition = {
        id: 'test-override',
        name: 'Test Override',
        type: 'max-indegree',
        params: { threshold: 1 },
        severity: 'warning',
        enabled: true,
      };
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      const edges: GraphEdge[] = [];
      const violations = freshEngine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.ruleId).toBe('custom-detector');
      expect(violations[0]!.message).toBe('overridden');
    });
  });

  describe('ForbiddenEdgeDetector - complex DFS', () => {
    const rule: RuleDefinition = {
      id: 'no-circular',
      name: 'No Circular',
      type: 'forbidden-edge',
      params: { edgeTypes: ['call'] },
      severity: 'error',
      enabled: true,
    };

    it('deduplicates visited nodes across multiple entry points', () => {
      // Graph: two entry points (a, d) both reach shared subgraph (b→c)
      // a→b→c, d→b→c — b and c should only be visited once
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
        makeEdge('e3', 'd', 'b', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      // No cycles, should return empty
      expect(violations).toEqual([]);
    });

    it('deduplicates cycleKey in complex graph with shared cycle', () => {
      // Graph: a→b→c→a (cycle), and d→b (d enters the cycle from outside)
      // The cycle a→b→c→a should only be reported once
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'c', 'call'),
        makeEdge('e3', 'c', 'a', 'call'),
        makeEdge('e4', 'd', 'b', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('Circular dependency');
    });

    it('detects two distinct cycles in complex graph', () => {
      // Graph with two separate cycles: a→b→a and c→d→c
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
        makeEdge('e3', 'c', 'd', 'call'),
        makeEdge('e4', 'd', 'c', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(2);
      // Each violation should mention a circular dependency
      expect(violations.every((v) => v.message.includes('Circular dependency'))).toBe(true);
    });
  });

  describe('CrossLayerCallDetector - boundary cases', () => {
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

    it('assigns first matching layer when node matches multiple patterns', () => {
      // With layers { 'view': ['model'], 'model': ['view'] }:
      //   'view' layer patterns: ['model'] — matches path containing 'model'
      //   'model' layer patterns: ['view'] — matches path containing 'view'
      // Node vm (src/view/model/page.ts) matches both layers (path has both 'view' and 'model'),
      // but gets 'view' (first in iteration order) because its patterns ['model'] match first.
      // Node v (src/view/page.ts) only matches 'model' layer (path has 'view').
      // So vm→v is view→model, which is a forbidden pair.
      const nodes = [
        makeNode('vm', 'VM', 'function', 'src/view/model/page.ts', 1),
        makeNode('v', 'V', 'function', 'src/view/page.ts', 1),
      ];
      const edges = [makeEdge('e1', 'vm', 'v', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('view');
      expect(violations[0]!.message).toContain('model');
    });

    it('matches layers with backslash path separators', () => {
      const nodes = [
        makeNode('v', 'View', 'function', 'src\\view\\page.ts', 1),
        makeNode('m', 'Model', 'function', 'src\\model\\data.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v', 'm', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('view');
      expect(violations[0]!.message).toContain('model');
    });
  });

  describe('MaxIndegreeDetector - boundary cases', () => {
    it('does not report when indegree equals threshold exactly', () => {
      const rule: RuleDefinition = {
        id: 'max-in-eq',
        name: 'Max In Equal',
        type: 'max-indegree',
        params: { threshold: 3 },
        severity: 'warning',
        enabled: true,
      };
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
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toEqual([]);
    });

    it('reports when indegree exceeds threshold by one', () => {
      const rule: RuleDefinition = {
        id: 'max-in-over',
        name: 'Max In Over',
        type: 'max-indegree',
        params: { threshold: 3 },
        severity: 'warning',
        enabled: true,
      };
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
  });

  describe('MaxOutdegreeDetector - boundary cases', () => {
    it('does not report when outdegree equals threshold exactly', () => {
      const rule: RuleDefinition = {
        id: 'max-out-eq',
        name: 'Max Out Equal',
        type: 'max-outdegree',
        params: { threshold: 3 },
        severity: 'warning',
        enabled: true,
      };
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
      expect(violations).toEqual([]);
    });

    it('reports when outdegree exceeds threshold by one', () => {
      const rule: RuleDefinition = {
        id: 'max-out-over',
        name: 'Max Out Over',
        type: 'max-outdegree',
        params: { threshold: 3 },
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('hub', 'Hub', 'function', 'src/hub.ts', 1),
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
        makeNode('d', 'D', 'function', 'src/d.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'hub', 'a', 'call'),
        makeEdge('e2', 'hub', 'b', 'call'),
        makeEdge('e3', 'hub', 'c', 'call'),
        makeEdge('e4', 'hub', 'd', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('outdegree 4');
      expect(violations[0]!.message).toContain('max 3');
    });
  });

  describe('RequiredEdgeDetector - edge source not in nodeMap', () => {
    it('skips edges whose source node does not exist in nodes list', () => {
      const rule: RuleDefinition = {
        id: 'req-call',
        name: 'Required Call',
        type: 'required-edge',
        params: { edgeType: 'call', sourceType: 'function' },
        severity: 'warning',
        enabled: true,
      };
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
      ];
      // edge source 'ghost' is not in nodes list — should be skipped (not counted as hasEdge)
      const edges = [makeEdge('e1', 'ghost', 'a', 'call')];
      const violations = engine.check([rule], nodes, edges);
      // 'a' has no outgoing call edge, so it should be reported
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('A');
    });
  });

  describe('CrossLayerCallDetector - default params', () => {
    it('uses default empty layerMap when layers param is nullish', () => {
      const rule: RuleDefinition = {
        id: 'no-cross-default',
        name: 'No Cross Layer Default',
        type: 'cross-layer-call',
        params: {},
        severity: 'error',
        enabled: true,
      };
      const nodes = [makeNode('a', 'A', 'function', 'src/a.ts', 1)];
      const edges = [makeEdge('e1', 'a', 'a', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toEqual([]);
    });

    it('uses default call edgeType when edgeType param is nullish', () => {
      const rule: RuleDefinition = {
        id: 'no-cross-default-edge',
        name: 'No Cross Layer Default Edge',
        type: 'cross-layer-call',
        params: { layers: { 'view': ['model'], 'model': ['view'] } },
        severity: 'error',
        enabled: true,
      };
      // With this layerMap: path containing 'model' → 'view' layer, path containing 'view' → 'model' layer
      // v (src/view/page.ts) → 'model' layer, m (src/model/data.ts) → 'view' layer
      // v→m = model→view, which is forbidden
      const nodes = [
        makeNode('v', 'View', 'function', 'src/view/page.ts', 1),
        makeNode('m', 'Model', 'function', 'src/model/data.ts', 1),
      ];
      const edges = [makeEdge('e1', 'v', 'm', 'call')];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
    });
  });

  describe('ForbiddenEdgeDetector - default edgeTypes and multi-edge nodes', () => {
    it('uses default edgeTypes when not specified in params', () => {
      const rule: RuleDefinition = {
        id: 'no-circular-default',
        name: 'No Circular Default',
        type: 'forbidden-edge',
        params: {},
        severity: 'error',
        enabled: true,
      };
      // Default edgeTypes should include 'call', 'import', 'dependency'
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'import'),
        makeEdge('e2', 'b', 'a', 'import'),
      ];
      const violations = engine.check([rule], nodes, edges);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('Circular dependency');
    });

    it('handles nodes with multiple outgoing edges of same type', () => {
      const rule: RuleDefinition = {
        id: 'no-circular-multi',
        name: 'No Circular Multi',
        type: 'forbidden-edge',
        params: { edgeTypes: ['call'] },
        severity: 'error',
        enabled: true,
      };
      // Node 'a' has two outgoing call edges: a→b and a→c
      // This exercises the `if (list) list.push(edge.target)` truthy branch
      const nodes = [
        makeNode('a', 'A', 'function', 'src/a.ts', 1),
        makeNode('b', 'B', 'function', 'src/b.ts', 1),
        makeNode('c', 'C', 'function', 'src/c.ts', 1),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
        makeEdge('e3', 'c', 'a', 'call'),
      ];
      const violations = engine.check([rule], nodes, edges);
      // a→c→a forms a cycle
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain('Circular dependency');
    });
  });

  // ---------------------------------------------------------------------------
  // cycle-107 · C-3：共享遍历 + 环存在性早退
  // ---------------------------------------------------------------------------
  describe('共享邻接缓存 / 环存在性早退（cycle-107 C-3）', () => {
    beforeEach(() => {
      vi.mocked(buildFilteredForwardAdjacency).mockClear();
      vi.mocked(detectCyclesDFS).mockClear();
    });

    const dagNodes = [
      makeNode('a', 'A', 'function', 'src/a.ts', 1),
      makeNode('b', 'B', 'function', 'src/b.ts', 1),
      makeNode('c', 'C', 'function', 'src/c.ts', 1),
    ];
    const dagEdges = [
      makeEdge('e1', 'a', 'b', 'call'),
      makeEdge('e2', 'b', 'c', 'call'),
    ];

    const forbiddenRule = (id: string, edgeTypes: string[]): RuleDefinition => ({
      id,
      name: id,
      type: 'forbidden-edge',
      params: { edgeTypes },
      severity: 'error',
      enabled: true,
    });

    it('returns [] for an acyclic graph and never enumerates cycles', () => {
      const engine = new RuleEngine();
      expect(engine.check([forbiddenRule('no-circular', ['call'])], dagNodes, dagEdges)).toEqual([]);
      // 早退：法环不存在时 detectCyclesDFS 一次都不该被调用
      expect(vi.mocked(detectCyclesDFS)).not.toHaveBeenCalled();
      expect(vi.mocked(buildFilteredForwardAdjacency)).toHaveBeenCalledTimes(1);
    });

    it('still enumerates cycles for a cyclic graph and keeps the exact legacy message', () => {
      const engine = new RuleEngine();
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const violations = engine.check([forbiddenRule('no-circular', ['call'])], dagNodes, edges);

      expect(vi.mocked(detectCyclesDFS)).toHaveBeenCalledTimes(1);
      expect(violations).toHaveLength(1);
      // 旧实现逐字：cycle.sort() 后按 '→' 连接（a→b→a 排序后为 a/a/b）
      expect(violations[0]!.message).toBe('Circular dependency detected involving: a→a→b');
      expect(violations[0]!.ruleId).toBe('no-circular');
      expect(violations[0]!.nodeId).toBe('a');
      expect(violations[0]!.severity).toBe('error');
    });

    it('builds the adjacency only once for two rules with the same edgeTypes', () => {
      const engine = new RuleEngine();
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'b', 'a', 'call'),
      ];
      const violations = engine.check(
        [forbiddenRule('rule-1', ['call', 'import']), forbiddenRule('rule-2', ['call', 'import'])],
        dagNodes,
        edges,
      );

      expect(vi.mocked(buildFilteredForwardAdjacency)).toHaveBeenCalledTimes(1);
      expect(detectCyclesDFS).toHaveBeenCalledTimes(2);
      expect(violations.map((v) => v.ruleId)).toEqual(['rule-1', 'rule-2']);
    });

    it('treats edgeTypes as a set (different order → one build)', () => {
      const engine = new RuleEngine();
      engine.check(
        [forbiddenRule('rule-1', ['call', 'import']), forbiddenRule('rule-2', ['import', 'call'])],
        dagNodes,
        dagEdges,
      );
      expect(vi.mocked(buildFilteredForwardAdjacency)).toHaveBeenCalledTimes(1);
    });

    it('builds one adjacency per distinct edgeTypes combination', () => {
      const engine = new RuleEngine();
      engine.check(
        [
          forbiddenRule('rule-1', ['call']),
          forbiddenRule('rule-2', ['call']),
          forbiddenRule('rule-3', ['import']),
        ],
        dagNodes,
        dagEdges,
      );
      expect(vi.mocked(buildFilteredForwardAdjacency)).toHaveBeenCalledTimes(2);
    });

    it('does not build any adjacency when no forbidden-edge rule is enabled', () => {
      const engine = new RuleEngine();
      const disabled = { ...forbiddenRule('rule-1', ['call']), enabled: false };
      expect(engine.check([disabled], dagNodes, dagEdges)).toEqual([]);
      expect(vi.mocked(buildFilteredForwardAdjacency)).not.toHaveBeenCalled();
    });

    it('injects a shared provider and clears it after the check (FIFO for two detectors)', () => {
      const engine = new RuleEngine();
      const first = new RecordingDetector();
      const second = new RecordingDetector();
      engine.registerDetector('forbidden-edge', first);
      engine.registerDetector('max-indegree', second);

      const edges = [makeEdge('e1', 'a', 'b', 'call'), makeEdge('e2', 'b', 'a', 'call')];
      engine.check(
        [forbiddenRule('rule-1', ['call']), {
          id: 'rule-2',
          name: 'rule-2',
          type: 'max-indegree',
          params: { threshold: 99 },
          severity: 'warning',
          enabled: true,
        }],
        dagNodes,
        edges,
      );

      // 两条规则拿到的是同一个 Map 实例（共享缓存生效）
      expect(first.adjacencies).toHaveLength(1);
      expect(second.adjacencies).toHaveLength(1);
      expect(first.adjacencies[0]).toBe(second.adjacencies[0]);

      // 结束时注入 null 清空上下文
      expect(first.contexts.map((c) => c === null)).toEqual([false, true]);
      expect(second.contexts.map((c) => c === null)).toEqual([false, true]);
    });

    it('clears the injected context even when a detector throws', () => {
      const engine = new RuleEngine();
      const throwing = new ThrowingDetector();
      engine.registerDetector('forbidden-edge', throwing);

      expect(() => engine.check([forbiddenRule('rule-1', ['call'])], dagNodes, dagEdges)).toThrow('boom');
      expect(throwing.contexts.map((c) => c === null)).toEqual([false, true]);
    });

    it('leaves detectors without setContext untouched (third-party compatibility)', () => {
      const engine = new RuleEngine();
      const plainDetector: RuleDetector = {
        detect: () => [],
      };
      engine.registerDetector('forbidden-edge', plainDetector);
      expect(engine.check([forbiddenRule('rule-1', ['call'])], dagNodes, dagEdges)).toEqual([]);
    });
  });

  class RecordingDetector implements RuleDetector {
    readonly contexts: Array<AdjacencyProvider | null> = [];
    readonly adjacencies: AdjacencyMap[] = [];

    setContext(context: AdjacencyProvider | null): void {
      this.contexts.push(context);
    }

    detect(rule: RuleDefinition, _nodes: GraphNode[], _edges: GraphEdge[]): RuleViolation[] {
      const context = this.contexts[this.contexts.length - 1];
      if (context) {
        this.adjacencies.push(context.adjacencyFor((rule.params.edgeTypes as string[]) ?? ['call']));
      }
      return [];
    }
  }

  class ThrowingDetector implements RuleDetector {
    readonly contexts: Array<AdjacencyProvider | null> = [];

    setContext(context: AdjacencyProvider | null): void {
      this.contexts.push(context);
    }

    detect(): RuleViolation[] {
      throw new Error('boom');
    }
  }
});