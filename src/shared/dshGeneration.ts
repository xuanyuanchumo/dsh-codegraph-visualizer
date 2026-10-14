// 「我们正运行在 DSH 哪一代」的唯一真源。
//
// 本模块存在的理由：代际窗口曾被写死四处 —— `src/host/compat/HostVersionDetector.ts`、
// `src/client/compat/ClientVersionDetector.ts`、`tests/unit/manifest.test.ts`（DSH_GENERATIONS）
// 与 `package.json`（engines.dsh）—— 各自持有一份阈值副本。它们之间没有任何联动，于是
// 在任一处放宽窗口都会静默地让另外三处失配（宿主半与客户端半可能对同一个宿主得出不同
// 分类，而两处的 `isGen2()` 式分支会照此行事）。
//
// 窗口由清单所声明的 DSH 发布线（`engines.dsh`）推导；`tests/unit/dshGeneration.test.ts`
// 会在清单与本模块漂移时失败。
//
// 兼容性只是声明式的（见 `dsh-package-manifest/README.md:93`：安装器不强制 `engines.dsh`），
// 因此本模块只做分类，从不拦截加载。

/** 本插件建模的 DSH 宿主代际。`unknown` 是一等结果，不是错误。 */
export type DshGeneration = 'gen1' | 'gen2' | 'gen3' | 'unknown';

/** 真正对应已发布 DSH 线的代际。 */
export const DSH_GENERATIONS = ['gen1', 'gen2', 'gen3'] as const;

export type DshKnownGeneration = (typeof DSH_GENERATIONS)[number];

export interface DshVersionInfo {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  generation: DshGeneration;
}

/**
 * 每代一个代表版本。这既是 `engines.dsh` 必须覆盖的清单，也是宿主/客户端两侧检测器
 * 必须得出相同分类的清单。
 */
export const DSH_GENERATION_PROBES: Record<DshKnownGeneration, string> = {
  gen1: '0.1.7-rc.2',
  gen2: '0.2.0-rc.2',
  gen3: '0.3.0-rc.2',
};

/**
 * **被承诺支持**的代际：即 {@link DSH_SUPPORTED_RANGE} 实际覆盖的代际。
 *
 * cycle-92 裁定（objective #3）：宿主下限由 0.1.7-rc.2 **抬高到 0.2.0-rc.2**。
 * 依据是上游把 dsh-v0.2.0 定为当前公开的插件基线，且本项目 peer 门实测只在
 * 0.2.0-rc.2 上完成过真机验证（J0 旅程）。
 *
 * 注意「被建模」与「被承诺」是两件事，见 {@link DSH_GENERATIONS} 与
 * {@link DSH_LEGACY_GENERATIONS} 的分工。
 */
export const DSH_PROMISED_GENERATIONS = ['gen2', 'gen3'] as const;

/**
 * **被容忍但不承诺**的代际：适配器仍然能正确分类并按保守能力集运行，但不在
 * `engines.dsh` / `peerDependencies` 的承诺窗口内，也不作为验收对象。
 *
 * 保留这一档而不是删除 gen1 代码，是因为分类器必须能如实回答「我正跑在一个
 * 0.1.x 宿主上」——把一个可识别的宿主报告成 `unknown` 会让能力探针失去
 * 保守基线的依据。删掉它反而会制造出「本插件以为自己在 gen2」这类静默降级。
 */
export const DSH_LEGACY_GENERATIONS = ['gen1'] as const;

/** 受支持的宿主窗口，在 `package.json` 中以 `engines.dsh` 声明。 */
export const DSH_SUPPORTED_RANGE = '>=0.2.0-rc.2 <0.4.0';

/**
 * {@link DSH_SUPPORTED_RANGE} 的排他上界，供漂移断言使用。
 *
 * 注意这里与真实的强制门存在语义差：`dsh-app-boot` 只比对 `peerDependencies` 上的
 * `@deepseek-ai/dsh*`（`dsh-app-boot/README.md:52` 逐字说明「这些检查用 peer 声明，
 * 不用 `engines.dsh`」），而本插件的 peer 范围实测拒绝 0.4.0 与 1.0.0。因此本常量
 * 描述的是**本插件的适配器模型边界**，不是安装门。
 *
 * cycle-92 起 peer 范围同步去掉了 `^0.1.7-rc.2`，于是 0.1.7-rc.1 与 0.1.7-rc.2
 * 都被 peer 门拒绝——与 {@link DSH_LEGACY_GENERATIONS} 的「容忍但不承诺」一致：
 * 分类器认得它们，安装门不放行它们。
 */
export const DSH_UNSUPPORTED_PROBE = '0.4.0';

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/;

export function isDshGeneration(value: unknown): value is DshGeneration {
  return value === 'gen1' || value === 'gen2' || value === 'gen3' || value === 'unknown';
}

/**
 * 把 semver 的 major/minor 对映射到代际。
 *
 * gen1 = 0.1.x，gen2 = 0.2.x，gen3 = 0.3.x 及其之后的所有线（0.4.x、1.x……）。后续线
 * 刻意落进 gen3：gen3 被建模为 gen2 的前向兼容超集，于是尚未发布的 0.4.x 宿主会拿到
 * 最新适配器，而不是退化成 `unknown`；只有低于受支持下界的宿主才保持未分类。
 *
 * gen1 自 cycle-92 起是 {@link DSH_LEGACY_GENERATIONS}：**仍被分类**（分类器不撒谎），
 * 但已不在 {@link DSH_SUPPORTED_RANGE} 内，故不再被承诺。
 */
export function generationOfVersion(major: number, minor: number): DshGeneration {
  if (major >= 1) return 'gen3';
  if (major !== 0) return 'unknown';
  if (minor >= 3) return 'gen3';
  if (minor === 2) return 'gen2';
  if (minor === 1) return 'gen1';
  return 'unknown'; // 0.0.x 早于本插件建模的窗口
}

/** 解析原始版本串（可带前导 `v`，预发布段可选）。 */
export function parseDshVersion(raw: string): DshVersionInfo {
  const match = raw.match(VERSION_PATTERN);
  if (!match) {
    return { raw, major: 0, minor: 0, patch: 0, prerelease: null, generation: 'unknown' };
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  return {
    raw,
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
    generation: generationOfVersion(major, minor),
  };
}

/**
 * 所有检测器都失败时的版本。共享此函数是为了让宿主半与客户端半对「我判断不出来」
 * 报告完全相同的形状。
 */
export function unknownDshVersion(raw = 'unknown'): DshVersionInfo {
  return { raw, major: 0, minor: 0, patch: 0, prerelease: null, generation: 'unknown' };
}

/** 该代的一个代表版本，供「无版本串、只能按 API 形状判定」的检测使用。 */
export function probeReleaseFor(generation: DshGeneration): string | null {
  return generation === 'unknown' ? null : DSH_GENERATION_PROBES[generation];
}
