import type { Context } from '@deepseek-ai/cordis';
import type { HostVersionInfo } from './HostVersionDetector.ts';
import { scoped } from '../../shared/Logger.ts';
import type { DshGeneration } from '../../shared/dshGeneration.ts';

const log = scoped('host:compat');

/**
 * 15 个工具键 → 实际工具名的映射表。
 *
 * 四个「gen2 才可能提供」的键（bootstrap/incremental/aiAssist/semanticSearch）允许为
 * `null`：`null` 表示**该代没有对应工具**，而不是「名字待查」。
 */
export interface ToolNameMapping {
  codegraphStatus: string;
  codegraphGraph: string;
  codegraphQuery: string;
  codegraphFiles: string;
  codegraphImpact: string;
  codegraphInit: string;
  codegraphSync: string;
  codegraphCallers: string;
  codegraphCallees: string;
  codegraphBootstrap: string | null;
  codegraphIncremental: string | null;
  codegraphAiAssist: string | null;
  codegraphSemanticSearch: string | null;
  lensAnalyze: string;
  lensImpact: string;
}

/** gen1（0.1.x 线）工具面：无 bootstrap / incremental / aiAssist / semanticSearch 四个键。 */
const GEN1_MAPPING: ToolNameMapping = {
  codegraphStatus: 'codegraph_status',
  codegraphGraph: 'codegraph_graph',
  codegraphQuery: 'codegraph_query',
  codegraphFiles: 'codegraph_files',
  codegraphImpact: 'codegraph_impact',
  codegraphInit: 'codegraph_init',
  codegraphSync: 'codegraph_sync',
  codegraphCallers: 'codegraph_callers',
  codegraphCallees: 'codegraph_callees',
  codegraphBootstrap: null,
  codegraphIncremental: null,
  codegraphAiAssist: null,
  codegraphSemanticSearch: null,
  lensAnalyze: 'lens_analyze',
  lensImpact: 'lens_impact',
};

/** gen2（0.2.x 线）：在 gen1 之上增加 bootstrap 与 incremental 两个工具名。 */
const GEN2_MAPPING: ToolNameMapping = {
  ...GEN1_MAPPING,
  codegraphBootstrap: 'codegraph_bootstrap',
  codegraphIncremental: 'codegraph_incremental',
};

/**
 * gen3（0.3.x 线，以及被建模为前向兼容超集的 0.4+/1.x）：**只继承 gen2 已确证的键**。
 * aiAssist / semanticSearch 在本机任何 DSH 版本中都没有对应工具（见
 * `docs/research/dsh-upgrade-research-report.md` 对上游 `dsh-codegraph` 的核验：
 * 它只贡献 `mcp__codegraph__codegraph_explore`），因此不得凭「更新的版本应该更强」
 * 的推测把它们打开——未发布线不授予无人验证的能力。
 */
const GEN3_MAPPING: ToolNameMapping = {
  ...GEN2_MAPPING,
  codegraphAiAssist: null,
  codegraphSemanticSearch: null,
};

/**
 * 未知代（版本串缺失且服务面探针也未命中）：退回 gen1 的保守面。
 *
 * 注意这与 `FeatureFlags` 的 `UNKNOWN_FLAGS` 策略**刻意不同**：能力标志走「保守扣留、
 * 探针只加不减」，而工具名映射走「退到最小可用集、由 `getAvailableToolName` 的
 * `FALLBACK_CHAINS` 在运行时逐个回退」。两者都不假设未来版本拥有更多能力。
 */
const UNKNOWN_MAPPING: ToolNameMapping = {
  ...GEN1_MAPPING,
  codegraphBootstrap: null,
  codegraphIncremental: null,
  codegraphAiAssist: null,
  codegraphSemanticSearch: null,
};

/**
 * 代 → 工具名矩阵，以模型能报告的**每一代**为键。
 * 特意导出，使穷尽性是被断言的而不是被假设的（见 `tests/unit/dshGeneration.test.ts`）；
 * 将来在 `dshGeneration.ts` 里新增一代，会在此处类型检查失败，而不是静默落到默认值。
 */
export const TOOL_MAPPING_BY_GENERATION: Record<DshGeneration, ToolNameMapping> = {
  gen1: GEN1_MAPPING,
  gen2: GEN2_MAPPING,
  gen3: GEN3_MAPPING,
  unknown: UNKNOWN_MAPPING,
};

/** 按代取工具名映射。 */
export function createToolNameMapping(info: HostVersionInfo): ToolNameMapping {
  return TOOL_MAPPING_BY_GENERATION[info.generation];
}

/**
 * 宿主半的多代适配层：把「逻辑工具键」翻译成当前代真实存在的工具名，并在主名缺席时
 * 沿 {@link FALLBACK_CHAINS} 逐级回退。
 */
export interface ApiCompatLayer {
  versionInfo: HostVersionInfo;
  toolNames: ToolNameMapping;
  /** 该键在当前代的**声明**名字；`null` 表示这一代本就没有这个工具。 */
  resolveToolName(key: keyof ToolNameMapping): string | null;
  /** 该键的声明名字此刻是否真的注册在 `ctx.tools` 上。 */
  isToolAvailable(ctx: Context, key: keyof ToolNameMapping): boolean;
  /** 主名不可用时沿回退链找到的第一个可用工具名。 */
  getAvailableToolName(ctx: Context, key: keyof ToolNameMapping): string | null;
  /** 反查：给定一个真实工具名，返回同一逻辑键下可用的名字。 */
  getAvailableToolNameFor(ctx: Context, actualName: string): string | null;
}

export function createApiCompatLayer(info: HostVersionInfo): ApiCompatLayer {
  const toolNames = createToolNameMapping(info);
  // 反向索引：真实工具名 → 逻辑键。用于 `getAvailableToolNameFor` 的反查路径。
  const keyByToolName = new Map<string, keyof ToolNameMapping>();
  for (const key of Object.keys(toolNames) as (keyof ToolNameMapping)[]) {
    const actual = toolNames[key];
    if (actual) keyByToolName.set(actual, key);
  }

  const resolveToolName = (key: keyof ToolNameMapping): string | null => {
    return toolNames[key];
  };

  const isToolAvailable = (ctx: Context, key: keyof ToolNameMapping): boolean => {
    const name = resolveToolName(key);
    if (!name) return false;
    try {
      return !!ctx.tools.get(name);
    } catch {
      // 宿主未提供 `tools` 服务（极小 profile）时按不可用处理，而不是让整个插件崩掉。
      return false;
    }
  };

  const getAvailableToolName = (ctx: Context, key: keyof ToolNameMapping): string | null => {
    const primary = resolveToolName(key);
    if (primary && isToolAvailable(ctx, key)) return primary;
    const fallbacks = FALLBACK_CHAINS[key] ?? [];
    for (const fb of fallbacks) {
      const fbName = resolveToolName(fb);
      if (fbName) {
        try {
          if (ctx.tools.get(fbName)) {
            log.info('tool name fallback', { key, primary, fallback: fbName });
            return fbName;
          }
        } catch { /* 忽略：探针失败等同于不可用 */ }
      }
    }
    return null;
  };

  const getAvailableToolNameFor = (ctx: Context, actualName: string): string | null => {
    try {
      if (ctx.tools.get(actualName)) return actualName;
    } catch { /* 忽略 */ }
    const key = keyByToolName.get(actualName);
    if (!key) return null;
    return getAvailableToolName(ctx, key);
  };

  return { versionInfo: info, toolNames, resolveToolName, isToolAvailable, getAvailableToolName, getAvailableToolNameFor };
}

/**
 * 回退链：主名缺席时按顺序尝试的**同一逻辑能力**的其它键。
 *
 * 例：`codegraphIncremental` 在 gen1 上为 `null`，于是退到 `codegraphSync`，
 * 再退到 `codegraphInit`——三者都是「把图更新到最新」的不同代工具名。
 * 链条刻意保持短（≤2 跳），因为每多一跳就多一次「语义可能已变」的风险。
 */
const FALLBACK_CHAINS: Partial<Record<keyof ToolNameMapping, (keyof ToolNameMapping)[]>> = {
  codegraphStatus: ['codegraphGraph', 'codegraphQuery'],
  codegraphGraph: ['codegraphStatus', 'codegraphQuery'],
  codegraphQuery: ['codegraphStatus', 'codegraphGraph'],
  codegraphFiles: ['codegraphGraph', 'codegraphQuery'],
  codegraphImpact: ['codegraphCallers', 'codegraphCallees'],
  codegraphCallers: ['codegraphImpact', 'codegraphCallees'],
  codegraphCallees: ['codegraphImpact', 'codegraphCallers'],
  codegraphBootstrap: ['codegraphInit'],
  codegraphIncremental: ['codegraphSync', 'codegraphInit'],
  codegraphAiAssist: ['codegraphQuery', 'codegraphGraph'],
  codegraphSemanticSearch: ['codegraphQuery', 'codegraphGraph'],
  codegraphInit: ['codegraphBootstrap'],
  codegraphSync: ['codegraphIncremental', 'codegraphBootstrap'],
  lensAnalyze: ['codegraphQuery', 'codegraphGraph'],
  lensImpact: ['codegraphImpact', 'codegraphCallers'],
};