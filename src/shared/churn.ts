/**
 * git 变更频率（churn）的纯函数层。
 *
 * 研究报告 §六 #11（CodeScene）指出：现有热点分析**只有入度维度**
 * （`HotspotAnalyzer.ts` + `HotspotPanel.tsx` 显示 `h.indegree`），
 * 缺「变更频率 × 复杂度 = 热点分数」里的变更频率一侧。
 *
 * 本文件把「解析 git 输出」和「算热点分数」两件**没有副作用**的事放在 `src/shared/`，
 * 这样：① 宿主（`src/host/gitChurn.ts`）与浏览器端都能 import；② 单测不必真的跑 git；
 * ③ 「churn 缺失时退化为纯入度」这条关键不变量可以在纯函数层直接钉死。
 *
 * 设计约束（照抄本仓库已验证的三条教训）：
 * - **退化默认值必须「拒绝」而不是「承诺」**：git 不可用 / 不是仓库时返回空 churn，
 *   而不是编造一个「所有文件都是 0 次」的结果——后者会让面板显示一份看起来正常的假数据。
 * - **热点分数在 churn 为 0 时必须等于入度**：否则 git 不可用的工作区里，
 *   热点排序会和升级前不一致，等于悄悄改变了既有行为。
 * - **路径归一化只有一个实现**：`normalizeChurnPath` 是两侧共用的唯一真源，
 *   宿主侧的 `git log` 输出和客户端的 `node.filePath` 都过它。
 */

/** 一次 git churn 采集的结果。 */
export interface ChurnResult {
  /** 归一化文件路径 → 被多少个提交触及过。 */
  byFile: Record<string, number>;
  /** 本次统计覆盖的提交数。 */
  commitCount: number;
  /** 采集时的 HEAD；采集失败为 `null`。 */
  revision: string | null;
  /**
   * 是否被 `MAX_COMMITS` / `MAX_OUTPUT_BYTES` 截断。
   *
   * 刻意做成显式字段而不是「静默少算」：截断时面板必须能告诉用户
   * 「这份变更频率只覆盖最近 N 个提交」，否则一份被截断的统计看起来和完整统计一模一样。
   */
  truncated: boolean;
  /**
   * 采集**是否真的拿到了 git 数据**。
   *
   * `false` 表示 git 不可用 / 不是仓库 / 超时——此时 `byFile` 为空。
   * 面板据此显示「未获取到变更频率（仅按依赖关系排序）」，而不是假装 0 次变更。
   */
  available: boolean;
  /** 采集失败时的原因（人类可读）；成功为 `null`。刻意保留在载荷里：静默失败无法排查。 */
  error: string | null;
}

export const CHURN = {
  /** 最多统计多少个提交（超出则 `truncated = true`）。 */
  MAX_COMMITS: 2000,
  /** `git log` 输出上限（字节）。超过则 `truncated = true`，避免把巨型仓库的输出整体读进内存。 */
  MAX_OUTPUT_BYTES: 8 * 1024 * 1024,
  /** 单次 `git log` 的超时（毫秒）。超时按「采集失败」处理，不抛给调用方。 */
  TIMEOUT_MS: 15_000,
  /** 热点分数里 churn 的归一化标度：churn 达到该次数时倍数取到上限。 */
  SCALE: 20,
  /** churn 缺失（0）时的倍数——此时 `score === indegree`，与升级前完全一致。 */
  MIN_MULTIPLIER: 1,
  /** churn 充足时的倍数上限。 */
  MAX_MULTIPLIER: 4,
} as const;

/** 把一条路径归一化成「git log 输出 ↔ `node.filePath`」可比对的形状。 */
export function normalizeChurnPath(rawPath: string): string {
  return String(rawPath ?? '')
    // 先 trim：`git log` 的输出行可能带前导/尾随空白（重命名行切片尤其容易留一个空格）。
    // 键错位是静默的——`" new/a.ts"` 与 `"new/a.ts"` 是两个不同的键，
    // 查表永远落空，面板上表现为「改了很多次的文件 churn 是 0」，且没有任何报错。
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/**
 * 解析 `git log --name-only --format=%x1e` 的原始输出。
 *
 * 输出形状（每个提交一段，段间用 `\x1e` 分隔）：
 *
 * ```
 * \x1esrc/a.ts
 * src/b.ts
 * \x1esrc/c.ts
 * ```
 *
 * 用记录分隔符而不是空行：文件名本身可能为空（被删除的文件在 `--name-only` 下会留空行），
 * 空行无法区分「提交之间」和「这个提交里有一个空文件名」。
 *
 * 这里是**纯函数**：`byFile` 只统计在 `output` 里出现的路径，不做任何过滤。
 */
export function parseGitLogNames(output: string): { byFile: Record<string, number>; commitCount: number } {
  const byFile: Record<string, number> = {};
  const segments = String(output ?? '').split('\x1e');
  let commitCount = 0;

  for (const segment of segments) {
    // git 的 `--name-only` 每行一个路径；跳过空行与 "path -> path" 形式的重命名残留。
    let touched = false;
    for (const lineRaw of segment.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line) continue;
      // 重命名行（`--no-renames` 已禁用，但保留这层防御：git 的某些版本仍可能输出）。
      // `' -> '` 是**四**个字符，取新路径要跳过整段（`arrow + 4`）。
      // 早期写成 `arrow + 3` 会留下一个前导空格，使 `" new/a.ts"` 永远匹配不上
      // `node.filePath` 里的 `new/a.ts`——这类「差一个字符」的键错位在面板上
      // 表现为「这个文件明明改了很多次，churn 却是 0」，且没有任何报错。
      const arrow = line.indexOf(' -> ');
      const filePath = normalizeChurnPath(arrow >= 0 ? line.slice(arrow + 4) : line);
      if (!filePath) continue;
      byFile[filePath] = (byFile[filePath] ?? 0) + 1;
      touched = true;
    }
    if (touched) commitCount += 1;
  }

  return { byFile, commitCount };
}

/**
 * CodeScene 口径的热点分数 = 变更频率 × 复杂度（入度代理）。
 *
 * 两个量纲不能直接相乘：`churn` 可以到数百，`indegree` 一般几十。
 * 所以先把 churn 压到 `[MIN_MULTIPLIER, MAX_MULTIPLIER]` 的倍数区间再与 indegree 相乘。
 *
 * **关键不变量**：`churn <= 0`（含 git 不可用、文件从未被改动）时返回值**恰等于** `indegree`。
 * 这是「退化默认值必须拒绝而不是承诺」在本函数里的具体形态——没有 churn 数据时，
 * 热点排序必须与升级前逐位相同，否则等于用一次失败的采集悄悄改掉了既有排序。
 */
export function computeHotspotScore(indegree: number, churn: number): number {
  const base = indegree <= 0 ? 0 : indegree;
  if (!churn || churn <= 0) return base;

  const ratio = Math.max(0, Math.min(1, (churn - 1) / CHURN.SCALE));
  const multiplier = CHURN.MIN_MULTIPLIER
    + (CHURN.MAX_MULTIPLIER - CHURN.MIN_MULTIPLIER) * ratio;
  return Math.round(base * multiplier);
}

/** 把分数映射到与升级前同一套三档阈值（churn 为 0 时逐位复现旧行为）。 */
export function hotspotLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 20) return 'high';
  if (score >= 10) return 'medium';
  return 'low';
}

/**
 * 热点候选门槛：入度不足 5 的节点不进热点列表。
 *
 * 刻意**只**看入度，不看 churn：
 * ① 入度是「复杂度」一侧的代理，churn 是另一侧；用 churn 放宽门槛会让
 *    「一个被改了 50 次但没人调用的工具函数」挤进热点榜，那不是热点，是噪音；
 * ② 更重要的工程理由：churn 可能整体缺失（git 不可用），若门槛依赖 churn，
 *    那么一次采集失败会**改变候选集合**，而不仅仅是改变排序——这违反
 *    「采集失败不能悄悄改变既有行为」这条不变量。
 */
export function isHotspotEligible(indegree: number): boolean {
  return indegree >= 5;
}
