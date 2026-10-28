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
// ## cycle-110 事实更正：`engines.dsh` **不是**纯声明
//
// 本文件此前长期写着「兼容性只是声明式的（`dsh-package-manifest/README.md:93`：安装器不强制
// `engines.dsh`），因此本模块只做分类，从不拦截加载」。**该口径已被证伪**，正确事实是：
//
// 1. 宿主 `@deepseek-ai/dsh-app-boot` 的 `unmetRequirements()` **会读** `engines.dsh`，
//    安装与 profile 启动对不满足范围的包**直接拒绝**；
// 2. **只要包声明了 `engines.dsh`，`peerDependencies` 就被完全忽略**；peer 规则只在
//    `engines.dsh` 缺席时作为回退生效。源码注释逐字：
//    "An own `engines.dsh` range decides alone and peerDependencies are ignored"。
// 3. 同一条规则也被市场侧复刻（`dshmarket/lib/verify.js:217-235`，由 Lead 提供行号，
//    本轮未独立核验——它在 asar 内，本机无法直接读取该文件）。
//
// 公开文档锚点（本机知识库 `dsh-plugin-dev-kb/kb`，官方 master 投影，commit 687f282e，
// 抓取于 2026-10-21）：
// - `site/develop/basic/publish.md:69`：「安装和 profile 启动会**拒绝**当前运行的 DSH
//   不满足该范围的组合包；**没有** `engines.dsh` 时，改为检查其 `@deepseek-ai/dsh*`
//   peer 依赖范围」；
// - `site/guide/plugin-market.md:138,140`：`engines.dsh` 缺省表示任意版本，DSH 会在安装
//   时再次检查；
// - `extra/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md`：本条变更的
//   迁移指南原文（"包自身的 `engines.dsh` 范围单独决定结果，并忽略这些 peer"）。
//
// ## 这对本模块的含义
//
// 分类器仍然**从不**用版本去拦加载（这是运行期行为，且 gen1 必须仍被如实识别）。真正被
// 改变的是一条措辞与一处上界：`engines.dsh` 现在是一道**强制门**，所以它的上界必须与
// peer 一样精确到「排除下一代的预发布」。`>=0.2.0-rc.2 <0.4.0` 在
// `{ includePrerelease: true }` 下会放行 `0.4.0-rc.1`（semver 实测，见 §上界说明），
// 于是 gen4 的预发布会被当成受支持宿主；`<0.4.0-0` 精确排除后者且仍覆盖 `0.3.0-rc.2`。

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

/**
 * 受支持的宿主窗口，在 `package.json` 中**逐字**声明为 `engines.dsh`。
 *
 * 下限 `>=0.2.0-rc.2` 是 cycle-92 的用户硬要求，**本轮不变**。
 *
 * ## 上界为什么是 `<0.4.0-0` 而不是 `<0.4.0`
 *
 * `engines.dsh` 现在是一道**强制门**（见文件头）。在 semver 的
 * `{ includePrerelease: true }`（宿主与 peer 求值都用这个旗标）下：
 *
 * | 版本 | `>=0.2.0-rc.2 <0.4.0` | `>=0.2.0-rc.2 <0.4.0-0` |
 * |---|---|---|
 * | `0.3.0-rc.2` | PASS | **PASS**（必须保留的覆盖） |
 * | `0.4.0-0` | PASS ← 洞 | **REF** |
 * | `0.4.0-alpha.1` | PASS ← 洞 | **REF** |
 * | `0.4.0-rc.1` | PASS ← 洞 | **REF** |
 * | `0.4.0` | REF | REF |
 *
 * 即旧上界把「gen4 的预发布」当成受支持宿主 —— 那正是本仓最忌的「声明了没验证过的
 * 版本」。`-0` 是 semver 里最小的预发布标识，`<0.4.0-0` 精确表达「0.4.0 及其全部
 * 预发布都排除」，同时不误伤 0.3.x 的任何预发布。上表由 cycle-110 用
 * `semver@7.8.5` 实算得出（命令见 `docs/research/dsh-round110-规范与破坏性变更.md` §4）。
 *
 * **下限与上界必须成对阅读**：只改上界不改下限 = 仍在承诺 gen1；只改下限不改上界 =
 * 把 gen4 预发布放进门内。`tests/unit/manifest.test.ts` 与
 * `tests/unit/dshGeneration.test.ts` 对两侧各有一条探针。
 */
export const DSH_SUPPORTED_RANGE = '>=0.2.0-rc.2 <0.4.0-0';

/**
 * {@link DSH_SUPPORTED_RANGE} **最近的**排除探针：gen4 线的第一格。
 *
 * 取 `0.4.0-rc.1` 而不是 `0.4.0` 是刻意的：`0.4.0` 在旧上界 `<0.4.0` 下**本来就**被
 * 拒绝，所以拿它当探针无法发现「上界太宽」这一类缺陷——它只能发现上界被写到 0.4.0 之上。
 * 真正的缺口是**预发布**，探针必须落在预发布上才对那条缺陷敏感。
 *
 * cycle-110 起 `engines.dsh` 是强制门（见文件头），所以这条探针保护的不再只是「适配器
 * 模型边界」，而是**安装门会不会把 gen4 预发布放进来**。
 */
export const DSH_UNSUPPORTED_PROBE = '0.4.0-rc.1';

/**
 * 全部排除探针（含最近的 `0.4.0-rc.1`）。用例应遍历本数组，而不是只信
 * {@link DSH_UNSUPPORTED_PROBE} 一个点：一个探针只能证明「这一格被排除」。
 *
 * `0.4.0` 作为第二个探针保留下来，覆盖「上界被写成 `<=0.3.x` 之外的其它形态」这类改动。
 */
export const DSH_UNSUPPORTED_PROBES = ['0.4.0-rc.1', '0.4.0', '1.0.0'] as const;

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
 *
 * ## cycle-110：代际**不是**兼容性判据
 *
 * 本机运行宿主实测为 `0.2.1-rc.3`，按本函数归 **gen2**（minor === 2）。但 0.2 线内部
 * 已经发生过破坏性变更：`0.2.1-alpha.3` 把 `engines.dsh` 提升为唯一判据（见文件头）、
 * 工具呈现模式拒绝 `both`（`extra/upgrade-guide/v0.2.1-alpha.1/tool-presentation-mode`）。
 * 也就是说**同一代际内可以有破坏性变更**，所以适配器绝不能按 `generation` 分支后就假定
 * API 面固定——不确定项必须落成「探测 + 降级」（`ctx.get(key, false)` /
 * `ctx.inject` / 工具在场性），而不是按代开关。
 *
 * 附带澄清一个容易混淆的说法：把 `0.1.7 → 0.2.0 → 0.2.1` 称为「三代」是**发布线序号**，
 * 与本模型的 `DshGeneration` 不是一回事。混用会让「gen3 已真机验证」这样的错误结论出现
 * ——本机验证过的最新一代是 **gen2**，gen3（0.3.x）至今**未发布、未验证**。
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
