/**
 * dsh-anic host entry（M1 全功能面）。
 *
 * inject 与父工程同纪律：只列**必需**服务。webServer 承载路由；sessions 是工作区
 * 解析的第一后备来源（registry 是可选服务，用 ctx.get 探测，不进 inject ——
 * 父工程 workspaceRegistry 同形态）。宿主没有 webServer 时路由整体跳过，
 * 插件主体（客户端标签 + 嵌入快照）不受影响（多代宿主安全降级）。
 *
 * M1 路由清单（routes/index.ts 聚合注册，disposer 聚合清理——九条红线）：
 *  GET /anic/api/workflow-snapshot、GET /anic/api/step-trace、
 *  GET /anic/api/self-check、POST /anic/self/init。
 */
import { registerAnicRoutes } from './host/routes/index.ts';

export const name = 'dsh-anic';
export const inject = ['webServer', 'sessions'];

export function apply(ctx: unknown): void {
  // ctx.effect：setup 立即执行，返回的 disposer 由宿主 effect 承接（插件级卸载 = 全部
  // 路由注销，父工程 routes/statusRoutes.ts 同形态）。无 effect 的宿主（异常形态）
  // 直接注册，不静默丢。
  const c = ctx as { effect?: (fn: () => unknown, label?: string) => unknown };
  if (typeof c.effect === 'function') {
    c.effect(() => registerAnicRoutes(ctx), 'dsh-anic: routes (snapshot/step-trace/self-check/self-init)');
  } else {
    registerAnicRoutes(ctx);
  }
}