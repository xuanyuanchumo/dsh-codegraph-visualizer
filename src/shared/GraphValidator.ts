import type { GraphNode, GraphEdge, GraphData, NodeId, EdgeId, RepoId, EdgeDirection, Layer } from '../types/index.ts';
import { scoped } from './Logger.ts';

const log = scoped('validator');

export type IssueLevel = 'auto-corrected' | 'dropped' | 'fatal';

export interface GraphIssue {
  level: IssueLevel;
  category: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  data: GraphData;
  issues: GraphIssue[];
}

const NODE_TYPE_ALIASES: Record<string, GraphNode['type']> = {
  func: 'function',
  fn: 'function',
  method: 'function',
  cls: 'class',
  mod: 'module',
  file: 'module',
  pkg: 'module',
  package: 'module',
  iface: 'interface',
  typ: 'type',
  enum: 'type',
  const: 'variable',
  var: 'variable',
  let: 'variable',
};

const EDGE_TYPE_ALIASES: Record<string, GraphEdge['type']> = {
  calls: 'call',
  invoke: 'call',
  invokes: 'call',
  imports: 'import',
  import_from: 'import',
  extends: 'extend',
  inherits: 'extend',
  inherit: 'extend',
  implements: 'implement',
  implements_interface: 'implement',
  depends: 'dependency',
  depends_on: 'dependency',
  uses: 'dependency',
  contains_node: 'contains',
  owns: 'contains',
  has: 'contains',
  assoc: 'association',
  related: 'association',
  aggregates: 'aggregation',
  aggregate: 'aggregation',
  composes: 'composition',
  compose: 'composition',
};

const VALID_NODE_TYPES = new Set(['function', 'class', 'variable', 'module', 'interface', 'type']);
const VALID_EDGE_TYPES = new Set(['call', 'import', 'extend', 'implement', 'dependency', 'contains', 'association', 'aggregation', 'composition']);

function sanitizeNode(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const node = raw as Record<string, unknown>;
  if (node.tags === null || node.tags === undefined) node.tags = [];
  if (node.properties === null || node.properties === undefined) node.properties = {};
  if (node.type && typeof node.type === 'string') node.type = node.type.toLowerCase();
  if (node.direction && typeof node.direction === 'string') node.direction = node.direction.toLowerCase();
  return node;
}

function sanitizeEdge(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const edge = raw as Record<string, unknown>;
  if (edge.properties === null || edge.properties === undefined) edge.properties = {};
  if (edge.type && typeof edge.type === 'string') edge.type = edge.type.toLowerCase();
  if (edge.direction && typeof edge.direction === 'string') edge.direction = edge.direction.toLowerCase();
  return edge;
}

function normalizeNodeType(type: unknown): GraphNode['type'] | null {
  if (typeof type !== 'string') return null;
  if (VALID_NODE_TYPES.has(type as GraphNode['type'])) return type as GraphNode['type'];
  const alias = NODE_TYPE_ALIASES[type];
  if (alias) return alias;
  return null;
}

function normalizeEdgeType(type: unknown): GraphEdge['type'] | null {
  if (typeof type !== 'string') return null;
  if (VALID_EDGE_TYPES.has(type as GraphEdge['type'])) return type as GraphEdge['type'];
  const alias = EDGE_TYPE_ALIASES[type];
  if (alias) return alias;
  return null;
}

function autoFixNode(raw: Record<string, unknown>, issues: GraphIssue[], path: string): GraphNode | null {
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    issues.push({ level: 'dropped', category: 'node', message: 'missing or invalid id', path });
    return null;
  }

  const label = typeof raw.label === 'string' ? raw.label : (raw.name as string | undefined) ?? id;
  if (raw.label !== label) {
    issues.push({ level: 'auto-corrected', category: 'node', message: `label missing, using id/name: ${label}`, path: `${path}.label` });
  }

  let type = normalizeNodeType(raw.type);
  if (!type) {
    type = 'function';
    issues.push({ level: 'auto-corrected', category: 'node', message: `unknown type "${raw.type}", defaulting to "function"`, path: `${path}.type` });
  }

  const filePath = typeof raw.filePath === 'string' ? raw.filePath : '';
  if (raw.filePath !== filePath) {
    issues.push({ level: 'auto-corrected', category: 'node', message: 'filePath missing, defaulting to empty', path: `${path}.filePath` });
  }

  const lineNumber = typeof raw.lineNumber === 'number' && !Number.isNaN(raw.lineNumber) ? raw.lineNumber : undefined;
  const properties = (raw.properties && typeof raw.properties === 'object') ? raw.properties as Record<string, unknown> : {};
  const parentId = typeof raw.parentId === 'string' && raw.parentId.length > 0 ? raw.parentId as NodeId : undefined;
  const summary = typeof raw.summary === 'string' ? raw.summary : undefined;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === 'string') : [];
  const complexity = raw.complexity === 'simple' || raw.complexity === 'moderate' || raw.complexity === 'complex' ? raw.complexity : undefined;
  const layer = typeof raw.layer === 'string' ? raw.layer : undefined;

  const node: GraphNode = {
    id: id as NodeId,
    label,
    type,
    filePath,
    properties,
    tags,
  };
  if (lineNumber !== undefined) node.lineNumber = lineNumber;
  if (parentId !== undefined) node.parentId = parentId;
  if (summary !== undefined) node.summary = summary;
  if (complexity !== undefined) node.complexity = complexity;
  if (layer !== undefined) node.layer = layer;

  return node;
}

function autoFixEdge(raw: Record<string, unknown>, issues: GraphIssue[], path: string): GraphEdge | null {
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    issues.push({ level: 'dropped', category: 'edge', message: 'missing or invalid id', path });
    return null;
  }

  const source = raw.source;
  if (typeof source !== 'string' || source.length === 0) {
    issues.push({ level: 'dropped', category: 'edge', message: 'missing or invalid source', path });
    return null;
  }

  const target = raw.target;
  if (typeof target !== 'string' || target.length === 0) {
    issues.push({ level: 'dropped', category: 'edge', message: 'missing or invalid target', path });
    return null;
  }

  let type = normalizeEdgeType(raw.type);
  if (!type) {
    type = 'association';
    issues.push({ level: 'auto-corrected', category: 'edge', message: `unknown type "${raw.type}", defaulting to "association"`, path: `${path}.type` });
  }

  const direction: EdgeDirection = raw.direction === 'forward' || raw.direction === 'backward' || raw.direction === 'bidirectional' ? (raw.direction as EdgeDirection) : 'forward';
  if (raw.direction !== direction && raw.direction !== undefined) {
    issues.push({ level: 'auto-corrected', category: 'edge', message: `invalid direction "${raw.direction}", defaulting to "forward"`, path: `${path}.direction` });
  }

  let weight = typeof raw.weight === 'number' && !Number.isNaN(raw.weight) ? raw.weight : 1;
  if (weight < 0) {
    weight = 0;
    issues.push({ level: 'auto-corrected', category: 'edge', message: 'weight clamped to 0', path: `${path}.weight` });
  }
  if (weight > 1) {
    weight = 1;
    issues.push({ level: 'auto-corrected', category: 'edge', message: 'weight clamped to 1', path: `${path}.weight` });
  }

  const properties = (raw.properties && typeof raw.properties === 'object') ? raw.properties as Record<string, unknown> : {};

  const edge: GraphEdge = {
    id: id as EdgeId,
    source: source as NodeId,
    target: target as NodeId,
    type,
    direction,
    weight,
    properties,
  };

  return edge;
}

function validateReferentialIntegrity(nodes: GraphNode[], edges: GraphEdge[], issues: GraphIssue[]): GraphEdge[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges: GraphEdge[] = [];
  let droppedCount = 0;

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({ level: 'dropped', category: 'edge', message: `source node "${edge.source}" not found`, path: `edge.${edge.id}.source` });
      droppedCount++;
      continue;
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({ level: 'dropped', category: 'edge', message: `target node "${edge.target}" not found`, path: `edge.${edge.id}.target` });
      droppedCount++;
      continue;
    }
    validEdges.push(edge);
  }

  if (droppedCount > 0) {
    log.warn(`referential integrity: dropped ${droppedCount} edges with missing endpoints`);
  }

  return validEdges;
}

function validateNoDuplicateIds(nodes: GraphNode[], edges: GraphEdge[], issues: GraphIssue[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const seenNodeIds = new Set<string>();
  const dedupedNodes: GraphNode[] = [];
  let nodeDupCount = 0;

  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      issues.push({ level: 'dropped', category: 'node', message: `duplicate node id "${node.id}"`, path: `node.${node.id}` });
      nodeDupCount++;
      continue;
    }
    seenNodeIds.add(node.id);
    dedupedNodes.push(node);
  }

  const seenEdgeIds = new Set<string>();
  const dedupedEdges: GraphEdge[] = [];
  let edgeDupCount = 0;

  for (const edge of edges) {
    if (seenEdgeIds.has(edge.id)) {
      issues.push({ level: 'dropped', category: 'edge', message: `duplicate edge id "${edge.id}"`, path: `edge.${edge.id}` });
      edgeDupCount++;
      continue;
    }
    seenEdgeIds.add(edge.id);
    dedupedEdges.push(edge);
  }

  if (nodeDupCount > 0) log.warn(`dedup: removed ${nodeDupCount} duplicate node ids`);
  if (edgeDupCount > 0) log.warn(`dedup: removed ${edgeDupCount} duplicate edge ids`);

  return { nodes: dedupedNodes, edges: dedupedEdges };
}

export function validateGraphData(raw: unknown): ValidationResult {
  const issues: GraphIssue[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {
      data: { nodes: [], edges: [], metadata: { repoId: '' as RepoId, timestamp: 0, nodeCount: 0, edgeCount: 0 } },
      issues: [{ level: 'fatal', category: 'data', message: 'input is null or not an object', path: 'root' }],
    };
  }

  const root = raw as Record<string, unknown>;

  const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
  const rawEdges = Array.isArray(root.edges) ? root.edges : [];

  if (!Array.isArray(root.nodes)) {
    issues.push({ level: 'auto-corrected', category: 'data', message: 'nodes is not an array, defaulting to empty', path: 'nodes' });
  }
  if (!Array.isArray(root.edges)) {
    issues.push({ level: 'auto-corrected', category: 'data', message: 'edges is not an array, defaulting to empty', path: 'edges' });
  }

  const sanitizedNodes = rawNodes.map((n, i) => sanitizeNode(n)).filter((n): n is Record<string, unknown> => n !== null);
  const sanitizedEdges = rawEdges.map((e, i) => sanitizeEdge(e)).filter((e): e is Record<string, unknown> => e !== null);

  const fixedNodes: GraphNode[] = [];
  for (const sanitizedNode of sanitizedNodes) {
    const fixed = autoFixNode(sanitizedNode, issues, `node[${fixedNodes.length}]`);
    if (fixed) fixedNodes.push(fixed);
  }

  const fixedEdges: GraphEdge[] = [];
  for (const sanitizedEdge of sanitizedEdges) {
    const fixed = autoFixEdge(sanitizedEdge, issues, `edge[${fixedEdges.length}]`);
    if (fixed) fixedEdges.push(fixed);
  }

  const deduped = validateNoDuplicateIds(fixedNodes, fixedEdges, issues);
  const validEdges = validateReferentialIntegrity(deduped.nodes, deduped.edges, issues);

  const metadata = (root.metadata && typeof root.metadata === 'object')
    ? root.metadata as GraphData['metadata']
    : { repoId: '' as RepoId, timestamp: Date.now(), nodeCount: deduped.nodes.length, edgeCount: validEdges.length };

  if (!root.metadata || typeof root.metadata !== 'object') {
    issues.push({ level: 'auto-corrected', category: 'data', message: 'metadata missing, generated default', path: 'metadata' });
  }

  const data: GraphData = {
    nodes: deduped.nodes,
    edges: validEdges,
    metadata: {
      ...metadata,
      nodeCount: deduped.nodes.length,
      edgeCount: validEdges.length,
    },
  };
  if (Array.isArray(root.layers) && root.layers.length > 0) {
    data.layers = root.layers as unknown as Layer[];
  }

  const fatalCount = issues.filter((i) => i.level === 'fatal').length;
  const droppedCount = issues.filter((i) => i.level === 'dropped').length;
  const autoCorrectedCount = issues.filter((i) => i.level === 'auto-corrected').length;

  if (issues.length > 0) {
    log.info(`validation complete: ${autoCorrectedCount} auto-corrected, ${droppedCount} dropped, ${fatalCount} fatal`);
  }

  return { data, issues };
}
export function sanitizeGraphData(raw: unknown): ValidationResult {
  const issues: GraphIssue[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {
      data: { nodes: [], edges: [], metadata: { repoId: '' as RepoId, timestamp: 0, nodeCount: 0, edgeCount: 0 } },
      issues: [{ level: 'fatal', category: 'data', message: 'input is null or not an object', path: 'root' }],
    };
  }

  const root = raw as Record<string, unknown>;

  const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
  const rawEdges = Array.isArray(root.edges) ? root.edges : [];

  const sanitizedNodes = rawNodes.map((n) => sanitizeNode(n)).filter((n): n is Record<string, unknown> => n !== null);
  const sanitizedEdges = rawEdges.map((e) => sanitizeEdge(e)).filter((e): e is Record<string, unknown> => e !== null);

  const fixedNodes: GraphNode[] = [];
  for (const sanitizedNode of sanitizedNodes) {
    const fixed = autoFixNode(sanitizedNode, issues, `node[${fixedNodes.length}]`);
    if (fixed) fixedNodes.push(fixed);
  }

  const fixedEdges: GraphEdge[] = [];
  for (const sanitizedEdge of sanitizedEdges) {
    const fixed = autoFixEdge(sanitizedEdge, issues, `edge[${fixedEdges.length}]`);
    if (fixed) fixedEdges.push(fixed);
  }

  const metadata = (root.metadata && typeof root.metadata === 'object')
    ? root.metadata as GraphData['metadata']
    : { repoId: '' as RepoId, timestamp: Date.now(), nodeCount: fixedNodes.length, edgeCount: fixedEdges.length };

  const data: GraphData = {
    nodes: fixedNodes,
    edges: fixedEdges,
    metadata: {
      ...metadata,
      nodeCount: fixedNodes.length,
      edgeCount: fixedEdges.length,
    },
  };

  return { data, issues };
}