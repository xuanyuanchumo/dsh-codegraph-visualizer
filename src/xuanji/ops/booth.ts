/**
 * Booth 最小旋转（O(L) 循环规范代表元）。
 *
 * 璇玑图原型：同一首回文诗从不同字起读仍是同一首，取字典序最小旋转
 * 作为等价类代表元，使「循环等价」在去重时天然成立。
 *
 * 纯函数、零依赖——库的最底层（spec §九：ops 不依赖任何宿主）。
 *
 * @module xuanji/ops/booth
 */

/**
 * 返回数组字典序最小旋转的起始下标。
 *
 * O(L) 时间、O(L) 空间（Booth 1975）。对长度 0/1 直接返回 0。
 */
export function minimalRotationIndex<T extends string>(arr: readonly T[]): number {
  const n = arr.length;
  if (n <= 1) return 0;

  const s: T[] = [...arr, ...arr];
  const f = new Int32Array(2 * n).fill(-1);
  let k = 0;

  for (let j = 1; j < 2 * n; j++) {
    let i = f[j - k - 1]!;
    // s[j] 与 s[k + i + 1] 都在双倍串内，索引有界（j < 2n，k + i + 1 < 2n）
    while (i !== -1 && s[j]! !== s[k + i + 1]!) {
      if (s[j]! < s[k + i + 1]!) k = j - i - 1;
      i = f[i]!;
    }
    if (i === -1 && s[j]! !== s[k + i + 1]!) {
      if (s[j]! < s[k + i + 1]!) k = j;
      f[j - k] = -1;
    } else {
      f[j - k] = i + 1;
    }
  }

  return k;
}

/**
 * 返回字典序最小的循环旋转。
 *
 * 幂等：`booth(booth(x)) === booth(x)`；循环等价：任意旋转的结果相同。
 * 空数组返回空数组（不抛错——退化输入不制造异常，spec §八）。
 */
export function boothMinimalRotation<T extends string>(arr: readonly T[]): T[] {
  const n = arr.length;
  if (n <= 1) return [...arr];
  const k = minimalRotationIndex(arr);
  return [...arr.slice(k), ...arr.slice(0, k)];
}

/**
 * 判断一个序列是否已经是其等价类的最小旋转。
 * 供测试与不变量检查使用（O(L)）。
 */
export function isMinimalRotation<T extends string>(arr: readonly T[]): boolean {
  return minimalRotationIndex(arr) === 0;
}
