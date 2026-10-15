/**
 * W StepTrace HTTP 面：GET /anic/api/step-trace。
 * 服务端组装四源投影（客户端拿不到文件句柄，这是白盒透明化的数据面）：
 * snapshot（结构化声明图）+ workflow-state.json nodeStatus + ledger 裁决 + cycle 目录。
 * 纯读；404 当无 .cycles；INV-27 启发标注原样透传给客户端渲染。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkflowSnapshot } from '../../shared/snapshotCore.ts';
import { buildStepTrace } from '../../shared/stepTrace.ts';
import { sendJson, resolveWorkspaceRoots, type SnapshotCtx } from '../snapshotRoute.ts';

export const STEP_TRACE_ROUTE = '/anic/api/step-trace';

/** 注册步骤追踪路由（GET /anic/api/step-trace）。 */
export function registerStepTraceRoute(ctx: unknown): (() => void) | null {
  const c = ctx as SnapshotCtx;
  const webServer = c.webServer;
  if (!webServer || typeof webServer.register !== 'function') return null;
  const disposer = webServer.register({
    kind: 'exact',
    path: STEP_TRACE_ROUTE,
    handler: (_req: unknown, res: unknown) => {
      try {
        const root = resolveWorkspaceRoots(c);
        const cyclesDir = join(root, '.cycles');
        if (!existsSync(cyclesDir)) {
          sendJson(res, 404, { error: 'no .cycles in current workspace', workspace: root });
          return;
        }
        const snap = buildWorkflowSnapshot(cyclesDir);
        const trace = buildStepTrace(snap, { cyclesDir });
        sendJson(res, 200, trace);
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  });
  return typeof disposer === 'function' ? disposer : null;
}
