/**
 * 滚动哈希：把「节点序列」映射为可 O(1) 拼接的指纹。
 *
 * 璇玑图原型：增量插入一条边时，前缀哈希 + 新边 + 后缀哈希直接组合，
 * 不需要重新遍历整条路径（spec §5.2）。
 *
 * 实现为多项式滚动哈希的**幺半群**形式：
 *   parts([a, b]) = concat(parts([a]), parts([b]))
 *   concat(A, B).hash = A.hash * BASE^B.len + B.hash   (mod 2^64)
 *
 * 只用于**等价判定/去重**，不用于安全用途。
 *
 * @module xuanji/ops/rolling-hash
 */

const BASE = 131n;
const MASK = (1n << 64n) - 1n;
/** 节点分隔符，避免 'ab'+'c' 与 'a'+'bc' 撞哈希。 */
const SEP = 1n;

/** 一段序列的可拼接哈希片段。 */
export interface HashPart {
  /** 多项式哈希值（64-bit 自然溢出）。 */
  readonly hash: bigint;
  /** 参与哈希的字符数（含节点分隔符）。 */
  readonly len: number;
}

/** B^len 的缓存（惰性扩展）。 */
const powCache: bigint[] = [1n];

function powBase(exp: number): bigint {
  if (exp < 0) throw new RangeError('rolling-hash: negative exponent');
  while (powCache.length <= exp) {
    powCache.push((powCache[powCache.length - 1]! * BASE) & MASK);
  }
  return powCache[exp]!;
}

/** 单个节点 id 的哈希片段（字符 + 分隔符）。 */
export function hashNode(id: string): HashPart {
  let h = 0n;
  for (let i = 0; i < id.length; i++) {
    h = (h * BASE + BigInt(id.charCodeAt(i))) & MASK;
  }
  h = (h * BASE + SEP) & MASK;
  return { hash: h, len: id.length + 1 };
}

/** 空序列片段（哈希 0、长度 0），是 concat 的单位元。 */
export const EMPTY_HASH: HashPart = Object.freeze({ hash: 0n, len: 0 });

/** O(1) 拼接两个片段。 */
export function concatHash(a: HashPart, b: HashPart): HashPart {
  return {
    hash: (a.hash * powBase(b.len) + b.hash) & MASK,
    len: a.len + b.len,
  };
}

/** 计算整个节点序列的哈希片段，O(L·|id|)。 */
export function sequenceHashParts(nodes: readonly string[]): HashPart {
  let acc = EMPTY_HASH;
  for (const id of nodes) acc = concatHash(acc, hashNode(id));
  return acc;
}

/** 64-bit 哈希的十六进制字符串形式（去重键、PathEntry.hash 用）。 */
export function hashToHex(part: HashPart): string {
  return part.hash.toString(16).padStart(16, '0');
}

/** 面向 PathEntry 的门面。 */
export class RollingHash {
  /** 整条序列的哈希指纹（十六进制，16 字符定长）。 */
  static hashSequence(nodes: readonly string[]): string {
    return hashToHex(sequenceHashParts(nodes));
  }

  /** 可拼接片段（增量组合用）。 */
  static parts(nodes: readonly string[]): HashPart {
    return sequenceHashParts(nodes);
  }

  /** O(1) 组合：prefix + suffix。 */
  static combine(prefix: HashPart, suffix: HashPart): HashPart {
    return concatHash(prefix, suffix);
  }

  static empty(): HashPart {
    return EMPTY_HASH;
  }
}
