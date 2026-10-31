import { NodeId, EdgeId, RepoId } from '../types/index.ts';
import type { GraphNode, GraphEdge, GraphData, GraphDelta, EdgeDirection, Layer } from '../types/index.ts';
import { scoped } from './Logger.ts';
import { normalizeNodeType, normalizeEdgeType } from './AliasMapper.ts';

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

export function coerceNode(raw: unknown, i: number): GraphNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : `node-${i}`;
  const label = typeof o.label === 'string' ? o.label : typeof o.name === 'string' ? o.name : id;
  const type = normalizeNodeType(o.type) ?? 'variable';
  const filePath = typeof o.filePath === 'string' ? o.filePath : typeof o.file === 'string' ? o.file : '';
  const lineNumber = typeof o.lineNumber === 'number' ? o.lineNumber : typeof o.line === 'number' ? o.line : 0;
  const properties = (o.properties && typeof o.properties === 'object' ? o.properties : {}) as Record<string, unknown>;
  return { id: NodeId(id), label, type, filePath, lineNumber, properties };
}

export function coerceEdge(raw: unknown, i: number): GraphEdge | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : `edge-${i}`;
  const source = typeof o.source === 'string' ? o.source : typeof o.from === 'string' ? o.from : null;
  const target = typeof o.target === 'string' ? o.target : typeof o.to === 'string' ? o.to : null;
  if (!source || !target) return null;
  const type = normalizeEdgeType(o.type) ?? 'dependency';
  const properties = (o.properties && typeof o.properties === 'object' ? o.properties : {}) as Record<string, unknown>;
  const direction: EdgeDirection = o.direction === 'forward' || o.direction === 'backward' || o.direction === 'bidirectional' ? (o.direction as EdgeDirection) : 'forward';
  const weight = typeof o.weight === 'number' && o.weight >= 0 && o.weight <= 1 ? o.weight : 1;
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, direction, weight, properties };
}

export function coerceGraphData(raw: unknown): GraphData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
  const rawEdges = Array.isArray(o.edges) ? o.edges : [];
  const nodes = rawNodes.map(coerceNode).filter((n): n is GraphNode => n !== null);
  if (nodes.length === 0) return null;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = rawEdges
    .map(coerceEdge)
    .filter((e): e is GraphEdge => e !== null)
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  const metadata = o.metadata as Record<string, unknown> | undefined;
  const repoId = (metadata?.repoId as string | undefined) ?? `workspace-${Date.now()}`;
  const timestamp = typeof metadata?.timestamp === 'number' ? metadata.timestamp : Date.now();
  const truncated = typeof metadata?.truncated === 'boolean' ? metadata.truncated : false;
  const totalNodeCount = typeof metadata?.totalNodeCount === 'number' ? metadata.totalNodeCount : nodes.length;
  const totalEdgeCount = typeof metadata?.totalEdgeCount === 'number' ? metadata.totalEdgeCount : edges.length;
  // 璇玑图增量引擎健康信号（cycle-122）：透传而不是丢弃。
  // coerce 是「修形」不是「重造」——把已验证的未知形状字段剥掉，就会重演
  // cycle-88「AST budget 的 hasMore 三层各丢一次」的家族缺陷（生产者给了、
  // 传输层剥了、消费者永远看不到）。形状校验：applied 必须是布尔才采信。
  const rawXuanji = metadata?.xuanji as Record<string, unknown> | undefined;
  const xuanji = rawXuanji && typeof rawXuanji.applied === 'boolean'
    ? {
        applied: rawXuanji.applied,
        ...(typeof rawXuanji.addedPaths === 'number' ? { addedPaths: rawXuanji.addedPaths } : {}),
        ...(Array.isArray(rawXuanji.degradedRules) ? { degradedRules: rawXuanji.degradedRules as string[] } : {}),
        ...(Array.isArray(rawXuanji.invariantViolations) ? { invariantViolations: rawXuanji.invariantViolations as string[] } : {}),
      }
    : undefined;
  return {
    nodes,
    edges,
    metadata: {
      repoId: RepoId(repoId),
      timestamp,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      truncated,
      totalNodeCount,
      totalEdgeCount,
      ...(xuanji !== undefined ? { xuanji } : {}),
    },
  };
}

export function filterSelfLoopEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.source !== e.target);
}

/**
 * Validate a `graph/delta` payload (P2-21).
 *
 * `coerceNode`/`coerceEdge` drop `parentId` and `layer`, which the renderer needs for an
 * incrementally-added node to sit in the same place a full load would have put it, so both are
 * re-attached here. Returns `null` when the payload is not an object at all — the caller then falls
 * back to a full reload rather than applying a partial graph.
 */
export function coerceGraphDelta(raw: unknown): GraphDelta | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const nodeList = (value: unknown): GraphNode[] => {
    if (!Array.isArray(value)) return [];
    const out: GraphNode[] = [];
    value.forEach((entry, i) => {
      // `coerceNode` invents `node-${i}` when an entry carries no id. That is tolerable for a full
      // load (the graph is self-consistent either way) but not for a delta: an invented id is a node
      // the host never described, and `canApplyGraphDelta` cannot notice because an added node needs
      // no prior existence. Delta entries therefore have to name themselves.
      if (!entry || typeof entry !== 'object') return;
      const src = entry as Record<string, unknown>;
      if (typeof src.id !== 'string' || !src.id) return;
      const node = coerceNode(entry, i);
      if (!node) return;
      if (typeof src.parentId === 'string' && src.parentId) node.parentId = NodeId(src.parentId);
      if (typeof src.layer === 'string' && src.layer) node.layer = src.layer;
      out.push(node);
    });
    return out;
  };

  const edgeList = (value: unknown): GraphEdge[] => {
    if (!Array.isArray(value)) return [];
    const out: GraphEdge[] = [];
    value.forEach((entry, i) => {
      // Same reasoning as `nodeList`: `coerceEdge` falls back to `edge-${i}`.
      if (!entry || typeof entry !== 'object') return;
      const src = entry as Record<string, unknown>;
      if (typeof src.id !== 'string' || !src.id) return;
      const edge = coerceEdge(entry, i);
      if (edge) out.push(edge);
    });
    return out;
  };

  return {
    addedNodes: nodeList(o.addedNodes),
    removedNodes: nodeList(o.removedNodes),
    modifiedNodes: nodeList(o.modifiedNodes),
    addedEdges: edgeList(o.addedEdges),
    removedEdges: edgeList(o.removedEdges),
    modifiedEdges: edgeList(o.modifiedEdges),
  };
}

export function sanitizeTypedGraph(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const seenNodeIds = new Set<string>();
  const validNodes: GraphNode[] = [];
  for (const node of nodes) {
    if (!node || !node.id || !node.label || !node.type || !node.filePath) continue;
    if (seenNodeIds.has(node.id)) continue;
    seenNodeIds.add(node.id);
    validNodes.push(node);
  }

  const nodeIdSet = new Set(validNodes.map((n) => n.id));
  const seenEdgeIds = new Set<string>();
  const validEdges: GraphEdge[] = [];
  for (const edge of edges) {
    if (!edge || !edge.id || !edge.source || !edge.target) continue;
    if (edge.source === edge.target) continue;
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    if (seenEdgeIds.has(edge.id)) continue;
    seenEdgeIds.add(edge.id);
    validEdges.push(edge);
  }

  return { nodes: validNodes, edges: validEdges };
}


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

  const filePath = typeof raw.filePath === 'string' ? raw.filePath : typeof raw.file === 'string' ? raw.file : '';
  if (raw.filePath !== filePath) {
    issues.push({ level: 'auto-corrected', category: 'node', message: 'filePath missing, defaulting to empty', path: `${path}.filePath` });
  }

  const lineNumber = typeof raw.lineNumber === 'number' && !Number.isNaN(raw.lineNumber) ? raw.lineNumber : typeof raw.line === 'number' && !Number.isNaN(raw.line) ? raw.line : undefined;
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

  const source = raw.source ?? raw.from;
  if (typeof source !== 'string' || source.length === 0) {
    issues.push({ level: 'dropped', category: 'edge', message: 'missing or invalid source', path });
    return null;
  }

  const target = raw.target ?? raw.to;
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

interface ProcessedInput {
  fixedNodes: GraphNode[];
  fixedEdges: GraphEdge[];
  issues: GraphIssue[];
  root: Record<string, unknown>;
}

function processRawInput(raw: unknown): ProcessedInput | ValidationResult {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {
      data: { nodes: [], edges: [], metadata: { repoId: '' as RepoId, timestamp: 0, nodeCount: 0, edgeCount: 0 } },
      issues: [{ level: 'fatal', category: 'data', message: 'input is null or not an object', path: 'root' }],
    };
  }

  const root = raw as Record<string, unknown>;
  const issues: GraphIssue[] = [];

  const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
  const rawEdges = Array.isArray(root.edges) ? root.edges : [];

  const sanitizedNodes = rawNodes.map(n => sanitizeNode(n)).filter((n): n is Record<string, unknown> => n !== null);
  const sanitizedEdges = rawEdges.map(e => sanitizeEdge(e)).filter((e): e is Record<string, unknown> => e !== null);

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

  return { fixedNodes, fixedEdges, issues, root };
}

function buildDefaultMetadata(root: Record<string, unknown>, nodeCount: number, edgeCount: number): GraphData['metadata'] {
  return (root.metadata && typeof root.metadata === 'object')
    ? root.metadata as GraphData['metadata']
    : { repoId: '' as RepoId, timestamp: Date.now(), nodeCount, edgeCount };
}

export function validateGraphData(raw: unknown): ValidationResult {
  const processed = processRawInput(raw);
  if ('data' in processed) return processed;

  const { fixedNodes, fixedEdges, issues, root } = processed;

  if (!Array.isArray(root.nodes)) {
    issues.push({ level: 'auto-corrected', category: 'data', message: 'nodes is not an array, defaulting to empty', path: 'nodes' });
  }
  if (!Array.isArray(root.edges)) {
    issues.push({ level: 'auto-corrected', category: 'data', message: 'edges is not an array, defaulting to empty', path: 'edges' });
  }

  const deduped = validateNoDuplicateIds(fixedNodes, fixedEdges, issues);
  const validEdges = validateReferentialIntegrity(deduped.nodes, deduped.edges, issues);

  const metadata = buildDefaultMetadata(root, deduped.nodes.length, validEdges.length);

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
  const processed = processRawInput(raw);
  if ('data' in processed) return processed;

  const { fixedNodes, fixedEdges, issues, root } = processed;

  const metadata = buildDefaultMetadata(root, fixedNodes.length, fixedEdges.length);

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