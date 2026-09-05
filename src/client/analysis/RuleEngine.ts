import type { GraphNode, GraphEdge, NodeId, EdgeId } from '../../types/index.ts';

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
    const path: string[] = [];

    const enter = (start: string): void => {
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          violations.push({
            ruleId: rule.id,
            nodeId: target as NodeId,
            message: `Circular dependency detected: ${target}`,
            severity: rule.severity,
          });
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
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
          nodeId: nodeId as NodeId,
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
          nodeId: nodeId as NodeId,
          message: `Node ${nodeId} has outdegree ${count} (max ${threshold})`,
          severity: rule.severity,
        });
      }
    }

    return violations;
  }
}