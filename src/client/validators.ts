import { NodeId, EdgeId, RepoId } from '../types/index.ts';
import type { GraphNode, GraphEdge, GraphData } from '../types/index.ts';

export function coerceNode(raw: unknown, i: number): GraphNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : `node-${i}`;
  const label = typeof o.label === 'string' ? o.label : typeof o.name === 'string' ? o.name : id;
  const type = (['function', 'class', 'variable', 'module', 'interface', 'type'].includes(o.type as string)
    ? o.type : 'variable') as GraphNode['type'];
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
  const type = (['call', 'import', 'extend', 'implement', 'dependency', 'contains'].includes(o.type as string)
    ? o.type : 'dependency') as GraphEdge['type'];
  const properties = (o.properties && typeof o.properties === 'object' ? o.properties : {}) as Record<string, unknown>;
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties };
}

export function validateGraphData(raw: unknown): GraphData | null {
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
    },
  };
}