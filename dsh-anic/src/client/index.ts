/**
 * dsh-anic client entry（DSH client 插件契约，核验自：
 * - dsh-client-modules `client.platform === 'web'` 才加载 client 半部；
 * - 客户端加载器按 `window.__ModuleLoader__.load({id, factory})` 调 exports["./client"]；
 * - `inject` 只能列官方能力包名（'slots' 是官方 API 面，非第三方服务）。
 *
 * 命名与 id 规范：包名 dsh-anic（DSH 插件规范前缀），本入口导出 name = 'dsh-anic-client'
 * 与宿主入口 name = 'dsh-anic'（host/index）相区分 —— 与父工程 dsh-codegraph-visualizer
 * 的 host/client 命名惯例一致。
 */
import { integrateWorkflowTab } from './integrations/WorkflowTabIntegration.ts';

export const name = 'dsh-anic-client';
export const inject = ['slots'];

export function apply(ctx: unknown): void {
  integrateWorkflowTab(ctx);
}
