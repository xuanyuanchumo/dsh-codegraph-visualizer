import type { HostVersionInfo } from './HostVersionDetector.ts';
import { scoped } from '../../shared/Logger.ts';
import type { DshGeneration } from '../../shared/dshGeneration.ts';

const log = scoped('host:compat');

/**
 * 宿主能力矩阵。每个条目都必须描述**宿主提供的东西**：标志门控的是「宿主缺少该能力时
 * 会降级」的行为。
 *
 * 刻意缺席 `treeSitterWasm`：解析在本插件自己的宿主进程里、用它自己的依赖
 * （`tree-sitter-wasm`，经 `getWasmPath` 解析）运行，宿主无法授予或扣留它；该能力曾
 * 在每一代都声明为 `true` 且无人读取。Round 7 将其删除，而不是留下一个宣称了宿主能力、
 * 插件却从不消费的标志（见 `docs/需求分析.md` §31.6 / FR-33）。
 *
 * cycle-83 删除的幻影位：`spotlight` 与 `remoteWebUi`。两者对应的服务键
 * （`ctx.get('spotlight')` / `ctx.get('remoteWebUI')`）在 gen1/gen2 两套 DSH 树与本机
 * 全部已装第三方插件中**零 `provide` 命中**，其客户端集成恒早退。`desktopPlatform`
 * 予以保留但**语义已改**：它不再探测 `ctx.get('desktopProfiles')`（该键不是 cordis
 * 服务），而由客户端按 DSH 官方的 `<html>` DOM 标记判定（见
 * `src/client/compat/PlatformProbe.ts`）。
 */
export interface FeatureFlags {
  incrementalBootstrap: boolean;
  workspaceRegistry: boolean;
  sessionsApi: boolean;
  betterSidebar: boolean;
  mcpServer: boolean;
  rateLimiting: boolean;
  healthScore: boolean;
  rulesCheck: boolean;
  multiWorkspace: boolean;
  aiAssist: boolean;
  crossRepo: boolean;
  /** 宿主为桌面（Electron）外壳。由客户端 DOM 判定，宿主侧仅作诊断转述。 */
  desktopPlatform: boolean;
}

const GEN1_FLAGS: FeatureFlags = {
  incrementalBootstrap: false,
  workspaceRegistry: false,
  sessionsApi: true,
  betterSidebar: false,
  mcpServer: true,
  rateLimiting: true,
  healthScore: true,
  rulesCheck: true,
  multiWorkspace: false,
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: false,
};

const GEN2_FLAGS: FeatureFlags = {
  incrementalBootstrap: true,
  workspaceRegistry: true,
  sessionsApi: true,
  betterSidebar: true,
  mcpServer: true,
  rateLimiting: true,
  healthScore: true,
  rulesCheck: true,
  multiWorkspace: true,
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: true,
};

const GEN3_FLAGS: FeatureFlags = {
  ...GEN2_FLAGS,
  // gen3（v0.3.0+）保留位 —— 待 v0.3.0 确认这些特性后再打开。
  // 刻意与 gen2 相同：未发布的线不得被授予无人验证的能力。
  // 真实的 gen3 宿主通过下方运行时探针取得它们。
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: true,
};

/** 「版本无法判定」时的保守基线。 */
const UNKNOWN_FLAGS: FeatureFlags = {
  ...GEN2_FLAGS,
  incrementalBootstrap: false,
};

/**
 * 代际 → 能力矩阵，键覆盖模型能报告的每一代。
 * 导出是为了让穷尽性被断言而非假设（`tests/unit/dshGeneration.test.ts`）。
 */
export const FEATURE_FLAGS_BY_GENERATION: Record<DshGeneration, FeatureFlags> = {
  gen1: GEN1_FLAGS,
  gen2: GEN2_FLAGS,
  gen3: GEN3_FLAGS,
  unknown: UNKNOWN_FLAGS,
};

/**
 * 运行时能力探针。`true` = 在该宿主上观测到该能力，
 * `false`/`null`/`undefined` = 没有可用证据（缺席不等于不存在）。
 */
export type CapabilityProbe = (capability: keyof FeatureFlags) => boolean | null | undefined;

/** 探针在代际默认值之上提升的能力，供日志/遥测使用。 */
export interface FeatureFlagResolution {
  flags: FeatureFlags;
  source: 'generation' | 'generation+probe';
  probedUpgrades: (keyof FeatureFlags)[];
}

/**
 * 解析某宿主的能力集。
 *
 * 只用代际默认值会错估两种本插件必须活下来的情形：比模型更新的宿主（`unknown`/未来线，
 * 但它确实有某能力）与比自身所属线更旧的宿主（0.2 的构建但没装上游 codegraph 插件）。
 * 探针能同时修正两者，但**只做加法**：探针可以把能力打开，永不关闭。探测是启发式的，
 * 假阴性会静默移除可用行为，而假阳性只是恢复版本模型在邻近代已经授予过的东西。
 */
export function resolveFeatureFlags(info: HostVersionInfo, probe?: CapabilityProbe): FeatureFlagResolution {
  const base = FEATURE_FLAGS_BY_GENERATION[info.generation];
  if (!probe) {
    // 返回**副本**，不返回 `FEATURE_FLAGS_BY_GENERATION` 里的那一份（cycle-110）。
    // 无探针曾直接 `return { flags: base }`，于是调用方手里是**代际默认表的同一个对象**：
    // 任何一处对 flags 的写入都会永久改坏该代的默认值（同一进程内后续所有解析都受污染），
    // 而"能力快照可以被重算"这一性质也随之失效。副本让「解析」保持纯：
    // 每次调用得到互相独立的对象，随时可以用最新的探针再算一次。
    return { flags: { ...base }, source: 'generation', probedUpgrades: [] };
  }

  const flags: FeatureFlags = { ...base };
  const probedUpgrades: (keyof FeatureFlags)[] = [];
  for (const capability of Object.keys(base) as (keyof FeatureFlags)[]) {
    if (flags[capability]) continue; // 已授予的能力永不被探针关掉
    let observed: boolean | null | undefined;
    try {
      observed = probe(capability);
    } catch {
      observed = undefined;
    }
    if (observed === true) {
      flags[capability] = true;
      probedUpgrades.push(capability);
    }
  }
  return {
    flags,
    source: probedUpgrades.length > 0 ? 'generation+probe' : 'generation',
    probedUpgrades,
  };
}

export function createFeatureFlags(info: HostVersionInfo, probe?: CapabilityProbe): FeatureFlags {
  const { flags, source, probedUpgrades } = resolveFeatureFlags(info, probe);
  log.info('feature flags resolved', { generation: info.generation, source, probedUpgrades, flags });
  return flags;
}
