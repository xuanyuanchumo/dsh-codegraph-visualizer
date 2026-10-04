import { scoped } from '../shared/Logger.ts';
import { INCREMENTAL } from '../shared/constants.ts';
import { readFilesFromDb, resolveDbPath, normalizeRepoPath } from '../adapters/CodeGraphAdapter.ts';
import { mapDbNodesToGraphNodes, mapDbEdgesToGraphEdges } from './DbMapper.ts';
import { computeGraphDiff } from '../merger/DiffEngine.ts';
import { applyGraphDelta, canApplyGraphDelta, isEmptyGraphDelta, graphDeltaSize } from '../shared/graphDelta.ts';
import type { GraphDelta } from '../shared/graphDelta.ts';
import type { GraphData, GraphNode, GraphEdge } from '../types/index.ts';

const log = scoped('host');

export interface IncrementalUpdateInput {
  /** Workspace root; the index is resolved from it via `resolveDbPath`. */
  workspacePath: string;
  /** Repo-relative paths the watcher observed. Empty means "nothing usable to target". */
  changedFiles: string[];
  /** The graph the client currently renders; the diff is computed against this. */
  current: GraphData;
  /**
   * Absolute timestamp for the produced revision. Defaults to `Date.now()`; injectable so callers
   * can keep the revision time aligned with the rest of the event payload.
   */
  timestamp?: number;
}

export interface IncrementalUpdateResult {
  /** Structural difference to publish. Empty when the changed files produced no graph change. */
  delta: GraphDelta;
  /** `current` with `delta` folded in — the host's new authoritative graph. */
  next: GraphData;
  /** How many index rows the targeted read pulled back, for logging/diagnostics. */
  scanned: { nodes: number; edges: number };
}

/** Does `node` live in one of the changed files (or under one of the changed directories)? */
function belongsToChangedFile(node: GraphNode, changed: Set<string>): boolean {
  const file = normalizeRepoPath(node.filePath ?? '');
  if (!file) return false;
  if (changed.has(file)) return true;
  for (const c of changed) {
    if (file.startsWith(`${c}/`)) return true;
  }
  return false;
}

/** Recompute a graph's counts from its arrays; the index's own counts can lag the change. */
function withCounts(nodes: GraphNode[], edges: GraphEdge[], previous: GraphData['metadata'], timestamp: number): GraphData {
  return {
    nodes,
    edges,
    metadata: {
      ...previous,
      timestamp,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      totalNodeCount: nodes.length,
      totalEdgeCount: edges.length,
    },
  };
}

/**
 * Build an incremental graph update from the files the watcher saw change (P2-21).
 *
 * The update layer used to be missing entirely: `scanAndPush` called `fetchMergedGraph` on every
 * debounce tick, re-reading and re-merging the whole index even for a one-line edit. This reads
 * back only the changed files' own rows and diffs them against the matching slice of the graph the
 * client already has, so the payload and the client's re-render are proportional to the edit rather
 * than to the repo.
 *
 * The diff is deliberately scoped: `before` is the subset of the current graph whose nodes live in
 * the changed files, `after` is what the index now reports for those same files. That scope is what
 * makes deletions detectable — a symbol removed from a file simply stops appearing in the targeted
 * read, while a node in an untouched file can never be reported as removed.
 *
 * Returns `null` when the targeted path is not usable (index unreadable, too many changed files, or
 * a delta that does not cleanly apply to the current graph); the caller then falls back to the
 * whole-graph fetch. A non-null result with an empty `delta` means the read succeeded and the graph
 * genuinely did not change.
 */
export function buildIncrementalUpdate(input: IncrementalUpdateInput): IncrementalUpdateResult | null {
  const { workspacePath, changedFiles, current } = input;
  if (changedFiles.length === 0) return null;
  if (changedFiles.length > INCREMENTAL.MAX_CHANGED_FILES) {
    log.info('incremental update skipped: too many changed files', { count: changedFiles.length, max: INCREMENTAL.MAX_CHANGED_FILES });
    return null;
  }

  let dbPath: string;
  try {
    dbPath = resolveDbPath(workspacePath);
  } catch (e) {
    log.warn('incremental update skipped: unresolvable workspace', e);
    return null;
  }

  const rows = readFilesFromDb(dbPath, changedFiles);
  if (!rows) {
    log.info('incremental update skipped: index unreadable', { dbPath });
    return null;
  }

  // Map through the same helpers the bootstrap/route layer uses, so an incrementally-read node is
  // identical to the one a full fetch would have produced (ids, layers, parent links, kinds).
  const touchedNodes = mapDbNodesToGraphNodes(rows.nodes);
  const touchedEdges = mapDbEdgesToGraphEdges(rows.edges);

  const changed = new Set<string>();
  for (const raw of changedFiles) {
    const normalized = normalizeRepoPath(raw);
    if (normalized) changed.add(normalized);
  }

  const beforeNodes = current.nodes.filter((n) => belongsToChangedFile(n, changed));
  const beforeNodeIds = new Set(beforeNodes.map((n) => n.id as string));
  const beforeEdges = current.edges.filter((e) =>
    beforeNodeIds.has(e.source as string) || beforeNodeIds.has(e.target as string));

  const delta = computeGraphDiff(beforeNodes, beforeEdges, touchedNodes, touchedEdges);

  // An incrementally-built delta must still describe a graph we can apply without inventing or
  // stranding entries; anything else (e.g. an edge into a node the read did not return) is a signal
  // that the targeted view is incomplete, so the caller falls back to a full fetch instead.
  if (!canApplyGraphDelta(current, delta)) {
    log.info('incremental update skipped: delta does not apply cleanly', { changedFiles: changedFiles.length, ...graphDeltaSize(delta) });
    return null;
  }

  const timestamp = input.timestamp ?? Date.now();
  const folded = applyGraphDelta(current, delta);
  const next = withCounts(folded.nodes, folded.edges, current.metadata, timestamp);

  if (isEmptyGraphDelta(delta)) {
    log.debug('incremental update: no structural change', { changedFiles: changedFiles.length });
  }

  return {
    delta,
    next,
    scanned: { nodes: touchedNodes.length, edges: touchedEdges.length },
  };
}
