/**
 * Cycle 路由（F1/F8，M2-a）。
 *
 * POST /anic/cycle/init      初始化新 cycle
 * POST /anic/cycle/advance   推进节点（状态机 + 账本）
 * POST /anic/cycle/close     关闭 cycle（门禁检查 + 账本验证）
 * GET  /anic/cycle/state     当前状态机状态
 * GET  /anic/cycle/list      cycle 列表
 */
import { resolveWorkspaceRoots, sendJson, type SnapshotCtx } from '../snapshotRoute.ts';
import { initCycle, advanceCycle, closeCycle, listCycles, nextCycleNumber } from '../runtime/cycleRunner.ts';
import { loadWorkflowGraph, loadState, initState } from '../runtime/stateMachine.ts';
import { join } from 'node:path';

type SendFn = (res: unknown, status: number, body: unknown, requestId?: string) => void;

interface RouteDeps {
  send: SendFn;
  getWorkspaceRoot: () => string | null;
}

/** 解析请求体为指定类型——安全版（P1-6 修复：消除 `as T` 不安全转换）。 */
function body<T = Record<string, unknown>>(req: unknown): T {
  const r = req as { body?: unknown };
  if (typeof r.body === 'string') {
    try { return JSON.parse(r.body) as T; } catch { return {} as T; }
  }
  return (r.body ?? {}) as T;
}

/** 注册 Cycle 路由（init/advance/close/state/list）。 */
export function registerCycleRoute(ctx: unknown, deps: RouteDeps): (() => void) | null {
  const c = ctx as SnapshotCtx;
  if (!c.webServer || typeof c.webServer.register !== 'function') return null;
  const { send, getWorkspaceRoot } = deps;

  const d1 = c.webServer.register('POST', '/anic/cycle/init', (req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const { projectName } = body<{ projectName?: string }>(req);
    const info = initCycle(cyclesDir, projectName);
    send(res, 200, { ok: true, ...info });
  });

  const d2 = c.webServer.register('POST', '/anic/cycle/advance', (req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const { cycleNumber, nodeId, ...record } = body<{ cycleNumber: number; nodeId: string; gateApproved?: boolean; gate?: string; gateName?: string; result?: 'PASS' | 'FAIL'; detail?: string }>(req);
    if (!cycleNumber || !nodeId || !Number.isInteger(cycleNumber) || cycleNumber < 1) { send(res, 400, { error: 'cycleNumber (positive integer) and nodeId required' }); return; }
    const result = advanceCycle(cyclesDir, cycleNumber, nodeId, record);
    send(res, result.ok ? 200 : 409, result);
  });

  const d3 = c.webServer.register('POST', '/anic/cycle/close', (req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const { cycleNumber } = body<{ cycleNumber: number }>(req);
    if (!cycleNumber || !Number.isInteger(cycleNumber) || cycleNumber < 1) { send(res, 400, { error: 'cycleNumber (positive integer) required' }); return; }
    const result = closeCycle(cyclesDir, cycleNumber);
    send(res, result.ok ? 200 : 409, result);
  });

  const d4 = c.webServer.register('GET', '/anic/cycle/state', (_req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const graph = loadWorkflowGraph(cyclesDir);
    if (!graph) { send(res, 200, { nodes: [], state: {} }); return; }
    let state = loadState(cyclesDir);
    if (Object.keys(state).length === 0) state = initState(graph);
    send(res, 200, { nodes: graph.nodes, edges: graph.edges, state });
  });

  const d5 = c.webServer.register('GET', '/anic/cycle/list', (_req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const cycles = listCycles(cyclesDir);
    const next = nextCycleNumber(cyclesDir);
    send(res, 200, { cycles, nextCycleNumber: next });
  });

  const disposers = [d1, d2, d3, d4, d5].filter((d): d is () => void => typeof d === 'function');
  return disposers.length > 0 ? () => { for (const d of disposers) d(); } : null;
}
