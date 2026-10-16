/**
 * M10-b 自举链编排器：连通 eval-runner → gate-check → auto-fix-loop 自动驱动链。
 *
 * 此前 selfBootstrap.ts 只是被动状态机（记录转移但不驱动脚本）。
 * 本模块实现主动编排：每轮自动调用 eval → gate → fix，直到 CONVERGED 或 EXHAUSTED。
 * 每步通过 FlowTracker 记录，供 anic_status 查询和大模型审计。
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { invokeSkillScript, resolveSkillScriptsDir } from '../skillInvoker.ts';
import {
  type BootstrapState,
  initialBootstrapState,
  loadBootstrapState,
  saveBootstrapState,
  advanceBootstrap,
} from '../selfBootstrap.ts';
import {
  type FlowTrackerState,
  loadFlowTracker,
  startFlow,
  finishFlow,
} from './flowTracker.ts';
// cycle-96：解析器移至 scriptParsers.ts 单一实现（旧版按虚构格式解析，恒 0/'unknown'/null）
import {
  parseEvalScore,
  parseGateVerdict,
  parseFixApplied,
} from './scriptParsers.ts';

export interface BootstrapCycleResult {
  state: BootstrapState;
  rounds: Array<{
    round: number;
    evalScore: number;
    gateVerdict: string;
    fixApplied: string | null;
    evalFlowId?: string;
    gateFlowId?: string;
    fixFlowId?: string;
  }>;
  converged: boolean;
}

/**
 * 运行完整自举循环：eval → gate → (fix if fail) → repeat。
 *
 * @param workspace 工作区路径
 * @param maxRounds 最大轮次（默认 3）
 * @param timeoutMs 每步超时（默认 60s）
 * @returns 最终状态 + 每轮详情 + 是否收敛
 */
export function runSelfBootstrapCycle(
  workspace: string,
  maxRounds = 3,
  timeoutMs = 60000,
): BootstrapCycleResult {
  const cyclesDir = join(workspace, '.cycles');
  if (!existsSync(cyclesDir)) mkdirSync(cyclesDir, { recursive: true });
  const scriptsDir = resolveSkillScriptsDir(workspace);

  let state = loadBootstrapState(cyclesDir);
  if (state.status === 'CONVERGED' || state.status === 'EXHAUSTED') {
    state = initialBootstrapState(maxRounds);
  }
  state = { ...state, maxRounds };

  let trackerState = loadFlowTracker(cyclesDir);
  const rounds: BootstrapCycleResult['rounds'] = [];

  while (state.round < state.maxRounds && state.status !== 'CONVERGED') {
    // ── 步骤 1：eval-runner ──
    let evalScore = 0;
    let evalFlowId: string | undefined;
    if (scriptsDir) {
      const { state: s, flowId } = startFlow(cyclesDir, trackerState, 'eval-runner', workspace, []);
      trackerState = s;
      evalFlowId = flowId;
      const evalResult = invokeSkillScript(scriptsDir, 'eval-runner', [], workspace, timeoutMs);
      trackerState = finishFlow(cyclesDir, trackerState, flowId, evalResult);
      // cycle-96：传入完整结果（失败清单在 stderr，只喂 stdout 会丢失裁决证据）
      evalScore = parseEvalScore(evalResult);
    }

    // ── 步骤 2：gate-check ──
    let gateVerdict = 'unknown';
    let gateFlowId: string | undefined;
    if (scriptsDir) {
      const { state: s, flowId } = startFlow(cyclesDir, trackerState, 'gate-check', workspace, ['--gate', 'all', '--quality', '--record']);
      trackerState = s;
      gateFlowId = flowId;
      const gateResult = invokeSkillScript(
        scriptsDir, 'gate-check',
        ['--gate', 'all', '--quality', '--record'],
        workspace, timeoutMs,
      );
      trackerState = finishFlow(cyclesDir, trackerState, flowId, gateResult);
      // cycle-96：同上——FAILED 总裁决行在 stderr（gate-check.mjs:225）
      gateVerdict = parseGateVerdict(gateResult);
    }

    // ── 步骤 3：fix（仅当门禁未通过）──
    let fixApplied: string | null = null;
    let fixFlowId: string | undefined;
    const gatePassed = gateVerdict === 'PASS' || gateVerdict === 'approve';
    if (!gatePassed && scriptsDir) {
      const { state: s, flowId } = startFlow(cyclesDir, trackerState, 'auto-fix-loop', workspace, []);
      trackerState = s;
      fixFlowId = flowId;
      const fixResult = invokeSkillScript(scriptsDir, 'auto-fix-loop', [], workspace, timeoutMs);
      trackerState = finishFlow(cyclesDir, trackerState, flowId, fixResult);
      fixApplied = parseFixApplied(fixResult);
    }

    // ── 推进状态机 ──
    state = advanceBootstrap(state, evalScore, gateVerdict, fixApplied);
    saveBootstrapState(cyclesDir, state);

    rounds.push({
      round: state.round,
      evalScore,
      gateVerdict,
      fixApplied,
      evalFlowId,
      gateFlowId,
      fixFlowId,
    });
  }

  return {
    state,
    rounds,
    converged: state.status === 'CONVERGED',
  };
}
