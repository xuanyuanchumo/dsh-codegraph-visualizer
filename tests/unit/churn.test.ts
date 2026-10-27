/**
 * `src/shared/churn.ts` 的单元测试（研究报告 §六 #11）。
 *
 * 这个文件是**纯函数层**，所以这里的用例都在钉不变量，而不是在测 git：
 * ① 解析器认 `\x1e` 记录分隔符（空行分不开提交）；
 * ② `computeHotspotScore(indegree, 0) === indegree`——没有 churn 数据时排序不许变；
 * ③ 倍数区间有上下界（不能因为 churn 很大就把入度放大到无意义）。
 */
import { describe, it, expect } from 'vitest';
import {
  CHURN,
  computeHotspotScore,
  hotspotLevel,
  isHotspotEligible,
  normalizeChurnPath,
  parseGitLogNames,
} from '../../src/shared/churn.ts';

describe('normalizeChurnPath', () => {
  it('把反斜杠统一成正斜杠', () => {
    expect(normalizeChurnPath('src\\client\\a.ts')).toBe('src/client/a.ts');
  });

  it('剥掉开头的 ./', () => {
    expect(normalizeChurnPath('./src/a.ts')).toBe('src/a.ts');
  });

  it('剥掉尾部斜杠', () => {
    expect(normalizeChurnPath('src/dir///')).toBe('src/dir');
  });

  it('空输入与 null 都归一成空串（不抛异常）', () => {
    expect(normalizeChurnPath('')).toBe('');
    expect(normalizeChurnPath(null as unknown as string)).toBe('');
    expect(normalizeChurnPath(undefined as unknown as string)).toBe('');
  });
});

describe('parseGitLogNames', () => {
  it('按 \\x1e 分段统计每个文件被多少个提交触及', () => {
    // 三个提交：第一个改了 a+b，第二个改了 a，第三个改了 c。
    const output = '\x1esrc/a.ts\nsrc/b.ts\n\x1esrc/a.ts\n\x1esrc/c.ts\n';
    const { byFile, commitCount } = parseGitLogNames(output);
    expect(byFile).toEqual({ 'src/a.ts': 2, 'src/b.ts': 1, 'src/c.ts': 1 });
    expect(commitCount).toBe(3);
  });

  it('空行不产生幽灵条目，也不额外增加 commitCount', () => {
    // 被删除的文件在 `--name-only` 下会留下空行；空行不能算作一次提交。
    const output = '\x1esrc/a.ts\n\n\n\x1e\n';
    const { byFile, commitCount } = parseGitLogNames(output);
    expect(byFile).toEqual({ 'src/a.ts': 1 });
    expect(commitCount).toBe(1);
  });

  it('CRLF 行尾能被正确切分', () => {
    const output = '\x1esrc/a.ts\r\nsrc/b.ts\r\n';
    const { byFile } = parseGitLogNames(output);
    expect(byFile).toEqual({ 'src/a.ts': 1, 'src/b.ts': 1 });
  });

  it('重命名行取箭头右侧的新路径', () => {
    // `--no-renames` 已禁用重命名拆分，但某些 git 版本仍可能输出该形式；
    // 保留这层防御时，必须证明它真的取的是**新**路径。
    const output = '\x1eold/a.ts -> new/a.ts\n';
    const { byFile } = parseGitLogNames(output);
    expect(byFile).toEqual({ 'new/a.ts': 1 });
    expect(byFile['old/a.ts']).toBeUndefined();
  });

  it('空输出得到空结果且 commitCount 为 0', () => {
    expect(parseGitLogNames('')).toEqual({ byFile: {}, commitCount: 0 });
  });

  it('空提交段（只有分隔符）不计入 commitCount', () => {
    expect(parseGitLogNames('\x1e\x1e\x1e').commitCount).toBe(0);
  });
});

describe('computeHotspotScore', () => {
  it('churn 为 0 时分数**恰等于**入度（退化排序与升级前逐位相同）', () => {
    // 这是本模块最关键的不变量：git 不可用时不能悄悄改变既有热点排序。
    for (const indegree of [0, 1, 5, 17, 200]) {
      expect(computeHotspotScore(indegree, 0)).toBe(indegree);
    }
  });

  it('churn 为负（脏数据）时同样退化为入度', () => {
    expect(computeHotspotScore(10, -3)).toBe(10);
  });

  it('churn 为 1 时倍数取到下限，分数仍等于入度', () => {
    expect(computeHotspotScore(10, 1)).toBe(10);
  });

  it('churn 增大时倍数单调不减', () => {
    const scores = [0, 1, 5, 10, 20, 50, 1000].map((c) => computeHotspotScore(10, c));
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
  });

  it('倍数有上限：churn 远超 SCALE 时不超过 MAX_MULTIPLIER 倍', () => {
    const huge = computeHotspotScore(10, CHURN.SCALE * 1000);
    expect(huge).toBe(10 * CHURN.MAX_MULTIPLIER);
  });

  it('入度为 0 时无论 churn 多大分数都是 0', () => {
    expect(computeHotspotScore(0, 500)).toBe(0);
    expect(computeHotspotScore(0, 0)).toBe(0);
  });

  it('返回整数（面板显示不出现小数）', () => {
    for (const c of [2, 3, 7, 13, 19]) {
      expect(Number.isInteger(computeHotspotScore(7, c))).toBe(true);
    }
  });
});

describe('hotspotLevel', () => {
  it('三档阈值边界：20 起 high、10 起 medium、其余 low', () => {
    expect(hotspotLevel(20)).toBe('high');
    expect(hotspotLevel(19)).toBe('medium');
    expect(hotspotLevel(10)).toBe('medium');
    expect(hotspotLevel(9)).toBe('low');
    expect(hotspotLevel(0)).toBe('low');
  });
});

describe('isHotspotEligible', () => {
  it('入度 5 是门槛（含 5）', () => {
    expect(isHotspotEligible(4)).toBe(false);
    expect(isHotspotEligible(5)).toBe(true);
  });
});

describe('CHURN 常量', () => {
  it('倍数区间与截断上限自洽（MIN < MAX、SCALE > 0）', () => {
    expect(CHURN.MIN_MULTIPLIER).toBeLessThan(CHURN.MAX_MULTIPLIER);
    expect(CHURN.SCALE).toBeGreaterThan(0);
    expect(CHURN.MAX_COMMITS).toBeGreaterThan(0);
    expect(CHURN.TIMEOUT_MS).toBeGreaterThan(0);
  });
});
