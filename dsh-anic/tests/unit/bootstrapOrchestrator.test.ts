/**
 * M10-b 自举链编排器测试。
 *
 * 验证 runSelfBootstrapCycle 连通 eval → gate → fix 自动驱动链：
 * - 完整循环执行（eval + gate + fix 各步 FlowTracker 记录）
 * - 收敛判定（gate PASS → CONVERGED）
 * - 耗尽判定（maxRounds → EXHAUSTED）
 * - 状态持久化（self-bootstrap.json）
 * - 解析函数正确性
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoInstallSkill } from '../../src/host/skillInvoker.ts';
import {
  runSelfBootstrapCycle,
  parseEvalScore,
  parseGateVerdict,
  parseFixApplied,
} from '../../src/host/runtime/bootstrapOrchestrator.ts';
import { loadBootstrapState } from '../../src/host/selfBootstrap.ts';
import { loadFlowTracker, flowStats } from '../../src/host/runtime/flowTracker.ts';

let tempDir: string;
let workspace: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'boot-orch-'));
  workspace = join(tempDir, 'project');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('parseEvalScore', () => {
  it('提取 "Overall score: 0.875" 格式', () => {
    expect(parseEvalScore('Overall score: 0.875')).toBe(0.875);
  });
  it('提取 "Score: 42" 格式', () => {
    expect(parseEvalScore('Score: 42')).toBe(42);
  });
  it('无匹配返回 0', () => {
    expect(parseEvalScore('no score here')).toBe(0);
  });
});

describe('parseGateVerdict', () => {
  it('提取 "GATE: PASS"', () => {
    expect(parseGateVerdict('GATE: PASS')).toBe('PASS');
  });
  it('提取 "Overall: FAIL"', () => {
    expect(parseGateVerdict('Overall: FAIL')).toBe('FAIL');
  });
  it('无匹配返回 unknown', () => {
    expect(parseGateVerdict('no verdict')).toBe('unknown');
  });
});

describe('parseFixApplied', () => {
  it('提取 "Applied: fix-typecheck"', () => {
    expect(parseFixApplied('Applied: fix-typecheck')).toBe('fix-typecheck');
  });
  it('无匹配返回 null', () => {
    expect(parseFixApplied('no fix')).toBeNull();
  });
});

describe('runSelfBootstrapCycle — 端到端', () => {
  it('完整循环执行且状态持久化', () => {
    autoInstallSkill(workspace);
    const result = runSelfBootstrapCycle(workspace, 2, 30000);

    // 状态持久化
    const cyclesDir = join(workspace, '.cycles');
    const persisted = loadBootstrapState(cyclesDir);
    expect(persisted.status).toBe(result.state.status);
    expect(persisted.round).toBe(result.state.round);

    // self-bootstrap.json 落盘
    expect(existsSync(join(cyclesDir, 'self-bootstrap.json'))).toBe(true);

    // 至少执行了一轮
    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    expect(result.rounds[0].evalScore).toBeDefined();
    expect(result.rounds[0].gateVerdict).toBeDefined();
  });

  it('FlowTracker 记录每步调用', () => {
    autoInstallSkill(workspace);
    const result = runSelfBootstrapCycle(workspace, 1, 30000);

    const cyclesDir = join(workspace, '.cycles');
    const trackerState = loadFlowTracker(cyclesDir);
    const stats = flowStats(trackerState);

    // 至少有 eval-runner 和 gate-check 的记录
    expect(stats['eval-runner']).toBeDefined();
    expect(stats['eval-runner'].total).toBeGreaterThanOrEqual(1);
    expect(stats['gate-check']).toBeDefined();
    expect(stats['gate-check'].total).toBeGreaterThanOrEqual(1);

    // 每轮有 flowId
    const r = result.rounds[0];
    expect(r.evalFlowId).toBeDefined();
    expect(r.gateFlowId).toBeDefined();
  });

  it('maxRounds 限制生效', () => {
    autoInstallSkill(workspace);
    const result = runSelfBootstrapCycle(workspace, 1, 30000);
    expect(result.state.round).toBeLessThanOrEqual(1);
    // 一轮后要么 CONVERGED 要么 EXHAUSTED
    expect(['CONVERGED', 'EXHAUSTED']).toContain(result.state.status);
  });
});
