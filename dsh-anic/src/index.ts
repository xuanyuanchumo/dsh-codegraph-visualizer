/**
 * dsh-anic host entry（M1..M8 全功能面）。
 *
 * inject 与父工程同纪律：只列**必需**服务。webServer 承载路由；sessions 是工作区
 * 解析的第一后备来源（registry 是可选服务，用 ctx.get 探测，不进 inject ——
 * 父工程 workspaceRegistry 同形态）。tools 是 DSH 工具注册槽位（M8 G-TOOL），
 * 供其他会话/agent 调用 dsh-anic 的能力（anic_evaluate/iterate/gate_check/bootstrap）。
 * skills 是官方技能注册槽位（cycle-97）：经 ctx.skills.register 把本技能注册为
 * runtime skill，模型经官方 skill 工具发现并调用，调用进 DSH 轨迹。
 *
 * 为什么 skills 用**静态** inject 而不是 ctx.inject 动态挂载（cycle-97 实测教训）：
 * 官方消费方（dsh-skill-badge lib/index.js）全部用静态 `const inject = ["skills"]`；
 * cordis 4.0.4 的 ctx.inject(inject, callback) 虽会建嵌套插件纤维，但真实宿主里
 * 回调从未触发（服务在场、路由全通、注册日志全无——即 apply 走了 inject 分支
 * 而嵌套纤维不激活）。静态 inject 由组合器保证时序，是唯一经生产验证的形态。
 * 风险对称性：skills 与 webServer 同由 dsh-base 组合提供——能激活本插件的宿主
 * 必然两者皆有，加 skills 不引入新的激活风险（engines 下限 0.2.0-rc.2 起
 * dsh-base 均含技能子系统，全局安装版与 asar 均已实测验证）。
 * 宿主没有 webServer 时路由整体跳过，插件主体（客户端标签 + 嵌入快照）不受影响。
 */
import { registerAnicRoutes } from './host/routes/index.ts';
import { registerAnicTools } from './host/tools.ts';
import { createInvocationFeed, attachInvocationFeed } from './host/runtime/invocationFeed.ts';
import { registerRuntimeSkill } from './host/skillRegistration.ts';

export const name = 'dsh-anic';
export const inject = ['tools', 'webServer', 'sessions', 'skills'];

export function apply(ctx: unknown): void {
  const c = ctx as { effect?: (fn: () => unknown, label?: string) => unknown };
  // 动态白盒调用流（cycle-97）：宿主进程内存态，供路由 + 面板轮询；
  // 事件订阅随插件卸载自动清理（官方 events.md：ctx.on 监听器即效果）。
  const feed = attachInvocationFeed(ctx, createInvocationFeed());
  if (typeof c.effect === 'function') {
    // runtime 技能注册（静态 inject 保证 skills 已就绪；stub 宿主无 skills 时
    // registerRuntimeSkill 内部探测跳过，返回 null 即无需清理）。
    c.effect(() => registerRuntimeSkill(ctx) ?? undefined, 'dsh-anic: runtime skill (ctx.skills.register)');
    c.effect(() => registerAnicRoutes(ctx, { invocationFeed: feed }), 'dsh-anic: routes (snapshot+cycle+ledger+review+evolution+governance+self+skill+invocations)');
    c.effect(() => registerAnicTools(ctx), 'dsh-anic: tools (anic_evaluate/iterate/gate_check/bootstrap/snapshot/self_check)');
  } else {
    registerRuntimeSkill(ctx);
    registerAnicRoutes(ctx, { invocationFeed: feed });
    registerAnicTools(ctx);
  }
}
