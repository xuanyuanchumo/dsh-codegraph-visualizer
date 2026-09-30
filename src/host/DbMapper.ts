import type { GraphNode, GraphEdge } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import { mapNodeKind, mapEdgeKind, isNoisePath } from '../adapters/CodeGraphAdapter.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';

export interface DbNodeRow {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line: number;
  signature: string | null;
  docstring: string | null;
  is_exported: number;
}

export interface DbEdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  line: number | null;
}

export function mapDbNodesToGraphNodes(
  dbNodes: DbNodeRow[],
  parentId?: string,
): GraphNode[] {
  return dbNodes
    .filter((n) => n.name && n.file_path && !isNoisePath(n.file_path))
    .map((n) => ({
      id: NodeId(n.id),
      label: n.name,
      type: mapNodeKind(n.kind),
      filePath: n.file_path,
      lineNumber: n.start_line ?? 1,
      properties: {
        kind: n.kind,
        ...(n.signature ? { signature: n.signature } : {}),
        ...(n.docstring ? { docstring: n.docstring } : {}),
        exported: n.is_exported === 1,
      },
      ...(parentId ? { parentId: NodeId(parentId) } : {}),
      layer: inferLayerFromPath(n.file_path),
    }));
}

export function mapDbEdgesToGraphEdges(dbEdges: DbEdgeRow[]): GraphEdge[] {
  return dbEdges.map((e) => ({
    id: EdgeId(String(e.id)),
    source: NodeId(e.source),
    target: NodeId(e.target),
    type: mapEdgeKind(e.kind),
    properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
  }));
}