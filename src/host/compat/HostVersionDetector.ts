import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import {
  parseDshVersion,
  probeReleaseFor,
  unknownDshVersion,
  type DshGeneration,
  type DshVersionInfo,
} from '../../shared/dshGeneration.ts';

const log = scoped('host:compat');

/** @deprecated 仅为既有调用点保留的别名；模型本体在 `src/shared/dshGeneration.ts`。 */
export type HostGeneration = DshGeneration;
export type HostVersionInfo = DshVersionInfo;

/**
 * 候选一：从 cordis context 上读版本串。
 *
 * **本机实测结论（cycle-83，asar 树全量 grep）**：`ctx.hostVersion`、`ctx.version`、
 * `ctx.app?.version`、`ctx.runtime?.version` 四个键在 `@deepseek-ai/*` 里**零命中**——
 * DSH 从不向插件 context 暴露版本。这一路是「如果将来有，就优先用」的前向兼容探测，
 * 不是当前可依赖的路径。
 */
function detectFromContext(ctx: Context): string | null {
  const candidates = [
    () => ctx.hostVersion,
    () => ctx.version,
    () => ctx.app?.version,
    () => ctx.runtime?.version,
  ];
  for (const fn of candidates) {
    try {
      const v = fn();
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* 忽略：探针失败等同于未命中 */ }
  }
  return null;
}

/**
 * 候选二：环境变量。
 *
 * **本机实测结论**：`DSH_HOST_VERSION` / `DSH_VERSION` / `CODEARTS_HOST_VERSION`
 * 三个名字在全树零命中。DSH 的保留 env 只有 `DSH_HOME`、`DSH_SHELL`、`DSH_SESSION_ID`、
 * `DSH_PROFILE`、`DSH_PROFILE_DIR`（见 `@deepseek-ai/dsh-shell-env` 的 README 与
 * `lib/index.js` 的 `collect()`），且它们只注入到 **shell 工具的子进程环境**里，
 * 不进入宿主插件进程。此路同样只是前向兼容。
 */
function detectFromEnv(): string | null {
  const envKeys = ['DSH_HOST_VERSION', 'DSH_VERSION', 'CODEARTS_HOST_VERSION'];
  for (const key of envKeys) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  return null;
}

/**
 * 最后一道：按上游工具面反推代。
 *
 * `codegraph_incremental` / `codegraph_bootstrap` 只在 0.2 线出现过，它们在场即可给宿主
 * 定代。返回的是**代表性发行版**（见 `DSH_GENERATION_PROBES`）而不是实测版本号——
 * 目的只是让下游拿到正确的 `generation`，不是伪造一个精确版本。
 *
 * 诚实披露：本机 `dsh-codegraph@0.1.3` 只贡献 `mcp__codegraph__codegraph_explore` 一个工具，
 * 上述 9 个工具名**一个都不存在**（Windows 上 `codegraph: false` 是准确判定）。因此这一路
 * 在真机上同样命中不到，最终会落到 `unknown` + 运行时能力探针。
 */
function detectFromToolNames(ctx: Context): string | null {
  try {
    const tools = ctx.tools;
    const hasGen2OnlyTool = tools.get('codegraph_incremental') ?? tools.get('codegraph_bootstrap');
    if (hasGen2OnlyTool) return probeReleaseFor('gen2');
    const hasGen1Tool = tools.get('codegraph_status') ?? tools.get('codegraph_graph');
    if (hasGen1Tool) return probeReleaseFor('gen1');
  } catch { /* 忽略：宿主未提供 tools 服务 */ }
  return null;
}

/**
 * 解析当前运行的 DSH 代。
 *
 * 每一路都是启发式（DSH 在插件 context 上不提供稳定的版本 API，且安装器**从不强制**
 * `engines.dsh`——见 `dsh-package-manifest/README.md:93` 的「Compatibility is declarative」），
 * 所以全部未命中时降级为 `unknown`：适配层用保守能力集 + 运行时探针作答，而不是崩溃，
 * 也不是拒绝加载。
 */
export function detectHostVersion(ctx: Context): HostVersionInfo {
  const sources = [
    () => detectFromContext(ctx),
    () => detectFromEnv(),
    () => detectFromToolNames(ctx),
  ];
  for (const fn of sources) {
    try {
      const raw = fn();
      if (raw) {
        const info = parseDshVersion(raw);
        log.info('host version detected', { raw, generation: info.generation });
        return info;
      }
    } catch { /* 忽略：继续尝试下一路 */ }
  }
  log.info('host version unknown, using conservative flags');
  return unknownDshVersion();
}
