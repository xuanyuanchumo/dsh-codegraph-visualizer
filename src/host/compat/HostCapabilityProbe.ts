import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import type { CapabilityProbe, FeatureFlags } from './FeatureFlags.ts';

const log = scoped('host:compat:probe');

/**
 * 由 Cordis **服务**支撑的能力：服务在场即证据。这些服务名都是本插件已在别处探测过的，
 * 因此探针不引入任何新的 DSH API 假设：
 *   - `workspaceRegistry` —— `src/host/prerequisites.ts` 的 `ctx.get('workspaceRegistry')`
 *   - `multiWorkspace`    —— 同一个服务；多工作区 API 就是该服务
 *   - `sessionsApi`       —— 本插件自己的 `inject` 列表必需项（`src/index.ts`）
 *
 * cycle-83 删除了 `remoteWebUi: ['remoteWebUI']` 这一条：`remoteWebUI` 在任何 DSH 代都
 * 不存在（幻影），探测它只会让探针永远返回「无证据」。
 */
const SERVICE_EVIDENCE: Partial<Record<keyof FeatureFlags, readonly string[]>> = {
  workspaceRegistry: ['workspaceRegistry'],
  multiWorkspace: ['workspaceRegistry'],
  sessionsApi: ['sessions'],
};

/**
 * 由**上游工具**支撑的能力：工具已注册即证据。
 * `codegraph_incremental`/`codegraph_bootstrap` 是本插件 `ApiCompatLayer` 已映射的 0.2 线
 * 工具，探测它们不可能凭空造出一个不存在的服务。
 *
 * 注意这一条通常不会触发：`detectHostVersion` 正是用这些工具名给宿主定代的，所以拥有
 * 它们的宿主已被归为 gen2、标志本就是开的。保留它作为**安全网**，用于未来出现版本串与
 * 工具面不一致的线。
 */
const TOOL_EVIDENCE: Partial<Record<keyof FeatureFlags, readonly string[]>> = {
  incrementalBootstrap: ['codegraph_incremental', 'codegraph_bootstrap'],
};

/**
 * 在活跃宿主之上构造一个 {@link CapabilityProbe}。
 *
 * **只报告观测到的 `true`**：服务或工具缺席意味着「无证据」，绝不等于「不存在」，
 * 此时由代际默认值裁决。这使探针在任何宿主上都安全可跑 —— 包括当前这个 gen2 宿主
 * （它什么新东西都确认不了）—— 同时给「模型未覆盖的未来宿主」或「被裁剪过的宿主」
 * 一条自行声明能力的通道。
 */
export function createHostCapabilityProbe(ctx: Context): CapabilityProbe {
  return (capability: keyof FeatureFlags): boolean | undefined => {
    const services = SERVICE_EVIDENCE[capability];
    if (services) {
      try {
        for (const service of services) {
          // `strict = false`：本函数是「服务是否存在」探针，不是「提供者 fiber 是否活跃」
          // 探针。cordis 的 `ctx.get(name, strict = true)` 只返回提供者 fiber 当前
          // `state === 2`（active）的实现（cordis/lib/index.js:763-772），而本探针可能在
          // 宿主插件尚未转 active 时被调用 —— 用默认 strict 会把「稍后可用」误判成「不存在」，
          // 进而让能力位永久回落到代际默认值。（cycle-83，同 ClientCompatLayer.hasService 的修复。）
          const resolved = ctx.get(service, false);
          if (resolved !== null && resolved !== undefined) {
            log.info('capability probe: service present', { capability, service });
            return true;
          }
        }
      } catch { /* 服务注册表不可用 —— 视为无证据 */ }
      return undefined;
    }

    const toolNames = TOOL_EVIDENCE[capability];
    if (toolNames) {
      try {
        for (const toolName of toolNames) {
          if (ctx.tools.get(toolName)) {
            log.info('capability probe: tool present', { capability, tool: toolName });
            return true;
          }
        }
      } catch { /* 工具注册表不可用 —— 视为无证据 */ }
      return undefined;
    }

    return undefined; // 该能力没有建模的证据源
  };
}
