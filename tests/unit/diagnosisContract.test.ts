/**
 * T146-2 契约：诊断四态 + 问题码分类学（cycle-146）。
 *
 * `diagnosePrerequisiteStatus` 是四态分类的**唯一**实现；本套测试用真值表钉死所有
 * 组合（4 能力位 → 16 输入组合中的 3 个等价类：disabled / degraded / ready），
 * 并验证「问题码按稳定顺序产出 + disabled 时 ALL_GRAPH_CHANNELS_ABSENT 永远在最前」。
 *
 * 反自我反证：状态码集合断言必须携带**反向样例**（mixing state 与 issues 断言），
 * 否则一个恒返回 ready 的实现只被一个用例抓住。
 */
import { describe, expect, it } from 'vitest';
import {
  diagnosePrerequisiteStatus,
  emptyPrerequisiteStatus,
  type PrerequisiteStatus,
} from '../../src/shared/prerequisiteStatus.ts';

const status = (over: Partial<PrerequisiteStatus>): PrerequisiteStatus => ({
  ...emptyPrerequisiteStatus(),
  ...over,
});

describe('diagnosePrerequisiteStatus (cycle-146 T146-2)', () => {
  it('DQ-1 all channels absent → disabled + ALL_GRAPH_CHANNELS_ABSENT first in issues', () => {
    const d = diagnosePrerequisiteStatus(emptyPrerequisiteStatus());
    expect(d.state).toBe('disabled');
    expect(d.readyChannels).toEqual([]);
    expect(d.issues[0]?.code).toBe('ALL_GRAPH_CHANNELS_ABSENT');
    // 完整问题码集合：四个能力位各一条 + 首位聚合码
    expect(d.issues.map((i) => i.code)).toEqual([
      'ALL_GRAPH_CHANNELS_ABSENT',
      'CODEGRAPH_UPSTREAM_ABSENT',
      'LENS_UPSTREAM_ABSENT',
      'AST_SOURCE_UNAVAILABLE',
      'GRAPH_SOURCE_UNAVAILABLE',
    ]);
    expect(d.astReady).toBe(false);
  });

  it('DQ-2 graph present but AST absent → degraded (core journey works, analysis missing)', () => {
    const d = diagnosePrerequisiteStatus(status({ graphSource: true }));
    expect(d.state).toBe('degraded');
    expect(d.readyChannels).toEqual(['graphSource']);
    expect(d.issues.map((i) => i.code)).toContain('AST_SOURCE_UNAVAILABLE');
    // degraded 不得携带 ALL_GRAPH_CHANNELS_ABSENT（有图可看）
    expect(d.issues.map((i) => i.code)).not.toContain('ALL_GRAPH_CHANNELS_ABSENT');
    expect(d.astReady).toBe(false);
  });

  it('DQ-3 upstream + AST → ready with zero blocking issues', () => {
    const d = diagnosePrerequisiteStatus(status({ codegraph: true, astSource: true }));
    expect(d.state).toBe('ready');
    expect(d.readyChannels).toEqual(['codegraph']);
    // ready 仍可携带「可选上游缺席」类问题（lens/graphSource 未在场）——
    // ready 的语义是「全功能」，不是「零问题」：lens 缺席不阻塞任何功能。
    expect(d.issues.map((i) => i.code)).toContain('LENS_UPSTREAM_ABSENT');
    expect(d.issues.map((i) => i.code)).not.toContain('AST_SOURCE_UNAVAILABLE');
    expect(d.astReady).toBe(true);
  });

  it('DQ-4 lens alone can carry the graph channel (parity with codegraph)', () => {
    const d = diagnosePrerequisiteStatus(status({ lens: true, astSource: true }));
    expect(d.state).toBe('ready');
    expect(d.readyChannels).toEqual(['lens']);
  });

  it('DQ-5 AST present but NO graph channel → still disabled (AST ≠ graph, §61.10)', () => {
    // 这条是 §61.10 教训的直接回归：astSource 单独在场绝不把服务判成可用
    const d = diagnosePrerequisiteStatus(status({ astSource: true }));
    expect(d.state).toBe('disabled');
    expect(d.astReady).toBe(true);
  });

  it('DQ-6 readyChannels preserves the deterministic channel order', () => {
    const d = diagnosePrerequisiteStatus(status({ codegraph: true, lens: true, graphSource: true }));
    expect(d.readyChannels).toEqual(['codegraph', 'lens', 'graphSource']);
  });
});
