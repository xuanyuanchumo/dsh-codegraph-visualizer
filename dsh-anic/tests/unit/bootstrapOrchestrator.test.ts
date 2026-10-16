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
} from '../../src/host/runtime/bootstrapOrchestrator.ts';
import {
  parseEvalScore,
  parseGateVerdict,
  parseFixApplied,
} from '../../src/host/runtime/scriptParsers.ts';
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

// ── 解析器：按真实脚本输出契约（cycle-96 重写）──
// 以下 fixture 逐行转录自 assets/skill/scripts/ 的真实 console 语句，
// 不是"代码期望什么就写什么"——旧测试正是这样断言了虚构格式才放行恒错解析器。

describe('parseEvalScore — eval-runner.mjs 真实输出', () => {
  it('全部通过（exit 0 路径，:498+:515）→ 1', () => {
    const stdout = [
      'Evaluation report written to D:\\ws\\.cycles\\cycles\\cycle-95\\项目评估报告.md',
      '',
      'All 8 evaluated dimension(s) passed.',
    ].join('\n');
    expect(parseEvalScore({ stdout, stderr: '' })).toBe(1);
  });

  it('全部通过但带 SKIP 行（:515+:517）→ 1（已评估维度全过）', () => {
    const stdout = [
      'All 5 evaluated dimension(s) passed.',
      '3 dimension(s) SKIPPED (not evaluated, NOT pass): E5, E6, E7',
    ].join('\n');
    expect(parseEvalScore({ stdout, stderr: '' })).toBe(1);
  });

  it('全 SKIP 的空洞运行（"All 0 evaluated … passed."）→ 1，与脚本退出码语义一致', () => {
    // 脚本对全 SKIP 判 exit 0（失败只由 FAIL 决定，eval-runner.mjs:504-506）；
    // 解析器忠实转录脚本裁决，SKIP 的响亮清单已在 stdout，不由分数承担。
    expect(parseEvalScore({ stdout: 'All 0 evaluated dimension(s) passed.', stderr: '' })).toBe(1);
  });

  it('有失败维度（失败清单在 stderr，:509）→ 0', () => {
    const stdout = 'Evaluation report written to D:\\ws\\.cycles\\cycles\\cycle-95\\项目评估报告.md';
    const stderr = '\n3 dimension(s) failed: E3, E8, Q8';
    expect(parseEvalScore({ stdout, stderr })).toBe(0);
  });

  it('失败清单只看 stderr：stdout 同文本不误判（契约就是 stderr 行）', () => {
    // 防倒退：如果把解析改回只喂 stdout，此用例红——失败证据在 stderr，
    // 这正是旧调用 parseEvalScore(result.stdout) 丢裁决的机制。
    expect(parseEvalScore({ stdout: '3 dimension(s) failed: E3', stderr: '' })).toBe(0);
    expect(parseEvalScore({ stdout: '', stderr: '2 dimension(s) failed: E3, Q8' })).toBe(0);
  });

  it('旧虚构格式 "Overall score: 0.875" 不再匹配 → 0', () => {
    // 防倒退：真实脚本从不输出该行；旧解析器正是按它写的
    expect(parseEvalScore({ stdout: 'Overall score: 0.875', stderr: '' })).toBe(0);
  });

  it('输出不可识别 → 0', () => {
    expect(parseEvalScore({ stdout: 'no recognizable output', stderr: '' })).toBe(0);
  });
});

describe('parseGateVerdict — gate-check.mjs 真实输出', () => {
  it('全部通过（逐门禁行 + :228 总裁决行）→ PASS', () => {
    const stdout = [
      '[PASS] G0: Evaluation report found in cycle-95 (16 dimension rows)',
      '  [LEDGER] G0 PASS recorded (hash c9d448ba8ed100ea...)',
      '[PASS] G1: All 12 tasks completed',
      '  [PASS] G0-Quality: x',
      '',
      'All gates PASSED.',
    ].join('\n');
    expect(parseGateVerdict({ stdout, stderr: '' })).toBe('PASS');
  });

  it('有门禁失败（[FAIL] 行 + :225 stderr 总裁决行）→ FAIL', () => {
    const stdout = [
      '[PASS] G0: Evaluation report found in cycle-95 (16 dimension rows)',
      '[FAIL] G1: 2 of 5 tasks not completed',
      '  [LEDGER] G1 FAIL recorded (hash 1a2b3c4d5e6f7890...)',
    ].join('\n');
    const stderr = '\nGate check FAILED. Fix issues before proceeding.';
    expect(parseGateVerdict({ stdout, stderr })).toBe('FAIL');
  });

  it('质量门禁失败也判 FAIL（:219 缩进行 + :220 拉低总裁决）', () => {
    const stdout = [
      '[PASS] G0: Evaluation report found in cycle-95 (16 dimension rows)',
      '  [FAIL] G0-Quality: SKIP dimensions present',
    ].join('\n');
    expect(parseGateVerdict({ stdout, stderr: '' })).toBe('FAIL');
  });

  it('部分门禁运行（--gate G1，无总裁决行）→ 逐门禁行兜底', () => {
    expect(parseGateVerdict({ stdout: '[PASS] G1: All 5 tasks completed', stderr: '' })).toBe('PASS');
    expect(parseGateVerdict({ stdout: '[FAIL] G1: No task list', stderr: '' })).toBe('FAIL');
  });

  it('LEDGER 行不参与裁决（前缀是 [LEDGER] 非 [PASS]/[FAIL]）', () => {
    const stdout = '  [LEDGER] G0 unchanged, not re-recorded';
    expect(parseGateVerdict({ stdout, stderr: '' })).toBe('unknown');
  });

  it('旧虚构格式 "GATE: PASS" 不再匹配 → unknown', () => {
    expect(parseGateVerdict({ stdout: 'GATE: PASS', stderr: '' })).toBe('unknown');
    expect(parseGateVerdict({ stdout: 'Overall: FAIL', stderr: '' })).toBe('unknown');
  });

  it('输出不可识别 → unknown', () => {
    expect(parseGateVerdict({ stdout: '', stderr: '' })).toBe('unknown');
  });
});

describe('parseFixApplied — auto-fix-loop.mjs 真实输出', () => {
  it('无需修复（:244）→ null', () => {
    const stdout = [
      '=== Auto-Fix Loop ===',
      'Project: D:\\ws',
      'Cycle: cycle-95',
      'Test command: pnpm run test',
      'Max retries: 3',
      '',
      '--- Attempt 1/3 ---',
      'Running test command: pnpm run test',
      'All tests passed. No fixes needed.',
    ].join('\n');
    expect(parseFixApplied({ stdout, stderr: '' })).toBeNull();
  });

  it('修复成功（:251-253 清单 + :274 验证行）→ 带失败清单的描述', () => {
    const stdout = [
      '--- Attempt 1/3 ---',
      'Running test command: pnpm run test',
      'Identified 2 failure(s):',
      '  - typecheck: 6 failures, 0 errors',
      '  - lint: 2 failures, 0 errors',
      'AI should diagnose root cause and apply fix...',
      '  (In L4 autonomous mode, AI will analyze failures and modify code/tests)',
      '  Re-running verification after fix...',
      'Fix successful. All tests now pass.',
    ].join('\n');
    expect(parseFixApplied({ stdout, stderr: '' })).toBe(
      '修复并通过: typecheck: 6 failures, 0 errors; lint: 2 failures, 0 errors',
    );
  });

  it('多次尝试取最后一次 Identified 清单（前面尝试的失败可能已被修复）', () => {
    const stdout = [
      '--- Attempt 1/3 ---',
      'Identified 1 failure(s):',
      '  - typecheck: 6 failures, 0 errors',
      'Fix attempt 1 failed. 1 failure(s) remain.',
      '--- Attempt 2/3 ---',
      'Identified 1 failure(s):',
      '  - lint: 2 failures, 0 errors',
      '  Re-running verification after fix...',
      'Fix successful. All tests now pass.',
    ].join('\n');
    expect(parseFixApplied({ stdout, stderr: '' })).toBe('修复并通过: lint: 2 failures, 0 errors');
  });

  it('修复成功但无清单（防御路径）→ 字面裁决行', () => {
    expect(parseFixApplied({ stdout: 'Fix successful. All tests now pass.', stderr: '' }))
      .toBe('Fix successful. All tests now pass.');
  });

  it('修复未通过（:280）→ null', () => {
    const stdout = [
      '--- Attempt 3/3 ---',
      'Identified 1 failure(s):',
      '  - typecheck: 6 failures, 0 errors',
      'Fix attempt 3 failed. 1 failure(s) remain.',
      '=== Phase: Failure Pattern Analysis & Root Cause Assessment ===',
    ].join('\n');
    expect(parseFixApplied({ stdout, stderr: '' })).toBeNull();
  });

  it('旧虚构格式 "Applied: fix-typecheck" 不再匹配 → null', () => {
    expect(parseFixApplied({ stdout: 'Applied: fix-typecheck', stderr: '' })).toBeNull();
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
    // cycle-96：真实裁决断言。临时工作区没有 config.yml → gate-check 在
    // 入口校验即死（gate-check.mjs:31-32 的 config 缺失错误，非门禁裁决），
    // 输出无可识别裁决行 → 'unknown' 是解析器对"脚本未走到裁决"的忠实报告
    // （调用方 advanceBootstrap 把 unknown 当未通过，不会误判 CONVERGED——
    // 这是 fail-closed：宁可重跑，不可把"没跑成"当"通过"）。
    // 有配置+cycle 目录时脚本输出 [FAIL] G0.. 行 + stderr 总裁决 → 'FAIL'
    // （该路径由上方 parseGateVerdict 真实输出用例覆盖）。
    expect(result.rounds[0].evalScore).toBe(0);
    expect(result.rounds[0].gateVerdict).toBe('unknown');
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
