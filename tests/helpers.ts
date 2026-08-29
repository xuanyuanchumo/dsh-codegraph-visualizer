// Shared test helpers: build Branded graph elements without leaking bare strings.
import { NodeId, EdgeId, RepoId } from '../src/types/index.ts';
import type { GraphNode, GraphEdge, GraphData } from '../src/types/index.ts';

export function makeNode(
  id: string,
  label: string,
  type: GraphNode['type'],
  file: string,
  line: number,
  properties: Record<string, unknown> = {},
): GraphNode {
  return { id: NodeId(id), label, type, filePath: file, lineNumber: line, properties };
}

export function makeEdge(
  id: string,
  source: string,
  target: string,
  type: GraphEdge['type'],
  properties: Record<string, unknown> = {},
): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties };
}

export function makeGraphData(
  nodes: GraphNode[],
  edges: GraphEdge[],
  repoId = 'test-repo',
  timestamp = 1,
): GraphData {
  return {
    nodes,
    edges,
    metadata: { repoId: RepoId(repoId), timestamp, nodeCount: nodes.length, edgeCount: edges.length },
  };
}