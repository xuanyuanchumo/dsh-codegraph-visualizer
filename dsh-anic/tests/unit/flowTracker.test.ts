/**
 * FlowTracker 单元测试（M10-a 每流程状态跟踪）。
 *
 * 测试覆盖：
 * - 创建/推进/终态判定
 * - 持久化往返（save → load）
 * - 滚动淘汰（MAX_FLOWS=200）
 * - recentFlows 逆序 + limit
 * - activeFlows 过滤 RUNNING
 * - flowStats 分组统计
 * - 输出截断（stdout ≤8000, stderr ≤4000）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initialFlowTrackerState,
  loadFlowTracker,
  saveFlowTracker,
  startFlow,
  finishFlow,
  recentFlows,
  activeFlows,
  flowStats,
  type FlowTrackerState,
} from '../../src/host/runtime/flowTracker.ts';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'flow-tracker-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('FlowTracker — 基本生命周期', () => {
  it('startFlow 创建 RUNNING 记录并持久化', () => {
    const state = initialFlowTrackerState();
    const { state: s1, flowId } = startFlow(tempDir, state, 'eval-runner', '/ws', ['--dimensions', 'E1']);
    expect(flowId).toMatch(/^eval-runner-.+-1$/);
    expect(s1.flows).toHaveLength(1);
    expect(s1.flows[0].status).toBe('RUNNING');
    expect(s1.flows[0].script).toBe('eval-runner');
    expect(s1.flows[0].args).toEqual(['--dimensions', 'E1']);
    expect(s1.counter).toBe(1);

    // 持久化往返
    const loaded = loadFlowTracker(tempDir);
    expect(loaded.flows).toHaveLength(1);
    expect(loaded.flows[0].flowId).toBe(flowId);
  });

  it('finishFlow exitCode=0 → DONE', () => {
    const state = initialFlowTrackerState();
    const { state: s1, flowId } = startFlow(tempDir, state, 'gate-check', '/ws', []);
    const s2 = finishFlow(tempDir, s1, flowId, {
      exitCode: 0, timedOut: false, stdout: 'all gates passed', stderr: '', durationMs: 150,
    });
    const flow = s2.flows.find((f) => f.flowId === flowId)!;
    expect(flow.status).toBe('DONE');
    expect(flow.exitCode).toBe(0);
    expect(flow.durationMs).toBe(150);
    expect(flow.endedAt).toBeDefined();
  });

  it('finishFlow exitCode=1 → FAILED', () => {
    const { state: s1, flowId } = startFlow(tempDir, initialFlowTrackerState(), 'eval-runner', '/ws', []);
    const s2 = finishFlow(tempDir, s1, flowId, { exitCode: 1, timedOut: false, stdout: '', stderr: 'error', durationMs: 50 });
    expect(s2.flows[0].status).toBe('FAILED');
  });

  it('finishFlow timedOut=true → TIMEOUT', () => {
    const { state: s1, flowId } = startFlow(tempDir, initialFlowTrackerState(), 'eval-runner', '/ws', []);
    const s2 = finishFlow(tempDir, s1, flowId, { exitCode: null as unknown as number, timedOut: true, stdout: '', stderr: '', durationMs: 60000 });
    expect(s2.flows[0].status).toBe('TIMEOUT');
  });
});

describe('FlowTracker — 查询', () => {
  it('recentFlows 逆序返回最近 N 条', () => {
    let state = initialFlowTrackerState();
    for (let i = 0; i < 5; i++) {
      const { state: s } = startFlow(tempDir, state, 'eval-runner', '/ws', []);
      state = s;
    }
    const recent = recentFlows(state, 3);
    expect(recent).toHaveLength(3);
    // 逆序：最后创建的在前
    expect(recent[0].flowId).toContain('-5');
    expect(recent[2].flowId).toContain('-3');
  });

  it('activeFlows 只返回 RUNNING', () => {
    const { state: s1, flowId: id1 } = startFlow(tempDir, initialFlowTrackerState(), 'eval-runner', '/ws', []);
    const { state: s2, flowId: id2 } = startFlow(tempDir, s1, 'gate-check', '/ws', []);
    const s3 = finishFlow(tempDir, s2, id1, { exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 10 });
    expect(activeFlows(s3)).toHaveLength(1);
    expect(activeFlows(s3)[0].flowId).toBe(id2);
  });

  it('flowStats 按脚本分组', () => {
    let state = initialFlowTrackerState();
    const { state: s1, flowId: f1 } = startFlow(tempDir, state, 'eval-runner', '/ws', []);
    const { state: s2, flowId: f2 } = startFlow(tempDir, s1, 'eval-runner', '/ws', []);
    const { state: s3, flowId: f3 } = startFlow(tempDir, s2, 'gate-check', '/ws', []);
    const s4 = finishFlow(tempDir, s3, f1, { exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 10 });
    const s5 = finishFlow(tempDir, s4, f2, { exitCode: 1, timedOut: false, stdout: '', stderr: '', durationMs: 10 });
    const s6 = finishFlow(tempDir, s5, f3, { exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 10 });
    const stats = flowStats(s6);
    expect(stats['eval-runner']).toEqual({ total: 2, done: 1, failed: 1, timeout: 0 });
    expect(stats['gate-check']).toEqual({ total: 1, done: 1, failed: 0, timeout: 0 });
  });
});

describe('FlowTracker — 滚动淘汰', () => {
  it('超过 200 条时保留最近 200 条', () => {
    let state = initialFlowTrackerState();
    for (let i = 0; i < 205; i++) {
      const { state: s } = startFlow(tempDir, state, 'eval-runner', '/ws', []);
      state = s;
    }
    expect(state.flows).toHaveLength(200);
    // 保留的是最后 200 条（counter 6-205）
    expect(state.flows[0].flowId).toContain('-6');
    expect(state.flows[199].flowId).toContain('-205');
    expect(state.counter).toBe(205);
  });
});

describe('FlowTracker — 输出截断', () => {
  it('stdout 截断到 8000 字符', () => {
    const longStdout = 'x'.repeat(10000);
    const { state: s1, flowId } = startFlow(tempDir, initialFlowTrackerState(), 'eval-runner', '/ws', []);
    const s2 = finishFlow(tempDir, s1, flowId, { exitCode: 0, timedOut: false, stdout: longStdout, stderr: '', durationMs: 10 });
    expect(s2.flows[0].stdout).toHaveLength(8000);
  });

  it('stderr 截断到 4000 字符', () => {
    const longStderr = 'e'.repeat(5000);
    const { state: s1, flowId } = startFlow(tempDir, initialFlowTrackerState(), 'eval-runner', '/ws', []);
    const s2 = finishFlow(tempDir, s1, flowId, { exitCode: 1, timedOut: false, stdout: '', stderr: longStderr, durationMs: 10 });
    expect(s2.flows[0].stderr).toHaveLength(4000);
  });
});

describe('FlowTracker — 持久化健壮性', () => {
  it('文件不存在时返回空状态', () => {
    const loaded = loadFlowTracker(tempDir);
    expect(loaded.flows).toEqual([]);
    expect(loaded.counter).toBe(0);
  });

  it('损坏文件返回空状态', () => {
    saveFlowTracker(tempDir, initialFlowTrackerState());
    // 写入损坏 JSON
    writeFileSync(join(tempDir, 'flow-tracker.json'), '{ corrupt');
    const loaded = loadFlowTracker(tempDir);
    expect(loaded.flows).toEqual([]);
  });

  it('flowId 全局唯一（多次调用）', () => {
    let state = initialFlowTrackerState();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { state: s, flowId } = startFlow(tempDir, state, 'eval-runner', '/ws', []);
      state = s;
      ids.add(flowId);
    }
    expect(ids.size).toBe(100);
  });
});
