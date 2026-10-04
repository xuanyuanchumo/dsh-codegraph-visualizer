import type { GraphNode, GraphEdge, GraphDelta } from '../types/index.ts';

/**
 * Structural difference between two graph revisions.
 *
 * The shape is declared in `types/index.ts` (where the Cordis event payloads live) and re-exported
 * here so both the host diff engine and the client store can name it without importing each other.
 */
export type { GraphDelta };

export interface GraphSkeleton {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** No structural change at all — callers use this to skip an emit entirely. */
export function isEmptyGraphDelta(delta: GraphDelta): boolean {
  return delta.addedNodes.length === 0 && delta.removedNodes.length === 0 &&
    delta.modifiedNodes.length === 0 && delta.addedEdges.length === 0 &&
    delta.removedEdges.length === 0 && delta.modifiedEdges.length === 0;
}

/** Counts per side, for logging and for the SSE payload's own summary. */
export function graphDeltaSize(delta: GraphDelta): { nodes: number; edges: number } {
  return {
    nodes: delta.addedNodes.length + delta.removedNodes.length + delta.modifiedNodes.length,
    edges: delta.addedEdges.length + delta.removedEdges.length + delta.modifiedEdges.length,
  };
}

/**
 * Apply `delta` to `current`, returning a new skeleton.
 *
 * Removals are processed before upserts: `computeGraphDiff` reports the *before* state for removed
 * entries and the *after* state for added/modified ones, so an id that moved between buckets within
 * one delta would otherwise resurrect a deleted node.
 */
export function applyGraphDelta(current: GraphSkeleton, delta: GraphDelta): GraphSkeleton {
  const removedNodeIds = new Set<string>(delta.removedNodes.map((n) => n.id as string));
  const removedEdgeIds = new Set<string>(delta.removedEdges.map((e) => e.id as string));

  const nodes = new Map<string, GraphNode>();
  for (const n of current.nodes) {
    if (!removedNodeIds.has(n.id as string)) nodes.set(n.id as string, n);
  }
  for (const n of delta.addedNodes) nodes.set(n.id as string, n);
  for (const n of delta.modifiedNodes) nodes.set(n.id as string, n);

  const edges = new Map<string, GraphEdge>();
  for (const e of current.edges) {
    if (!removedEdgeIds.has(e.id as string)) edges.set(e.id as string, e);
  }
  for (const e of delta.addedEdges) edges.set(e.id as string, e);
  for (const e of delta.modifiedEdges) edges.set(e.id as string, e);

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * Whether `delta` can be applied to `current` without corrupting it.
 *
 * A delta is only meaningful against the exact revision it was computed from. When the client's
 * copy has drifted (a full `graph/data` landed mid-flight, a reconnect skipped events, the store
 * was reset) applying it would silently drop or resurrect entries, so the client uses this to
 * decide between `applyGraphDelta` and a full re-bootstrap.
 *
 * Two things are checked: every removed/modified entry must exist in `current` (otherwise the
 * delta describes a revision we never had), and every edge the delta introduces or touches must
 * have both endpoints present once the node changes are folded in (otherwise we would publish
 * dangling edges).
 */
export function canApplyGraphDelta(current: GraphSkeleton, delta: GraphDelta): boolean {
  const currentNodeIds = new Set<string>(current.nodes.map((n) => n.id as string));
  const currentEdgeIds = new Set<string>(current.edges.map((e) => e.id as string));

  for (const n of delta.removedNodes) if (!currentNodeIds.has(n.id as string)) return false;
  for (const n of delta.modifiedNodes) if (!currentNodeIds.has(n.id as string)) return false;
  for (const e of delta.removedEdges) if (!currentEdgeIds.has(e.id as string)) return false;
  for (const e of delta.modifiedEdges) if (!currentEdgeIds.has(e.id as string)) return false;

  const nextNodeIds = new Set<string>(currentNodeIds);
  for (const n of delta.removedNodes) nextNodeIds.delete(n.id as string);
  for (const n of delta.addedNodes) nextNodeIds.add(n.id as string);
  for (const n of delta.modifiedNodes) nextNodeIds.add(n.id as string);

  for (const e of [...delta.addedEdges, ...delta.modifiedEdges]) {
    if (!nextNodeIds.has(e.source as string) || !nextNodeIds.has(e.target as string)) return false;
  }
  return true;
}
