/**
 * dsh-anic host entry（M1..M8 全功能面）。
 *
 * inject 与父工程同纪律：只列**必需**服务。webServer 承载路由；sessions 是工作区
 * 解析的第一后备来源（registry 是可选服务，用 ctx.get 探测，不进 inject ——
 * 父工程 workspaceRegistry 同形态）。tools 是 DSH 工具注册槽位（M8 G-TOOL），
 * 供其他会话/agent 调用 dsh-anic 的能力（anic_evaluate/iterate/gate_check/bootstrap）。
 * 宿主没有 webServer 时路由整体跳过，插件主体（客户端标签 + 嵌入快照）不受影响。
 */
import { registerAnicRoutes } from './host/routes/index.ts';
import { registerAnicTools } from './host/tools.ts';

export const name = 'dsh-anic';
export const inject = ['tools', 'webServer', 'sessions'];

export function apply(ctx: unknown): void {
  const c = ctx as { effect?: (fn: () => unknown, label?: string) => unknown };
  if (typeof c.effect === 'function') {
    c.effect(() => registerAnicRoutes(ctx), 'dsh-anic: routes (snapshot+cycle+ledger+review+evolution+governance+self+skill)');
    c.effect(() => registerAnicTools(ctx), 'dsh-anic: tools (anic_evaluate/iterate/gate_check/bootstrap/snapshot/self_check)');
  } else {
    registerAnicRoutes(ctx);
    registerAnicTools(ctx);
  }
}