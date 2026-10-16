/**
 * 实时调用路由（cycle-97 动态白盒需求）。
 *
 * GET /anic/api/invocations/live  返回环回缓冲中的最近插件调用
 *   （anic_* 工具 + 官方 skill 工具对本技能的调用），含 in-flight 态。
 *
 * 这是「动态白盒」的数据面：面板轮询本路由，把模型对插件的**调用过程**
 * （请求瞬间 → 执行中 → 完成/失败）实时呈现，而非只看静态产物。
 * feed 是宿主进程内存态，本路由无工作区依赖；feed 缺失属接线错误，
 * 显式 500（空流 200 会让"未接线"看起来和"没有调用"一样——静默降级=永久绿）。
 * 响应统一走共享 send（CORS 头由 sendJson 注入，桌面/远程消费者可读）。
 */
import { type SnapshotCtx } from '../snapshotRoute.ts';
import type { InvocationFeed } from '../runtime/invocationFeed.ts';

interface RouteDeps {
  send: (res: unknown, status: number, body: unknown) => void;
  feed: InvocationFeed | null;
}

/** 注册实时调用路由（GET /anic/api/invocations/live）。 */
export function registerInvocationRoute(ctx: unknown, deps: RouteDeps): (() => void) | null {
  const c = ctx as SnapshotCtx;
  if (!c.webServer || typeof c.webServer.register !== 'function') return null;
  const { send, feed } = deps;

  const d = c.webServer.register({ kind: 'exact', path: '/anic/api/invocations/live', handler: (_req: unknown, res: unknown) => {
    if (!feed) { send(res, 500, { error: 'invocation feed not attached' }); return; }
    const snap = feed.snapshot();
    // 诊断随响应一起返回：feed 空时让消费方能区分「事件没到」与「被过滤」。
    send(res, 200, { ...snap, diagnostics: feed.diagnostics?.() ?? null });
  }});

  return typeof d === 'function' ? d : null;
}
