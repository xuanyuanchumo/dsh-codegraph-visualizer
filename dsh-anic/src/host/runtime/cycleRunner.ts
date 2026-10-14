/**
 * Cycle 生命周期管理（F8，M2-a）。
 *
 * initCycle → 创建 .cycles/cycle-N/ 结构
 * advanceCycle → 状态机推进 + 账本追加
 * closeCycle → 最终门禁检查
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLedger, appendEntry, verifyLedger, type LedgerEntry } from './ledger.ts';
import { loadWorkflowGraph, loadState, initState, advance, checkStrict, type WorkflowGraph, type NodeState } from './stateMachine.ts';

export interface CycleInfo {
  cycleDir: string;
  cycleNumber: number;
  createdAt: string;
}

export interface AdvanceResult {
  ok: boolean;
  cycleNumber: number;
  nodeId: string;
  state: Record<string, NodeState>;
  ledgerEntry?: LedgerEntry;
  reason?: string;
}

/** 列出已有 cycle 目录（数值序）。 */
export function listCycles(cyclesDir: string): number[] {
  if (!existsSync(cyclesDir)) return [];
  const nums: number[] = [];
  for (const entry of readdirSync(cyclesDir)) {
    const m = entry.match(/^cycle-(\d+)$/);
    if (m?.[1]) nums.push(parseInt(m[1], 10));
  }
  return nums.sort((a, b) => a - b);
}

/** 取下一个 cycle 编号（max+1，不靠字典序）。 */
export function nextCycleNumber(cyclesDir: string): number {
  const nums = listCycles(cyclesDir);
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

/** 初始化新 cycle。 */
export function initCycle(cyclesDir: string, projectName?: string): CycleInfo {
  const n = nextCycleNumber(cyclesDir);
  const cycleDir = join(cyclesDir, `cycle-${n}`);
  const now = new Date().toISOString();

  // 创建标准子目录（不创建空目录的空目录——只创有内容的）
  for (const sub of ['test-reports', 'gates']) {
    mkdirSync(join(cycleDir, sub), { recursive: true });
  }

  // 写 cycle 元数据
  writeFileSync(
    join(cycleDir, 'cycle-meta.json'),
    JSON.stringify({ cycleNumber: n, projectName: projectName ?? 'unnamed', createdAt: now }, null, 2),
  );

  return { cycleDir, cycleNumber: n, createdAt: now };
}

/** 推进 cycle 节点（状态机 + 账本）。 */
export function advanceCycle(
  cyclesDir: string,
  cycleNumber: number,
  nodeId: string,
  record: { gateApproved?: boolean; gate?: string; gateName?: string; result?: 'PASS' | 'FAIL'; detail?: string },
): AdvanceResult {
  const graph = loadWorkflowGraph(cyclesDir);
  if (!graph) return { ok: false, cycleNumber, nodeId, state: {}, reason: 'no workflow-graph.yaml' };

  let state = loadState(cyclesDir);
  if (Object.keys(state).length === 0) state = initState(graph);

  const adv = advance(graph, state, nodeId, record);
  if (!adv.ok) return { ok: false, cycleNumber, nodeId, state: adv.state, reason: adv.reason };

  // 如果是 gate 节点且有 result，追加账本
  let ledgerEntry: LedgerEntry | undefined;
  if (record.gate && record.result) {
    ledgerEntry = appendEntry(cyclesDir, {
      gate: record.gate,
      gateName: record.gateName ?? record.gate,
      result: record.result,
      detail: record.detail ?? '',
    });
  }

  // 持久化状态
  writeFileSync(join(cyclesDir, 'workflow-state.json'), JSON.stringify({ nodeStatus: adv.state }, null, 2));

  return { ok: true, cycleNumber, nodeId, state: adv.state, ledgerEntry };
}

/** 关闭 cycle：严格门禁检查 + 账本验证。 */
export function closeCycle(cyclesDir: string, _cycleNumber: number): {
  ok: boolean;
  gatesPassed: boolean;
  ledgerValid: boolean;
  reason?: string;
} {
  const graph = loadWorkflowGraph(cyclesDir);
  if (!graph) return { ok: false, gatesPassed: false, ledgerValid: false, reason: 'no workflow-graph.yaml' };

  const state = loadState(cyclesDir);
  const check = checkStrict(graph, state);
  const verify = verifyLedger(cyclesDir);

  return {
    ok: check.ok && verify.ok,
    gatesPassed: check.ok,
    ledgerValid: verify.ok,
    reason: !check.ok ? check.reason : !verify.ok ? (verify.reason ?? undefined) : undefined,
  };
}
