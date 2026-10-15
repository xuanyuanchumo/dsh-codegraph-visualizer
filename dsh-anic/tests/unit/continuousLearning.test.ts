/**
 * 持续学习层（M10-e）单元测试。
 *
 * 覆盖：健康等级判定 / 改进建议生成 / 格式化摘要 / 边界条件。
 */
import { describe, it, expect } from 'vitest';
import { analyzeSkillHealth, formatHealthSummary } from '../../src/host/runtime/continuousLearning.ts';
import type { FlowTrackerState, FlowRecord } from '../../src/host/runtime/flowTracker.ts';

function makeFlow(overrides: Partial<FlowRecord> = {}): FlowRecord {
  return {
    flowId: `test-${Math.random().toString(36).slice(2)}`,
    script: 'eval-runner',
    workspace: '/tmp/test',
    args: [],
    status: 'DONE',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1000,
    ...overrides,
  };
}

function makeState(flows: FlowRecord[]): FlowTrackerState {
  return { flows, counter: flows.length };
}

describe('continuousLearning', () => {
  describe('analyzeSkillHealth', () => {
    it('空状态返回零调用报告', () => {
      const report = analyzeSkillHealth(makeState([]));
      expect(report.totalInvocations).toBe(0);
      expect(report.overallSuccessRate).toBe(0);
      expect(report.scripts).toEqual([]);
      expect(report.suggestions).toEqual([]);
    });

    it('healthy 脚本：成功率≥80% 且无超时', () => {
      const flows = Array.from({ length: 5 }, () => makeFlow({ script: 'gate-check', status: 'DONE', exitCode: 0 }));
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].level).toBe('healthy');
      expect(report.scripts[0].successRate).toBe(1);
      expect(report.suggestions).toEqual([]);
    });

    it('degraded 脚本：成功率<80% 生成 warn/critical 建议', () => {
      const flows = [
        ...Array.from({ length: 2 }, () => makeFlow({ script: 'eval-runner', status: 'DONE' })),
        ...Array.from({ length: 3 }, () => makeFlow({ script: 'eval-runner', status: 'FAILED', exitCode: 1 })),
      ];
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].level).toBe('degraded');
      expect(report.scripts[0].successRate).toBe(0.4);
      expect(report.suggestions).toHaveLength(1);
      expect(report.suggestions[0].severity).toBe('critical'); // <50% → critical
      expect(report.suggestions[0].id).toBe('fix-eval-runner');
    });

    it('slow 脚本：超时率>20% 生成 warn 建议', () => {
      const flows = [
        ...Array.from({ length: 4 }, () => makeFlow({ script: 'auto-fix-loop', status: 'DONE' })),
        ...Array.from({ length: 2 }, () => makeFlow({ script: 'auto-fix-loop', status: 'TIMEOUT' })),
      ];
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].level).toBe('slow');
      expect(report.scripts[0].timeoutRate).toBe(1 / 3);
      expect(report.suggestions[0].id).toBe('speed-auto-fix-loop');
    });

    it('expensive 脚本：平均耗时>30s 生成 info 建议', () => {
      const flows = Array.from({ length: 5 }, () =>
        makeFlow({ script: 'multi-agent-gate', status: 'DONE', durationMs: 45000 }),
      );
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].level).toBe('expensive');
      expect(report.scripts[0].avgDurationMs).toBe(45000);
      expect(report.suggestions[0].id).toBe('perf-multi-agent-gate');
    });

    it('insufficient 脚本：样本<3 不评估不建议', () => {
      const flows = [makeFlow({ script: 'init-workflow', status: 'DONE' })];
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].level).toBe('insufficient');
      expect(report.suggestions).toEqual([]);
    });

    it('多脚本按 total 降序排列', () => {
      const flows = [
        ...Array.from({ length: 5 }, () => makeFlow({ script: 'a', status: 'DONE' })),
        ...Array.from({ length: 3 }, () => makeFlow({ script: 'b', status: 'DONE' })),
      ];
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].script).toBe('a');
      expect(report.scripts[1].script).toBe('b');
    });

    it('全局成功率跨脚本聚合', () => {
      const flows = [
        ...Array.from({ length: 3 }, () => makeFlow({ script: 'a', status: 'DONE' })),
        ...Array.from({ length: 1 }, () => makeFlow({ script: 'b', status: 'FAILED', exitCode: 1 })),
      ];
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.totalInvocations).toBe(4);
      expect(report.overallSuccessRate).toBe(0.75);
    });

    it('lastInvoked 取最后一条记录的 startedAt', () => {
      const flows = [
        makeFlow({ script: 'a', status: 'DONE', startedAt: '2026-01-01T00:00:00.000Z' }),
        makeFlow({ script: 'a', status: 'DONE', startedAt: '2026-01-02T00:00:00.000Z' }),
      ];
      const report = analyzeSkillHealth(makeState(flows));
      expect(report.scripts[0].lastInvoked).toBe('2026-01-02T00:00:00.000Z');
    });
  });

  describe('formatHealthSummary', () => {
    it('空报告生成基本摘要', () => {
      const report = analyzeSkillHealth(makeState([]));
      const summary = formatHealthSummary(report);
      expect(summary).toContain('技能健康报告');
      expect(summary).toContain('总调用 0 次');
    });

    it('含建议的报告列出改进建议', () => {
      const flows = [
        ...Array.from({ length: 2 }, () => makeFlow({ script: 'eval-runner', status: 'DONE' })),
        ...Array.from({ length: 3 }, () => makeFlow({ script: 'eval-runner', status: 'FAILED', exitCode: 1 })),
      ];
      const report = analyzeSkillHealth(makeState(flows));
      const summary = formatHealthSummary(report);
      expect(summary).toContain('改进建议');
      expect(summary).toContain('eval-runner 成功率');
    });

    it('healthy 脚本用 ✅ 标记', () => {
      const flows = Array.from({ length: 5 }, () => makeFlow({ script: 'gate-check', status: 'DONE' }));
      const report = analyzeSkillHealth(makeState(flows));
      const summary = formatHealthSummary(report);
      expect(summary).toContain('✅');
      expect(summary).not.toContain('改进建议');
    });
  });
});
