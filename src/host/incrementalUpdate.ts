import { scoped } from '../shared/Logger.ts';
import { INCREMENTAL } from '../shared/constants.ts';
import { readFilesFromDb, resolveDbPath, normalizeRepoPath, mapRowsToGraphNodes, mapRowsToGraphEdges, CODEGRAPH_SOURCE } from '../adapters/CodeGraphAdapter.ts';
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

  // 走与全量路径完全相同的行→图转换（mapRowsToGraphNodes / mapRowsToGraphEdges）：父节点按每个
  // 节点自己的 file_path 解析、边经过自环与 FILTERED_EDGE_KINDS 过滤并按来源截断 import 上限。
  // 增量读回的节点还必须带上与 GraphDataMerger.merge 一致的 `properties.__source`，否则与已经过
  // merger 的 `current` 逐字段比对时每个节点都会被判为 modified，每次 watcher tick 都会重发全量。
  const touchedNodes = mapRowsToGraphNodes(rows.nodes, CODEGRAPH_SOURCE);

  // 边的"合法节点集合"必须是**全图**的节点集合，而不是本次读回的那一批：全量路径用的是索引里
  // 所有节点，而 `readFilesFromDb` 有意返回"任一端点在改动集合内"的边，所以一条从改动文件指向
  // 未改动文件的边，它的另一端并不在 touchedNodes 里。若只拿 touchedNodes 当合法集合，这些边会被
  // 误判为 removed，与全量路径再次漂移。`current` 就是客户端此刻持有的全图，取并集即可。
  const validNodeIds = new Set<string>(touchedNodes.map((n) => n.id as string));
  for (const n of current.nodes) validNodeIds.add(n.id as string);

  // import 上限必须基于"当前图里该来源已经保留的 import 边"来重算，不能只看本次读回的局部集合
  // （详见 mapRowsToGraphEdges 的注释：局部集合数到 20 会把全量路径早已丢弃的边重新加进来）。
  const keptImportIds = new Map<string, number[]>();
  for (const e of current.edges) {
    if (e.type !== 'import') continue;
    if (e.properties.__source !== CODEGRAPH_SOURCE) continue;
    const list = keptImportIds.get(e.source as string);
    if (list) list.push(Number(e.id));
    else keptImportIds.set(e.source as string, [Number(e.id)]);
  }

  const touchedEdges = mapRowsToGraphEdges(rows.edges, validNodeIds, { source: CODEGRAPH_SOURCE, keptImportIds });

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
