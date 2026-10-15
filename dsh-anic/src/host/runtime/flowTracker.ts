/**
 * 每流程状态跟踪器（M10-a）。
 *
 * 每次 anic_skill 调用创建一个独立 FlowRecord，跟踪
 * INVOKING → RUNNING → DONE/FAILED/TIMEOUT。
 *
 * 持久化到 {cyclesDir}/flow-tracker.json，容量上限 200 条（滚动淘汰）。
 * 为大模型自举和开发人员查阅管理提供可观测性层。
 *
 * 设计约束：
 * - 零外部依赖（仅 node:fs + node:path + ../shared/fs-safe.ts）
 * - 原子写入（atomicWriteFileSync）
 * - 线程安全（单进程同步写入，无并发竞争）
 * - 输出截断（stdout ≤8000, stderr ≤4000）防超大持久化文件
 */
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { atomicWriteFileSync, safeReadFileSync } from '../../shared/fs-safe.ts';

export type FlowStatus = 'INVOKING' | 'RUNNING' | 'DONE' | 'FAILED' | 'TIMEOUT';

export interface FlowRecord {
  /** 唯一标识：`${script}-${isoTimestamp}-${counter}` */
  flowId: string;
  /** 白名单脚本名 */
  script: string;
  /** 工作区路径 */
  workspace: string;
  /** 调用参数 */
  args: string[];
  /** 当前状态 */
  status: FlowStatus;
  /** ISO 开始时间戳 */
  startedAt: string;
  /** ISO 结束时间戳 */
  endedAt?: string;
  /** 退出码 */
  exitCode?: number;
  /** 截断 stdout（≤8000 字符） */
  stdout?: string;
  /** 截断 stderr（≤4000 字符） */
  stderr?: string;
  /** 耗时毫秒 */
  durationMs?: number;
}

export interface FlowTrackerState {
  flows: FlowRecord[];
  /** 单调递增计数器，用于 flowId 唯一性 */
  counter: number;
}

const TRACKER_FILE = 'flow-tracker.json';
const MAX_FLOWS = 200;
const STDOUT_MAX = 8000;
const STDERR_MAX = 4000;

/** 空状态。 */
export function initialFlowTrackerState(): FlowTrackerState {
  return { flows: [], counter: 0 };
}

/** 从磁盘加载状态。文件不存在或损坏时返回空状态。 */
export function loadFlowTracker(cyclesDir: string): FlowTrackerState {
  const file = join(cyclesDir, TRACKER_FILE);
  const raw = safeReadFileSync(file);
  if (!raw) return initialFlowTrackerState();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.flows) && typeof parsed.counter === 'number') {
      return parsed as FlowTrackerState;
    }
  } catch { /* corrupt → reset */ }
  return initialFlowTrackerState();
}

/** 持久化状态到磁盘（原子写入）。 */
export function saveFlowTracker(cyclesDir: string, state: FlowTrackerState): void {
  if (!existsSync(cyclesDir)) mkdirSync(cyclesDir, { recursive: true });
  const file = join(cyclesDir, TRACKER_FILE);
  atomicWriteFileSync(file, JSON.stringify(state, null, 2));
}

/** 滚动淘汰：超出 MAX_FLOWS 时保留最近 MAX_FLOWS 条。 */
function trimFlows(flows: FlowRecord[]): FlowRecord[] {
  if (flows.length <= MAX_FLOWS) return flows;
  return flows.slice(flows.length - MAX_FLOWS);
}

/** 创建新流程记录（INVOKING 状态）并持久化。 */
export function startFlow(
  cyclesDir: string,
  state: FlowTrackerState,
  script: string,
  workspace: string,
  args: string[],
): { state: FlowTrackerState; flowId: string } {
  const counter = state.counter + 1;
  const now = new Date().toISOString();
  const flowId = `${script}-${now}-${counter}`;
  const record: FlowRecord = {
    flowId,
    script,
    workspace,
    args,
    status: 'RUNNING',
    startedAt: now,
  };
  const newState: FlowTrackerState = {
    flows: trimFlows([...state.flows, record]),
    counter,
  };
  saveFlowTracker(cyclesDir, newState);
  return { state: newState, flowId };
}

/** 完成流程记录（设置终态 + 输出 + 耗时）并持久化。 */
export function finishFlow(
  cyclesDir: string,
  state: FlowTrackerState,
  flowId: string,
  result: {
    exitCode: number;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
  },
): FlowTrackerState {
  const status: FlowStatus = result.timedOut ? 'TIMEOUT' : result.exitCode === 0 ? 'DONE' : 'FAILED';
  const now = new Date().toISOString();
  const flows = state.flows.map((f) => {
    if (f.flowId !== flowId) return f;
    return {
      ...f,
      status,
      endedAt: now,
      exitCode: result.exitCode,
      stdout: result.stdout.slice(0, STDOUT_MAX),
      stderr: result.stderr.slice(0, STDERR_MAX),
      durationMs: result.durationMs,
    };
  });
  const newState: FlowTrackerState = { flows, counter: state.counter };
  saveFlowTracker(cyclesDir, newState);
  return newState;
}

/** 查询最近 N 条流程记录（默认 20）。 */
export function recentFlows(state: FlowTrackerState, limit = 20): FlowRecord[] {
  return state.flows.slice(-limit).reverse();
}

/** 查询活跃流程（status=RUNNING）。 */
export function activeFlows(state: FlowTrackerState): FlowRecord[] {
  return state.flows.filter((f) => f.status === 'RUNNING');
}

/** 统计：按脚本分组计数 + 成功率。 */
export function flowStats(state: FlowTrackerState): Record<string, { total: number; done: number; failed: number; timeout: number }> {
  const stats: Record<string, { total: number; done: number; failed: number; timeout: number }> = {};
  for (const f of state.flows) {
    let s = stats[f.script];
    if (!s) { s = { total: 0, done: 0, failed: 0, timeout: 0 }; stats[f.script] = s; }
    s.total++;
    if (f.status === 'DONE') s.done++;
    else if (f.status === 'FAILED') s.failed++;
    else if (f.status === 'TIMEOUT') s.timeout++;
  }
  return stats;
}
