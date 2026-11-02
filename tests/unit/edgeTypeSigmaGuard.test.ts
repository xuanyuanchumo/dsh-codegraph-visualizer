/**
 * cycle-136：Σ（边类型全集）**不得硬编码**的源码级守卫。
 *
 * ## 它守的是什么
 *
 * cycle-135 把 Σ 列表（`call / import / extend / implement / dependency / contains /
 * association / aggregation / composition`）**逐字写进了 zh/en 两个 i18n 字典**，
 * 违反了同循环刚建立的「Σ 是宿主侧事实、客户端复制一份会静默分叉」这条纪律。
 * Σ 一旦在客户端写死，宿主侧改一个类型名，客户端的提示区就会永远显示旧列表——
 * 而没有任何测试会变红（文案变了但测试只断言「键存在」）。
 *
 * 本守卫把这条纪律变成**可失败的断言**：任何 i18n 值或面板字符串字面量里出现
 * **3 个及以上**不同的 Σ 类型名，就判失败。阈值取 3 而不是 9：硬编码的那份是 9 个，
 * 而正常文案里「call chain」「extend/implement」这类**单个**类型名的提及是合法且必要的。
 *
 * ## 为什么扫描**显式路径**而不是目录遍历
 *
 * 目录遍历会把本守卫文件自己也扫进去（它的 `TYPE_NAMES` 数组就是一份字面量样本），
 * 于是守卫第一天就红——这是本仓库反复记录过的「守卫匹配自己的样本」。
 * 因此这里只扫三个**明确的源文件**（两个字典 + 面板），守卫文件不在范围内。
 *
 * ## 反向自检
 *
 * 「守卫没抓到任何违规」有两种解释：没有违规，或守卫坏了。因此必须喂一条
 * **合成违规**（用拼接构造，避免守卫文件自身出现连续的类型名），断言它被抓到。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** Σ 全集。**逐词拼接**构造，使本守卫文件自身不含连续的类型名字面量。 */
const TYPE_NAMES: readonly string[] = [
  'ca' + 'll',
  'im' + 'port',
  'ex' + 'tend',
  'imple' + 'ment',
  'depend' + 'ency',
  'contains',
  'asso' + 'ciation',
  'aggrega' + 'tion',
  'compo' + 'sition',
];

/** 阈值：3 个及以上不同类型名出现在**同一个字符串值**里 ⇒ 疑似硬编码的 Σ 列表。 */
const HARDCODE_THRESHOLD = 3;

function countDistinctTypes(value: string): number {
  const lower = value.toLowerCase();
  let count = 0;
  for (const name of TYPE_NAMES) {
    if (lower.includes(name)) count += 1;
  }
  return count;
}

function stripComments(src: string): string {
  // 逐字符替换注释为等长空白，**保留换行**：否则每条违规的行号都会漂移。
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) { out += ' '.repeat(src.length - i); break; }
      out += ' '.repeat(end + 2 - i);
      i = end + 2;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      if (end === -1) { out += ' '.repeat(src.length - i); break; }
      out += ' '.repeat(end - i);
      i = end;
    } else {
      out += src[i]!;
      i += 1;
    }
  }
  return out;
}

/** 提取源码里的所有单/双引号字符串字面量（去引号后的原文）。 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[0]!.slice(1, -1));
  return out;
}

function scanFile(rel: string): Array<{ file: string; value: string }> {
  const raw = readFileSync(resolve(ROOT, rel), 'utf8');
  const offenders: Array<{ file: string; value: string }> = [];
  for (const literal of stringLiterals(stripComments(raw))) {
    if (countDistinctTypes(literal) >= HARDCODE_THRESHOLD) {
      offenders.push({ file: rel, value: literal.slice(0, 120) });
    }
  }
  return offenders;
}

const SCANNED_FILES = [
  'src/client/i18n/dicts/zh.ts',
  'src/client/i18n/dicts/en.ts',
  'src/client/components/PathPatternPanel.tsx',
] as const;

describe('Σ 不得硬编码（cycle-136 源码级守卫）', () => {
  it('反向自检：合成违规必须被抓到（否则守卫恒绿 = 没有守卫）', () => {
    const synthetic = [
      'ca' + 'll', 'im' + 'port', 'ex' + 'tend',
    ].join(' / ');
    expect(countDistinctTypes(synthetic)).toBeGreaterThanOrEqual(HARDCODE_THRESHOLD);
    // 单个类型名不得触发（否则会误伤「call chain」这类合法文案）。
    expect(countDistinctTypes('Toggle call chain highlight')).toBeLessThan(HARDCODE_THRESHOLD);
    expect(countDistinctTypes('show extend/implement')).toBeLessThan(HARDCODE_THRESHOLD);
  });

  it('三个被扫描文件里没有任何字符串字面量含 3+ 个 Σ 类型名', () => {
    const offenders = SCANNED_FILES.flatMap((f) => scanFile(f));
    expect(offenders).toEqual([]);
  });

  it('守卫的扫描范围非空（防空转：文件路径写错时上面那条会恒绿）', () => {
    for (const f of SCANNED_FILES) {
      const raw = readFileSync(resolve(ROOT, f), 'utf8');
      expect(raw.length).toBeGreaterThan(100);
    }
  });
});
