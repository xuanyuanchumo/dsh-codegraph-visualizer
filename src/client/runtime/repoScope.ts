/**
 * 客户端运行时的工作区作用域守卫入口。
 *
 * 判定原语本身已下沉到 `src/shared/graphScope.ts`：`client/api/`（`/data` 单槽端点的取数守卫）
 * 与 `client/runtime/`（事件推送通道）都要用它，而 `api/` 不允许反向依赖 `runtime/`。本文件保留
 * 原路径与导出名，既有 import 点无需改动。
 */
import { scoped } from '../../shared/Logger.ts';
import { isForeignRepo } from '../../shared/graphScope.ts';
import type { GraphData, GraphEdge, GraphNode } from '../../types/index.ts';

const log = scoped('client');

export { isForeignRepo };

/** 只描述"能把一张图装进画布"的最小接口，避免 runtime 反向依赖 store 的具体类型。 */
export interface GraphPayloadSink {
  setGraphData: (
    nodes: GraphNode[],
    edges: GraphEdge[],
    repoId: string,
    metadata?: GraphData['metadata'] & { etag?: string | null },
  ) => void;
}

/**
 * 把一条按工作区寻址取回的图负载应用到画布——**运行时唯一的应用通道**。
 *
 * 为什么需要它：`/api/v1/codegraph/data` 读的是 host 的单个 `lastGraphData` 槽，槽里可能装着另一个
 * 工作区的图。Round 15 在 `WindowEvents` 的 REFRESH 分支补了守卫，但同形的 SSE `graph-updated`
 * 分支被漏掉，于是同一类缺陷第二次出现（正是"50 节点骨架被覆盖成 2 节点图"的机理）。按 R10，
 * 这里不再逐点补守卫，而是把"判身份 → 通过才落库"收成**一处**，两条通道都只能经由它写图。
 *
 * `etag` 是 `/data` 那次 200 响应给出的校验值，必须与负载**同一次**落库：分开写会出现"画布已是
 * 新版、校验值还是旧版"的窗口，下一次请求就会假 304 并静默吞掉一次真实更新。传 `undefined` 表示
 * 这条通道没有校验值（例如 SSE 直推的 `graph-data`），此时保留原 `metadata` 对象不变。
 *
 * 空负载与外来负载都返回 `false` 且不触碰画布；应用成功返回 `true`。
 */
export function applyScopedGraphPayload(
  sink: GraphPayloadSink,
  data: GraphData | null | undefined,
  scopeRepoId: string | null | undefined,
  source: string,
  etag?: string | null,
): boolean {
  if (!data || !data.nodes || data.nodes.length === 0) return false;
  if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {
    log.info(`${source} ignored for another workspace`, {
      repoId: data.metadata.repoId,
      activeRepoId: scopeRepoId,
    });
    return false;
  }
  const metadata = etag === undefined ? data.metadata : { ...data.metadata, etag };
  sink.setGraphData(data.nodes, data.edges, data.metadata.repoId, metadata);
  return true;
}
