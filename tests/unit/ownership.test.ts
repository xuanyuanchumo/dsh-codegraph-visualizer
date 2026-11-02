/**
 * `src/shared/ownership.ts` 的单元测试（研究方案 §4 的所有权/知识视图 $\Pi_{\text{own}}$）。
 *
 * 覆盖：porcelain 解析（正常 / 空 / 多记录 / 无 filename）、按文件分组、
 * 作者→符号映射（精确 / 文件级近似 / 无 blame 记录）、bus factor（阈值边界 /
 * 缺数据拒绝）。重点是**证据纪律**：近似归属必须留痕，缺数据必须 `available:false`。
 */
import { describe, it, expect } from 'vitest';
import {
  buildOwnershipMap,
  computeBusFactor,
  groupBlameByFile,
  parseGitBlamePorcelain,
  type BlameLine,
} from '../../src/shared/ownership.ts';
import type { GraphNode } from '../../src/types/index.ts';

function node(id: string, filePath: string, lineNumber?: number): GraphNode {
  return {
    id: id as GraphNode['id'],
    label: id,
    type: 'function',
    filePath,
    ...(lineNumber === undefined ? {} : { lineNumber }),
    properties: {},
  };
}

/** 构造一条 porcelain 记录（含头部、字段、空行、行内容）。 */
function porcelainRecord(sha: string, author: string, email: string, filename: string, line = 1): string {
  return [
    `${sha} 1 ${line} 1`,
    `author ${author}`,
    `author-mail <${email}>`,
    'author-time 123',
    'author-tz +0000',
    `filename ${filename}`,
    '',
    `content of line ${line}`,
  ].join('\n');
}

describe('parseGitBlamePorcelain', () => {
  it('解析一条记录的 hash / 行号 / 作者 / 邮箱 / 文件名', () => {
    const raw = porcelainRecord('abc1234', 'Alice', 'alice@example.com', 'src/a.ts', 7);
    const lines = parseGitBlamePorcelain(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      commit: 'abc1234',
      line: 7,
      author: 'Alice',
      email: 'alice@example.com',
      filename: 'src/a.ts',
    });
  });

  it('解析多条记录且邮箱尖括号被剥掉', () => {
    const raw = [
      porcelainRecord('aaa1111', 'Alice', 'alice@example.com', 'src/a.ts', 1),
      porcelainRecord('bbb2222', 'Bob', 'bob@example.com', 'src/b.ts', 2),
    ].join('\n');
    const lines = parseGitBlamePorcelain(raw);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.author).toBe('Bob');
    expect(lines[1]?.email).toBe('bob@example.com');
  });

  it('空输入返回空数组（不抛异常）', () => {
    expect(parseGitBlamePorcelain('')).toEqual([]);
    expect(parseGitBlamePorcelain(null as unknown as string)).toEqual([]);
  });

  it('没有 filename 字段时 filename 为空串（后续分组会跳过）', () => {
    const raw = [
      'abc1234 1 1 1',
      'author Alice',
      'author-mail <alice@example.com>',
      '',
      'content',
    ].join('\n');
    const lines = parseGitBlamePorcelain(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.filename).toBe('');
  });

  it('filename 字段经归一化（反斜杠 → 正斜杠、剥掉 ./ 与尾部斜杠）', () => {
    const raw = porcelainRecord('abc1234', 'Alice', 'alice@example.com', '.\\src\\dir\\');
    const lines = parseGitBlamePorcelain(raw);
    expect(lines[0]?.filename).toBe('src/dir');
  });
});

describe('groupBlameByFile', () => {
  it('按解析器已归一化的路径分组', () => {
    const lines: BlameLine[] = [
      { commit: 'a', line: 1, author: 'A', email: '', filename: 'src/a.ts' },
      { commit: 'b', line: 2, author: 'B', email: '', filename: 'src/a.ts' },
      { commit: 'c', line: 1, author: 'C', email: '', filename: 'src/b.ts' },
    ];
    const byFile = groupBlameByFile(lines);
    expect(Object.keys(byFile).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(byFile['src/a.ts']).toHaveLength(2);
  });

  it('跳过 filename 为空的记录', () => {
    const lines: BlameLine[] = [
      { commit: 'a', line: 1, author: 'A', email: '', filename: '' },
      { commit: 'b', line: 1, author: 'B', email: '', filename: 'src/b.ts' },
    ];
    const byFile = groupBlameByFile(lines);
    expect(Object.keys(byFile)).toEqual(['src/b.ts']);
  });
});

describe('buildOwnershipMap', () => {
  const blame = groupBlameByFile(parseGitBlamePorcelain([
    porcelainRecord('aaa1111', 'Alice', 'alice@example.com', 'src/a.ts', 1),
    porcelainRecord('bbb2222', 'Bob', 'bob@example.com', 'src/a.ts', 2),
    porcelainRecord('ccc3333', 'Carol', 'carol@example.com', 'src/b.ts', 1),
  ].join('\n')));

  it('精确归属：lineNumber 命中对应行', () => {
    const report = buildOwnershipMap([node('n1', 'src/a.ts', 1), node('n2', 'src/a.ts', 2)], blame);
    expect(report.available).toBe(true);
    expect(report.attributedCount).toBe(2);
    expect(report.nodeLabels).toEqual({ n1: 'Alice', n2: 'Bob' });
    expect(report.entries.map((e) => e.author)).toEqual(['Alice', 'Bob']);
  });

  it('无 blame 数据时 available:false（不编造作者）', () => {
    const report = buildOwnershipMap([node('n1', 'src/a.ts')], null);
    expect(report.available).toBe(false);
    expect(report.entries).toEqual([]);
    expect(report.reason).toBeTruthy();
  });

  it('空 nodes + 有 blame → available:true 且零归属', () => {
    const report = buildOwnershipMap([], blame);
    expect(report.available).toBe(true);
    expect(report.nodeCount).toBe(0);
    expect(report.authorCount).toBe(0);
  });

  it('没有 lineNumber 时用文件最后一行作者（近似），并在 reason 留痕', () => {
    const report = buildOwnershipMap([node('n1', 'src/a.ts')], blame);
    expect(report.nodeLabels).toEqual({ n1: 'Bob' }); // src/a.ts 最后一行是 Bob
    expect(report.reason).toContain('近似');
  });

  it('lineNumber 在文件中找不到时退回最后一行作者（近似）', () => {
    const report = buildOwnershipMap([node('n1', 'src/a.ts', 999)], blame);
    expect(report.nodeLabels).toEqual({ n1: 'Bob' });
    expect(report.reason).toContain('近似');
  });

  it('文件在 blame 中无记录时该节点不被归属', () => {
    const report = buildOwnershipMap([node('n1', 'src/new.ts', 1)], blame);
    expect(report.attributedCount).toBe(0);
    expect(report.nodeLabels).toEqual({});
  });

  it('混合场景：部分归属 + 部分无记录时 reason 说明缺口', () => {
    const report = buildOwnershipMap([node('n1', 'src/a.ts', 1), node('n2', 'src/new.ts', 1)], blame);
    expect(report.attributedCount).toBe(1);
    expect(report.nodeCount).toBe(2);
  });
});

describe('computeBusFactor', () => {
  const blame = groupBlameByFile(parseGitBlamePorcelain([
    porcelainRecord('aaa1111', 'Alice', 'alice@example.com', 'src/a.ts', 1),
    porcelainRecord('bbb2222', 'Bob', 'bob@example.com', 'src/a.ts', 2),
    porcelainRecord('ccc3333', 'Carol', 'carol@example.com', 'src/b.ts', 1),
  ].join('\n')));

  it('默认阈值 0.5：两位作者（Alice 1 + Bob 1 = 2/3 ≥ 0.5）', () => {
    const result = computeBusFactor([node('n1', 'src/a.ts', 1), node('n2', 'src/a.ts', 2), node('n3', 'src/b.ts', 1)], blame);
    expect(result.available).toBe(true);
    expect(result.total).toBe(3);
    expect(result.busFactor).toBe(2);
  });

  it('阈值 1.0 时需要覆盖全部作者', () => {
    const result = computeBusFactor([node('n1', 'src/a.ts', 1), node('n2', 'src/a.ts', 2), node('n3', 'src/b.ts', 1)], blame, 1.0);
    expect(result.busFactor).toBe(3);
    expect(result.covered).toBe(3);
  });

  it('无 blame 数据时 available:false', () => {
    const result = computeBusFactor([node('n1', 'src/a.ts')], null);
    expect(result.available).toBe(false);
    expect(result.busFactor).toBe(0);
  });

  it('没有任何节点可归属时 available:false（不编造 1）', () => {
    const result = computeBusFactor([node('n1', 'src/new.ts', 1)], blame);
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
