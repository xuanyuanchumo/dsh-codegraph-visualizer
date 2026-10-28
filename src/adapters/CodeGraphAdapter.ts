// CodeGraphAdapter - adapter for the optional dsh-codegraph data source.
//
// Primary path: read the .codegraph/codegraph.db SQLite index directly
// (node:sqlite, Node >= 22.5). One O(N+E) query returns the whole graph —
// no N+1 tool calls, works even when dsh-codegraph's tool surface is 'core'
// (which exposes no full-graph query tool).
//
// Fallback path: upstream tools (codegraph_query / codegraph_callers /
// codegraph_callees) when the DB cannot be read (e.g. remote sandboxed fs).
//
// cycle-110 Q7：本文件原先 795 行 / band-detector 161（预算 100、上带 115），是与
// `api/index.ts`、`progressiveCluster.ts` 并列的三个超预算热点之一。已按职责拆成三层，
// **只移动代码、不改任何语义**，并把全部原有导出名在这里原样 re-export，使 30+ 个
// 用例与生产调用点的 import 路径零改动：
//   · `codeGraphRows.ts`      —— 行 → 图节点/图边的唯一映射（含过滤与 import 截断）
//   · `codeGraphDb.ts`        —— 连接池、行校验、节点侧读取、分页游标
//   · `codeGraphEdgeReads.ts` —— 边侧读取（邻接边、文件对全集、定向读）
// 本文件只剩「adapter 本体 + 全量取数编排 + 上游工具回落」。
import { normalize } from 'node:path';
import { join } from 'node:path';
import type { GraphNode, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId } from '../types/index.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';
import type { DbNodeRow, DbEdgeRow } from './codeGraphRows.ts';
import { isNoisePath, mapRowsToGraphNodes, mapRowsToGraphEdges } from './codeGraphRows.ts';
import { readGraphFromDbPaged } from './codeGraphDb.ts';
import type { GraphPageCursor } from './codeGraphDb.ts';

export type { UpstreamInvoker } from './IAdapter.ts';

// —— 公开面保持：拆到三层的符号全部原样再导出（生产代码与用例的 import 路径零改动） ——
export type { DbNodeRow, DbEdgeRow } from './codeGraphRows.ts';
export {
  FILTERED_EDGE_KINDS,
  isNoisePath,
  mapRowsToGraphNodes,
  mapRowsToGraphEdges,
  mapNodeKind,
  mapEdgeKind,
  normalizeRepoPath,
} from './codeGraphRows.ts';
export {
  closeAllDbConnections,
  countEdgesInDb,
  readGraphFromDb,
  readGraphFromDbPaged,
  readTopLevelNodesFromDb,
  readNodeChildrenFromDb,
  readFileOutlineFromDb,
  readSymbolASTFromDb,
} from './codeGraphDb.ts';
export type { GraphPageCursor, GraphPageResult } from './codeGraphDb.ts';
export {
  readEdgesFromDb,
  readIncidentEdgesWithFilePathsFromDb,
  readEdgesForNodesFromDb,
  readFilesFromDb,
} from './codeGraphEdgeReads.ts';

/**
 * Locate the .codegraph/codegraph.db for a workspace path.
 * Callers MUST validate workspacePath via resolveWorkspaceFromRequest or
 * validateWorkspacePath before calling this function.
 */
export function resolveDbPath(workspacePath: string): string {
  const root = workspacePath && workspacePath !== '.' ? workspacePath : process.cwd();
  const normalized = normalize(root);
  if (normalized.includes('..')) {
    throw new Error(`Invalid workspace path: ${workspacePath}`);
  }
  return join(normalized, '.codegraph', 'codegraph.db');
}

/** The `source` every row this adapter produces is attributed to. */
export const CODEGRAPH_SOURCE: DataSourceType = 'codegraph';

export class CodeGraphAdapter implements IDataAdapter {
  readonly source: DataSourceType = CODEGRAPH_SOURCE;

  async fetchData(repoId: string, invoke: UpstreamInvoker): Promise<AdapterResult> {
    // Primary: paged SQLite read of the upstream index (avoids OOM on large repos).
    const dbPath = resolveDbPath(repoId);
    let cursor: GraphPageCursor | null = null;
    const allNodes: DbNodeRow[] = [];
    const allEdges: DbEdgeRow[] = [];
    const PAGE = 500;
    do {
      const page = readGraphFromDbPaged(dbPath, cursor, PAGE);
      if (!page) { allNodes.length = 0; break; }
      allNodes.push(...page.nodes);
      allEdges.push(...page.edges);
      cursor = page.nextCursor;
    } while (cursor !== null);

    if (allNodes.length > 0) {
      return this.toAdapterResult(allNodes, allEdges);
    }

    // Fallback (DB unreadable): assemble a file-structure skeleton from the
    // upstream `codegraph_files` tool so the panel at least shows the project
    // layout. No relations — the full graph needs the DB.
    const files = await invoke('codegraph_files', { path: repoId, format: 'flat' });
    if (!files || typeof files !== 'object') {
      return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };
    }
    const rawFiles = this.extractFileList(files);
    const nodes: GraphNode[] = rawFiles
      .filter((f) => !isNoisePath(f.path))
      .map((f, i) => ({
      id: NodeId(`file:${f.path}`),
      label: f.path.split('/').pop() ?? f.path,
      type: 'module',
      filePath: f.path,
      lineNumber: 1,
      properties: { kind: 'file', language: f.language ?? null, index: i },
      layer: inferLayerFromPath(f.path),
    }));
    return { nodes, edges: [], source: this.source, timestamp: Date.now() };
  }

  private extractFileList(files: unknown): Array<{ path: string; language?: string }> {
    // codegraph_files --json returns either an array of file records or an
    // object with a files/files[] key, depending on CLI version.
    if (Array.isArray(files)) {
      return files.flatMap((f) => {
        if (typeof f === 'string') return [{ path: f }];
        const rec = f as Record<string, unknown>;
        if (typeof rec.path === 'string') return [{ path: rec.path, language: rec.language as string | undefined }];
        return [];
      });
    }
    const obj = files as Record<string, unknown>;
    const inner = obj?.files ?? obj?.items;
    return Array.isArray(inner) ? this.extractFileList(inner) : [];
  }

  private toAdapterResult(dbNodes: DbNodeRow[], dbEdges: DbEdgeRow[]): AdapterResult {
    // 节点/边的映射与过滤全部委托给共享实现，增量路径走同一份逻辑（见 mapRowsToGraphNodes /
    // mapRowsToGraphEdges）。这里不传 `source`：`__source` 由 GraphDataMerger.merge 统一打标。
    const nodes = mapRowsToGraphNodes(dbNodes);
    const validNodeIds = new Set<string>(nodes.map((n) => n.id as string));
    const edges = mapRowsToGraphEdges(dbEdges, validNodeIds);
    return { nodes, edges, source: this.source, timestamp: Date.now() };
  }
}
