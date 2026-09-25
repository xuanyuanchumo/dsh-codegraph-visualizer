import type { GraphNode, GraphEdge } from '../../types/index.ts';

export interface TourStep {
  id: string;
  title: string;
  description: string;
  nodeId: string;
  nodeType: string;
  filePath: string;
  dependencies: string[];
  dependents: string[];
  layer: string;
}

export interface Tour {
  steps: TourStep[];
  totalSteps: number;
  entryPoints: string[];
}

const ENTRY_NAME_PATTERNS = ['main', 'index', 'app', 'entry', 'start', 'server', 'cli'];
const LAYER_ORDER = ['entry', 'api', 'service', 'data', 'ui', 'utility', 'other'];

function classifyLayer(node: GraphNode): string {
  const path = node.filePath?.toLowerCase() ?? '';
  const name = node.label?.toLowerCase() ?? '';
  if (ENTRY_NAME_PATTERNS.some((p) => name.includes(p) || path.includes(p))) return 'entry';
  if (path.includes('api') || path.includes('route') || path.includes('controller')) return 'api';
  if (path.includes('service') || path.includes('business') || path.includes('domain')) return 'service';
  if (path.includes('data') || path.includes('model') || path.includes('db') || path.includes('repository')) return 'data';
  if (path.includes('ui') || path.includes('component') || path.includes('view') || path.includes('page')) return 'ui';
  if (path.includes('util') || path.includes('helper') || path.includes('common') || path.includes('shared')) return 'utility';
  return 'other';
}

function buildAdjacencyMaps(edges: GraphEdge[]): {
  outMap: Map<string, string[]>;
  inMap: Map<string, string[]>;
} {
  const outMap = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  for (const edge of edges) {
    const out = outMap.get(edge.source) ?? [];
    out.push(edge.target);
    outMap.set(edge.source, out);
    const inc = inMap.get(edge.target) ?? [];
    inc.push(edge.source);
    inMap.set(edge.target, inc);
  }
  return { outMap, inMap };
}

function findEntryPoints(nodes: GraphNode[], inMap: Map<string, string[]>): string[] {
  const noIncoming = nodes.filter((n) => !inMap.has(n.id) || inMap.get(n.id)!.length === 0);
  if (noIncoming.length > 0) {
    return noIncoming.map((n) => n.id);
  }
  const named = nodes.filter((n) =>
    ENTRY_NAME_PATTERNS.some((p) => n.label?.toLowerCase().includes(p)),
  );
  if (named.length > 0) return named.map((n) => n.id);
  return nodes.slice(0, 5).map((n) => n.id);
}

function topologicalSort(
  nodeIds: string[],
  outMap: Map<string, string[]>,
  inMap: Map<string, string[]>,
): string[] {
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  const result: string[] = [];
  const visited = new Set<string>();

  for (const id of nodeIds) {
    const deg = inMap.get(id)?.length ?? 0;
    inDegree.set(id, deg);
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    const neighbors = outMap.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!nodeIds.includes(neighbor)) continue;
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg <= 0 && !visited.has(neighbor)) queue.push(neighbor);
    }
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) result.push(id);
  }

  return result;
}

function generateDescription(node: GraphNode, deps: string[], dependents: string[]): string {
  const parts: string[] = [];
  const typeLabel = node.type === 'function' ? '函数' : node.type === 'class' ? '类' : node.type === 'module' ? '模块' : node.type === 'interface' ? '接口' : '变量';
  parts.push(`${typeLabel} ${node.label}`);

  if (node.filePath) {
    parts.push(`位于 ${node.filePath}`);
  }

  if (deps.length > 0) {
    parts.push(`依赖 ${deps.length} 个其他节点`);
  }

  if (dependents.length > 0) {
    parts.push(`被 ${dependents.length} 个节点引用`);
  }

  if (deps.length === 0 && dependents.length === 0) {
    parts.push('独立节点，无依赖关系');
  }

  return parts.join('，');
}

export function buildTour(nodes: GraphNode[], edges: GraphEdge[], maxSteps = 30): Tour {
  if (nodes.length === 0) {
    return { steps: [], totalSteps: 0, entryPoints: [] };
  }

  const { outMap, inMap } = buildAdjacencyMaps(edges);
  const entryPoints = findEntryPoints(nodes, inMap);
  const allNodeIds = nodes.map((n) => n.id);
  const sortedIds = topologicalSort(allNodeIds, outMap, inMap);

  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const layerGroups = new Map<string, string[]>();
  for (const id of sortedIds) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const layer = classifyLayer(node);
    const group = layerGroups.get(layer) ?? [];
    group.push(id);
    layerGroups.set(layer, group);
  }

  const orderedIds: string[] = [];
  for (const layer of LAYER_ORDER) {
    const ids = layerGroups.get(layer) ?? [];
    orderedIds.push(...ids);
  }

  const limitedIds = orderedIds.slice(0, maxSteps);

  const steps: TourStep[] = limitedIds.map((id) => {
    const node = nodeMap.get(id)!;
    const deps = outMap.get(id) ?? [];
    const dependents = inMap.get(id) ?? [];
    return {
      id: `tour-${id}`,
      title: node.label,
      description: generateDescription(node, deps, dependents),
      nodeId: id,
      nodeType: node.type,
      filePath: node.filePath ?? '',
      dependencies: deps,
      dependents,
      layer: classifyLayer(node),
    };
  });

  return {
    steps,
    totalSteps: steps.length,
    entryPoints,
  };
}