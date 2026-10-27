import type { GraphNode, GraphEdge, RuleType, RuleDefinition, RuleViolation } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AdjacencyMap } from './AdjacencyList.ts';
import { buildFilteredForwardAdjacency } from './AdjacencyList.ts';
import { detectCyclesDFS, hasCycle } from './CycleDFS.ts';

export type { RuleType, RuleDefinition, RuleViolation };

/**
 * 一次 `RuleEngine.check()` 内共享的邻接表提供者。
 *
 * 同一组 edgeTypes 的多条规则只会构建一次邻接表（键 = 排序后的
 * `edgeTypes.join('|')`），避免「N 条规则各建一遍全图邻接」的重复遍历。
 */
export interface AdjacencyProvider {
  /**
   * 取（并在本次 check 内缓存）按边类型过滤的前向邻接表。
   * 邻接表只读使用：检测器不得就地修改它（同一对象会被多条规则共享）。
   */
  adjacencyFor(edgeTypes: readonly string[]): AdjacencyMap;
}

export interface RuleDetector {
  detect(rule: RuleDefinition, nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[];
  /**
   * 可选：由 `RuleEngine.check` 在调用 `detect` 前注入共享上下文，调用结束后以 `null` 清空。
   *
   * 这是**可选**方法，既有第三方检测器无需实现即可继续工作；未实现时检测器自己建邻接表，
   * 行为与旧实现完全一致。实现方必须容忍 `null`（表示「本次 check 已结束」）。
   */
  setContext?(context: AdjacencyProvider | null): void;
}

const DEFAULT_FORBIDDEN_EDGE_TYPES: readonly string[] = ['call', 'import', 'dependency'];

const PRESET_RULES: RuleDefinition[] = [
  {
    id: 'no-circular-deps',
    name: 'No Circular Dependencies',
    type: 'forbidden-edge',
    params: { edgeTypes: ['call', 'import', 'dependency'] },
    severity: 'error',
    enabled: false,
  },
  {
    id: 'max-indegree-10',
    name: 'Max Indegree ≤ 10',
    type: 'max-indegree',
    params: { threshold: 10 },
    severity: 'warning',
    enabled: false,
  },
  {
    id: 'max-outdegree-15',
    name: 'Max Outdegree ≤ 15',
    type: 'max-outdegree',
    params: { threshold: 15 },
    severity: 'warning',
    enabled: false,
  },
  {
    id: 'required-call-edge',
    name: 'Public Functions Must Have Callers',
    type: 'required-edge',
    params: { edgeType: 'call', sourceType: 'function' },
    severity: 'warning',
    enabled: false,
  },
  {
    id: 'no-cross-layer-call',
    name: 'No Cross-Layer Calls',
    type: 'cross-layer-call',
    params: {
      layers: { 'view': ['model'], 'model': ['view'] },
      edgeType: 'call',
    },
    severity: 'error',
    enabled: false,
  },
];

export function getPresetRules(): RuleDefinition[] {
  return PRESET_RULES.map((r) => ({ ...r }));
}

export class RuleEngine {
  private detectors: Map<RuleType, RuleDetector> = new Map();

  constructor() {
    this.registerDetector('forbidden-edge', new ForbiddenEdgeDetector());
    this.registerDetector('max-indegree', new MaxIndegreeDetector());
    this.registerDetector('max-outdegree', new MaxOutdegreeDetector());
    this.registerDetector('required-edge', new RequiredEdgeDetector());
    this.registerDetector('cross-layer-call', new CrossLayerCallDetector());
  }

  registerDetector(type: RuleType, detector: RuleDetector): void {
    this.detectors.set(type, detector);
  }

  /**
   * 跑一遍启用中的规则。
   *
   * 本次调用内共享一张邻接缓存（同 edgeTypes 组合只构建一次），并把提供者注入给
   * 实现了可选 `setContext` 的检测器；无论正常返回还是抛错，都会在 finally 里清空上下文，
   * 避免检测器跨调用持有上一次的图（那会让后续 check 读到旧邻接表）。
   */
  check(rules: RuleDefinition[], nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const adjacencyCache = new Map<string, AdjacencyMap>();
    const provider: AdjacencyProvider = {
      adjacencyFor: (edgeTypes: readonly string[]): AdjacencyMap => {
        const key = [...edgeTypes].sort().join('|');
        let adjacency = adjacencyCache.get(key);
        if (!adjacency) {
          adjacency = buildFilteredForwardAdjacency(edges, [...edgeTypes]);
          adjacencyCache.set(key, adjacency);
        }
        return adjacency;
      },
    };

    const violations: RuleViolation[] = [];
    const injected: RuleDetector[] = [];

    try {
      for (const rule of rules) {
        if (!rule.enabled) continue;
        const detector = this.detectors.get(rule.type);
        if (!detector) continue;
        if (detector.setContext) {
          detector.setContext(provider);
          injected.push(detector);
        }
        violations.push(...detector.detect(rule, nodes, edges));
      }
    } finally {
      for (const detector of injected) detector.setContext?.(null);
    }

    return violations;
  }
}

class ForbiddenEdgeDetector implements RuleDetector {
  private context: AdjacencyProvider | null = null;

  setContext(context: AdjacencyProvider | null): void {
    this.context = context;
  }

  detect(rule: RuleDefinition, _nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const edgeTypes = (rule.params.edgeTypes as string[] | undefined) ?? [...DEFAULT_FORBIDDEN_EDGE_TYPES];

    const adjacency = this.context
      ? this.context.adjacencyFor(edgeTypes)
      : buildFilteredForwardAdjacency(edges, edgeTypes);

    // 无环即早退：环存在性 O(V+E) 且遇到第一个 back edge 立刻返回，
    // 无环图上省掉一次「枚举所有环 + booth 去重」的全量 DFS。
    if (!hasCycle(adjacency)) return violations;

    const cycles = detectCyclesDFS(adjacency);

    for (const cycle of cycles) {
      const cycleKey = cycle.sort().join('→');
      const firstNode = cycle[0] ?? '';
      violations.push({
        ruleId: rule.id,
        nodeId: NodeId(firstNode),
        message: `Circular dependency detected involving: ${cycleKey}`,
        severity: rule.severity,
      });
    }

    return violations;
  }
}

class MaxIndegreeDetector implements RuleDetector {
  detect(rule: RuleDefinition, _nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const threshold = (rule.params.threshold as number) ?? 10;

    const indegree = new Map<string, number>();
    for (const edge of edges) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }

    for (const [nodeId, count] of indegree) {
      if (count > threshold) {
        violations.push({
          ruleId: rule.id,
          nodeId: NodeId(nodeId),
          message: `Node ${nodeId} has indegree ${count} (max ${threshold})`,
          severity: rule.severity,
        });
      }
    }

    return violations;
  }
}

class MaxOutdegreeDetector implements RuleDetector {
  detect(rule: RuleDefinition, _nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const threshold = (rule.params.threshold as number) ?? 15;

    const outdegree = new Map<string, number>();
    for (const edge of edges) {
      outdegree.set(edge.source, (outdegree.get(edge.source) ?? 0) + 1);
    }

    for (const [nodeId, count] of outdegree) {
      if (count > threshold) {
        violations.push({
          ruleId: rule.id,
          nodeId: NodeId(nodeId),
          message: `Node ${nodeId} has outdegree ${count} (max ${threshold})`,
          severity: rule.severity,
        });
      }
    }

    return violations;
  }
}

class RequiredEdgeDetector implements RuleDetector {
  detect(rule: RuleDefinition, nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const requiredType = (rule.params.edgeType as string) ?? 'call';
    const sourceType = (rule.params.sourceType as string) ?? undefined;
    const targetType = (rule.params.targetType as string) ?? undefined;

    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const hasEdge = new Set<string>();
    for (const edge of edges) {
      if (edge.type !== requiredType) continue;
      if (sourceType) {
        const src = nodeMap.get(edge.source);
        if (!src || src.type !== sourceType) continue;
      }
      if (targetType) {
        const tgt = nodeMap.get(edge.target);
        if (!tgt || tgt.type !== targetType) continue;
      }
      hasEdge.add(edge.source);
    }

    for (const n of nodes) {
      if (sourceType && n.type !== sourceType) continue;
      if (!hasEdge.has(n.id)) {
        violations.push({
          ruleId: rule.id,
          nodeId: NodeId(n.id),
          message: `Node ${n.label} is missing required ${requiredType} edge`,
          severity: rule.severity,
        });
      }
    }

    return violations;
  }
}

class CrossLayerCallDetector implements RuleDetector {
  detect(rule: RuleDefinition, nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const layerMap = (rule.params.layers as Record<string, string[]>) ?? {};
    const callType = (rule.params.edgeType as string) ?? 'call';

    if (Object.keys(layerMap).length === 0) return violations;

    const nodeLayer = new Map<string, string>();
    for (const n of nodes) {
      for (const [layerName, patterns] of Object.entries(layerMap)) {
        if (patterns.some((p) => {
          const seg = n.filePath.split(/[\\/]/);
          return seg.indexOf(p) >= 0 || n.label === p;
        })) {
          nodeLayer.set(n.id, layerName);
          break;
        }
      }
    }

    const forbiddenPairs = new Set<string>();
    for (const [srcLayer, tgtLayers] of Object.entries(layerMap)) {
      for (const tgtLayer of tgtLayers) {
        forbiddenPairs.add(`${srcLayer}->${tgtLayer}`);
      }
    }

    for (const edge of edges) {
      if (edge.type !== callType) continue;
      const srcLayer = nodeLayer.get(edge.source);
      const tgtLayer = nodeLayer.get(edge.target);
      if (!srcLayer || !tgtLayer) continue;
      if (forbiddenPairs.has(`${srcLayer}->${tgtLayer}`)) {
        violations.push({
          ruleId: rule.id,
          edgeId: EdgeId(edge.id),
          message: `Cross-layer call from ${srcLayer} to ${tgtLayer}`,
          severity: rule.severity,
        });
      }
    }

    return violations;
  }
}
