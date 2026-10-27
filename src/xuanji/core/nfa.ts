/**
 * 长度维度 NFA：把规则的长度区间 `[lMin, lMax]` 编译成一条「已消费边数」链。
 *
 * 璇玑图原型：一条读法的**长度**可以先被抽象成一道闸门——
 * 「至少读 lMin 个字、至多读 lMax 个字」。闸门不关心读到的是哪个字，
 * 因此这里编译出的是**长度维度的抽象自动机**，不是节点身份维度的自动机
 * （节点身份与边存在性由 `isLegalPath` / `GraphSpace` 负责）。
 *
 * 状态的语义（前缀压缩）：自动机从「已走过 lMin 条边」的状态出发，
 * 第 i 个状态表示「已走过 lMin + i 条边且仍在界内」，i ∈ [0, lMax - lMin]。
 * 因为任意长度 ≥ lMin 的路径都允许在此收束，所以**链上每个状态都是接受态**。
 *
 * 由此得到契约中的 `|Q| = lMax - lMin + 1` 与 `accepting = |Q|`。
 * 这也解释了为什么 `lMax` 必须是有限值：无限长链不存在有穷状态编码；
 * 调用方需先把 `lMax = ∞` 具体化为 `|V|`（simple 路径的上界）再编译。
 *
 * 零宿主依赖。
 *
 * @module xuanji/core/nfa
 */

import type { PathRule } from './path-rule.ts';

/** 编译结果：状态数 = 链长，accepting = 接受态个数（本抽象中等于状态数）。 */
export interface NfaCompileResult {
  /** 状态数 |Q| = lMax - lMin + 1（lMax 必须有限）。 */
  readonly states: number;
  /** 接受态个数（长度闸门中每个状态都可收束，故等于 states）。 */
  readonly accepting: number;
}

/**
 * 编译长度维度 NFA。
 *
 * @throws RangeError 当 `lMax` 非有限、`lMin` 非有限/为负、或 `lMax < lMin`。
 * 抛错而非静默截断：无限长度没有有穷状态编码，静默返回一个数字等于撒谎。
 */
export function compileLengthNfa(rule: Pick<PathRule, 'lMin' | 'lMax'>): NfaCompileResult {
  const { lMin, lMax } = rule;
  if (!Number.isFinite(lMax)) {
    throw new RangeError(
      'compileLengthNfa: lMax must be finite (materialize an unbounded lMax as |V| before compiling)',
    );
  }
  if (!Number.isFinite(lMin) || lMin < 0) {
    throw new RangeError('compileLengthNfa: lMin must be a finite number >= 0');
  }
  if (lMax < lMin) {
    throw new RangeError('compileLengthNfa: lMax must be >= lMin');
  }
  if (!Number.isInteger(lMin) || !Number.isInteger(lMax)) {
    // 长度是边数，非整数长度没有对应的状态链；编造一个小数状态数就是撒谎。
    throw new RangeError('compileLengthNfa: lMin and lMax must be integers');
  }
  const states = lMax - lMin + 1;
  return { states, accepting: states };
}
