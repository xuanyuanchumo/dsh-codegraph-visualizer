import { sameRepoId } from '../../shared/pathUtils.ts';

/**
 * 判断一条来自 host 的图负载是否属于调用方当前绑定的工作区（P0 跨工作区污染防护）。
 *
 * 背景：host 只保留一个 `lastGraphData` 槽，而客户端可以在同一次会话里切换多个工作区。当浏览器先
 * 给"正在建索引"的工作区 A 跑了后台建图，A 的空图会占据那个槽；此后 watcher 为工作区 B 产出的
 * `graph/delta` / `graph/data` 会被客户端无差别地应用到当前画布上，把 B 的图谱覆盖成 A 的（或反之）。
 * 应用前先比对负载里的 `repoId` 与调用方的作用域身份即可拦住这类串台。
 *
 * 第二个参数 `scopeRepoId` 是"我当前绑定的工作区身份"，按调用点有两种来源：
 * - 推送/轮询类路径（SSE `graph-data`/`graph-delta`/`graph-updated`、`WindowEvents` 的 REFRESH、
 *   host 侧 watcher 与增量折叠）：绑定的是 **store 里的 `repoId`**，即画布上正在显示的那张图；
 * - 按工作区寻址的一次性请求（如 `/api/v1/codegraph/dependencies`）：绑定的是**请求时指定的
 *   工作区**，用来回答"host 是否真的把我点名要的那个工作区还给了我"。
 *
 * 规则刻意保守：只有**两侧都非空**且确实不同源时才判为外来负载。任一侧缺失时返回 false（放行）——
 * 页面首次加载时 store 还没有 `repoId`（或调用方用 `'.'` 表示"未指定工作区"），此时必须允许首个
 * `graph-data` / `graph-delta` 把工作区身份建立起来，否则图谱会永远停在空骨架。
 */
export function isForeignRepo(
  payloadRepoId: string | null | undefined,
  scopeRepoId: string | null | undefined,
): boolean {
  if (!payloadRepoId || !scopeRepoId) return false;
  return !sameRepoId(payloadRepoId, scopeRepoId);
}
