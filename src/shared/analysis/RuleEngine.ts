import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';

export type RuleType = 'forbidden-edge' | 'required-edge' | 'max-indegree' | 'max-outdegree' | 'cross-layer-call';

export interface RuleDefinition {
  id: string;
  name: string;
  type: RuleType;
  params: Record<string, unknown>;
  severity: 'error' | 'warning';
  enabled: boolean;
}

export interface RuleViolation {
  ruleId: string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  message: string;
  severity: 'error' | 'warning';
}

export interface RuleDetector {
  detect(rule: RuleDefinition, nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[];
}

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

  check(rules: RuleDefinition[], nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const detector = this.detectors.get(rule.type);
      if (detector) {
        violations.push(...detector.detect(rule, nodes, edges));
      }
    }
    return violations;
  }
}

class ForbiddenEdgeDetector implements RuleDetector {
  detect(rule: RuleDefinition, nodes: GraphNode[], edges: GraphEdge[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const edgeTypes = (rule.params.edgeTypes as string[]) ?? ['call', 'import', 'dependency'];

    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!edgeTypes.includes(edge.type)) continue;
      const list = adjacency.get(edge.source);
      if (list) list.push(edge.target);
      else adjacency.set(edge.source, [edge.target]);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const reportedCycles = new Set<string>();

    const enter = (start: string): void => {
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleKey = [target, ...frames.slice(frames.findIndex(f => f.id === target)).map(f => f.id)].sort().join('→');
          if (!reportedCycles.has(cycleKey)) {
            reportedCycles.add(cycleKey);
            violations.push({
              ruleId: rule.id,
              nodeId: NodeId(target),
              message: `Circular dependency detected involving: ${cycleKey}`,
              severity: rule.severity,
            });
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
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
          return seg.includes(p) || n.label === p;
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