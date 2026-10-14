/**
 * 热更新路由：GET /anic/api/workflow-snapshot —— 每次请求**现场**读当前工作区的
 * `.cycles/`（与嵌入快照共用同一个构建器 src/shared/snapshotCore.ts），客户端据此实现
 * 数据热更新（无需重装插件/重启宿主）。
 *
 * 契约转录来源（结构，按 CLAUDE.md「fixtures 只做真实契约的结构转录」纪律）：
 * - 工作区解析：src/host/prerequisites.ts:86-134（registry → sessions.header.cwd → cwd，
 *   逐请求重解析、不断言快照——能力快照是一发定终身的缺陷放大器）；
 *   workspaceRegistry 用 ctx.get(name) 探测（gen2-only 可选服务，存在才用）；
 * - 路由注册：src/host/routes/statusRoutes.ts:11-25 —— ctx.effect(() =>
 *   ctx.webServer.register({kind:'exact', path, handler}))，effect 返回值即清理。
 *
 * 安全面：只读；路径来自宿主服务（registry/sessions），绝不来自用户输入
 * （与 M0-③ 结论一致：白名单只来自宿主）；响应带 no-store（数据即最新）与 CORS
 * （桌面/远程 UI 跨源可见，父工程 buildCorsHeaders 同因）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildWorkflowSnapshot } from '../shared/snapshotCore.ts';

export const SNAPSHOT_ROUTE = '/anic/api/workflow-snapshot';

interface WorkspaceEntry { path?: string }
interface SessionEntry { header?: { cwd?: string } }

/** 快照路由所需的宿主面窄化形状（导出供 routes/* 复用同一窄化，不各自发明）。 */
export interface SnapshotCtx {
  effect?: (fn: () => unknown, label?: string) => unknown;
  workspaceRegistry?: { list?(): WorkspaceEntry[] };
  sessions?: { list?(): SessionEntry[] };
  webServer?: {
    register(def: {
      kind: 'exact' | 'prefix';
      path: string;
      handler: (req: unknown, res: unknown) => void;
    }): (() => void) | void;
  };
}

/** 工作区根解析（registry → sessions → cwd；逐请求调用）。转录自父 prerequisites.ts。
 * 导出供 routes/index.ts 复用（工作区解析全插件唯一实现，C 域一致性）。 */
export function resolveWorkspaceRoots(ctx: SnapshotCtx): string {
  try {
    const wsr = ctx.workspaceRegistry;
    if (wsr?.list) {
      const first = wsr.list().find((w) => !!w.path);
      if (first?.path) return first.path;
    }
  } catch { /* registry 缺失/未挂载 → 下一来源 */ }
  try {
    const sessions = ctx.sessions;
    if (sessions?.list) {
      const first = sessions.list().find((s) => !!s.header?.cwd);
      if (first?.header?.cwd) return first.header.cwd;
    }
  } catch { /* sessions 缺失 → cwd */ }
  return process.cwd();
}

/** JSON 响应（no-store + CORS）。导出供其余路由复用（头语义全插件唯一实现）。 */
export function sendJson(res: unknown, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const r = res as { writeHead?: (code: number, headers: Record<string, string>) => void; end?: (data?: string) => void };
  if (typeof r.writeHead !== 'function' || typeof r.end !== 'function') return;
  const payload = JSON.stringify(body);
  r.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  });
  r.end(payload);
}

/**
 * 注册路由。返回 webServer.register 的 disposer（由 ctx.effect 承接做插件级清理；
 * disposer 不丢弃是九条红线之一）。宿主无 webServer 时静默跳过（telemetry skipped）
 * —— 插件主体（客户端标签）仍可用嵌入快照。
 */
export function registerSnapshotRoute(ctx: unknown): (() => void) | null {
  const snapshotCtx = ctx as SnapshotCtx;
  const webServer = snapshotCtx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    return null;
  }
  const disposer = webServer.register({
    kind: 'exact',
    path: SNAPSHOT_ROUTE,
    handler: (req, res) => {
      try {
        const root = resolveWorkspaceRoots(snapshotCtx);
        const cyclesDir = join(root, '.cycles');
        if (!existsSync(cyclesDir)) {
          sendJson(res, 404, { error: 'no .cycles in current workspace', workspace: root });
          return;
        }
        const snap = buildWorkflowSnapshot(cyclesDir);
        // 内容指纹：客户端可用作"数据是否变了"的廉价判据（展示用，不做条件请求语义）
        const digest = createHash('sha256').update(JSON.stringify({ n: snap.nodes, e: snap.edges })).digest('hex').slice(0, 16);
        sendJson(res, 200, snap, { 'X-ANIC-Snapshot-Digest': digest, 'X-ANIC-Workspace': encodeURIComponent(root) });
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  });
  return typeof disposer === 'function' ? disposer : null;
}
