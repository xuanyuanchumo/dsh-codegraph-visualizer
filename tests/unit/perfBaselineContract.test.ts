import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 契约测试：性能门禁的"下限"必须有可审计的来源（P3-R27-02 的结构性收口）。
 *
 * 背景：`scripts/perf-gate.mjs` 自初始提交 edf7f90
 * （"ci: add performance gates and E2E tests to CI pipeline"，2026-10-01）起就写着
 * `test count >= 4463`，而仓库里没有任何地方推导得出 4463 —— 没有文档来源、
 * 没有计算过程、没有测量记录。一个无人能解释的门禁值有两个后果：
 *   1. 它失效时（套件缩小到 4463 以下仍无人知道该改门禁还是该补测试）；
 *   2. 它被"修"掉时（有人直接把数字改小让它变绿）没有任何守卫能发现。
 *
 * 修复把下限改成**已提交的基线记录**（`scripts/perf-baseline.json`）：门禁语义
 * 从"不得低于一个来历不明的常量"变成"不得低于最近一次真实测量值"，来源写在
 * 文件里、可 review。本测试钉住四件事：
 *
 *   1. `perf-gate.mjs` 源码里不得再出现"测试数 vs 数字字面量"的比较；
 *   2. 基线文件必须存在且形状合法（否则门禁会静默失去下限）；
 *   3. 基线缺失/损坏时门禁必须响亮失败，不得放行；
 *   4. 体积预算必须仍由单一 `BUDGET` 常量驱动，且与 docs/测试体系.md §4.1 一致。
 *
 * 本文件自身带有反向自检（见最后一个 describe）：若匹配模式被改坏成永不命中，
 * 反向自检会立刻变红，而不是让守卫永久绿着。
 */
const ROOT = resolve(__dirname, '../..');
const GATE_PATH = resolve(ROOT, 'scripts/perf-gate.mjs');
const BASELINE_PATH = resolve(ROOT, 'scripts/perf-baseline.json');
const DOC_PATH = resolve(ROOT, 'docs/测试体系.md');

/**
 * 去掉注释并**逐字符保留换行**，避免"注释里记录了旧写法"被当成真实代码，
 * 也避免行号整体上移（本仓库第四次踩这个坑，见 e2eSelectorContract.test.ts:25-28）。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1 + ' '.repeat(Math.max(0, _m.length - p1.length)));
}

const GATE_RAW = readFileSync(GATE_PATH, 'utf8');
const GATE_CODE = stripComments(GATE_RAW);

/**
 * "把测试数与某个数字字面量比较"的形状。
 * 修复后的代码是 `m.testCount >= baseline.testCount` —— 右侧不是字面量，不命中。
 */
const HARDCODED_TEST_COUNT_RE = /\b(testCount|total|numTotalTests)\s*[<>]=?\s*\d{3,}/;

/** 历史缺陷值：出现过就必须被人工解释，不能悄悄留在门禁里。 */
const LEGACY_LITERAL = '44' + '63';

describe('perf-gate：测试数下限必须来自可审计的基线记录', () => {
  it('compares the test count against the recorded baseline, never against a numeric literal', () => {
    const offenders = GATE_CODE
      .split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => HARDCODED_TEST_COUNT_RE.test(line));
    expect(offenders, `硬编码测试数下限: ${offenders.map((o) => `:${o.no}`).join(', ')}`).toEqual([]);
  });

  it('does not carry the historical unexplained literal anywhere in the gate source', () => {
    expect(GATE_CODE).not.toContain(LEGACY_LITERAL);
  });

  it('reads the baseline from a committed file rather than an inline constant', () => {
    expect(GATE_CODE).toContain('scripts/perf-baseline.json');
    expect(GATE_CODE).toMatch(/function loadBaseline|const loadBaseline/);
    expect(GATE_CODE).toContain('baseline.testCount');
  });

  it('fails loudly when the baseline is missing or malformed', () => {
    // "读不到基线"绝不能退化成"跳过这一档"：那正是 optional 分支之外唯一允许 skip 的情形。
    expect(GATE_CODE).toMatch(/baseline === null[\s\S]{0,400}?return \{ pass: false \}/);
    expect(GATE_CODE).toContain('--update-baseline');
  });
});

describe('perf-baseline.json：形状合法且可追溯', () => {
  it('exists and parses', () => {
    expect(existsSync(BASELINE_PATH), `缺少 ${BASELINE_PATH}`).toBe(true);
    expect(() => JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))).not.toThrow();
  });

  it('carries a positive integer test count, a date and the commit it was measured at', () => {
    const b = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(Number.isInteger(b.testCount)).toBe(true);
    expect(b.testCount).toBeGreaterThan(0);
    expect(typeof b.recordedAt).toBe('string');
    expect(b.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof b.commit).toBe('string');
    expect(b.commit.length).toBeGreaterThan(0);
    // 体积也一并记录，让"基线"是完整的测量快照而非单个数字。
    expect(Number.isInteger(b.clientBundleBytes)).toBe(true);
    expect(Number.isInteger(b.hostBundleBytes)).toBe(true);
    expect(b.clientBundleBytes).toBeGreaterThan(0);
    expect(b.hostBundleBytes).toBeGreaterThan(0);
  });
});

describe('体积预算：单一常量驱动且与文档一致', () => {
  const DOC_RAW = readFileSync(DOC_PATH, 'utf8');

  it('derives both bundle gates from the BUDGET object', () => {
    expect(GATE_CODE).toMatch(/const BUDGET = \{/);
    expect(GATE_CODE).toContain('BUDGET.clientBundleBytes');
    expect(GATE_CODE).toContain('BUDGET.hostBundleBytes');
    // 门禁值不得再以裸字面量出现在比较里（那样 BUDGET 就成了死常量）。
    expect(GATE_CODE).not.toMatch(/size <= 3 \* 1024 \* 1024/);
    expect(GATE_CODE).not.toMatch(/size <= 512 \* 1024/);
  });

  it('states the same client / host budget as docs/测试体系.md §4.1', () => {
    expect(GATE_CODE).toContain('3 * 1024 * 1024');
    expect(GATE_CODE).toContain('512 * 1024');
    expect(DOC_RAW).toContain('client bundle ≤ 3MB');
    expect(DOC_RAW).toContain('host bundle ≤ 512KB');
  });

  it('no longer documents the test-count gate as having no source', () => {
    // 修复后文档必须指向基线文件，而不是继续声明"没有文档化的来源"。
    expect(DOC_RAW).not.toContain('没有文档化的来源');
    expect(DOC_RAW).toContain('perf-baseline.json');
  });
});

describe('反向自检：匹配模式本身不能失效', () => {
  it('detects the historical shape and lets the new shape through', () => {
    // 样本用字符串拼接构造，避免本文件出现连续可匹配的形状而被自己命中。
    const historical = 'return { pass: ' + 'total >' + '= ' + LEGACY_LITERAL + ' };';
    const current = 'return { pass: m.testCount >= baseline.testCount };';
    expect(HARDCODED_TEST_COUNT_RE.test(historical)).toBe(true);
    expect(HARDCODED_TEST_COUNT_RE.test(current)).toBe(false);
  });

  it('scanned a non-empty source (a silent read failure must not read as success)', () => {
    expect(GATE_CODE.length).toBeGreaterThan(500);
    expect(GATE_RAW).toContain('perf-gate');
  });
});
