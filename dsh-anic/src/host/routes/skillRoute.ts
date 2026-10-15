/**
 * Skill invocation routes — generic skill script calling + cross-project evaluation.
 * M8: skill/invoke + skill/list + evaluate + iterate
 */

import path from 'node:path';
import type { SnapshotCtx } from '../snapshotRoute.ts';
import { type RouteReq, parseBody } from './routeContext.ts';
import { resolveWorkspaceRoots, sendJson } from '../snapshotRoute.ts';
import {
  isAllowedScript,
  listSkillScripts,
  resolveSkillScriptsDir,
  validateWorkspace,
  invokeSkillScript,
} from '../skillInvoker.ts';

type SendFn = (res: unknown, code: number, body: unknown, requestId?: string) => void;

/** 注册技能调用路由（list/invoke/evaluate/iterate）。 */
export function registerSkillRoutes(
  ctx: SnapshotCtx,
  send: SendFn,
): Array<(() => void) | null> {
  const ws = ctx.webServer;
  if (!ws?.register) return [];

  const reg = (method: string, p: string, handler: (req: RouteReq, res: unknown) => void) => {
    const d = ws.register!(method, p, handler as (req: unknown, res: unknown) => void);
    return typeof d === 'function' ? d : null;
  };

  return [
    // GET /anic/skill/list — list available skill scripts
    reg('GET', '/anic/skill/list', (_req, res) => {
      send(res, 200, { scripts: listSkillScripts() });
    }),

    // POST /anic/skill/invoke — invoke a skill script on a workspace
    reg('POST', '/anic/skill/invoke', (req, res) => {
      const body = parseBody(req);
      const script = typeof body.script === 'string' ? body.script : '';
      const args: string[] = Array.isArray(body.args) ? (body.args as string[]) : [];
      const workspace = typeof body.workspace === 'string' ? body.workspace : resolveWorkspaceRoots(ctx);
      const timeout = typeof body.timeout === 'number' && body.timeout > 0
        ? Math.min(body.timeout, 120000)
        : 30000;

      if (!script || !isAllowedScript(script)) {
        send(res, 400, { error: `Unknown script: ${script}. Allowed: ${listSkillScripts().join(', ')}` });
        return;
      }

      const wsCheck = validateWorkspace(workspace);
      if (!wsCheck.ok) {
        send(res, 400, { error: wsCheck.error });
        return;
      }

      const scriptsDir = resolveSkillScriptsDir(workspace);
      if (!scriptsDir) {
        send(res, 404, { error: 'skill scripts not found in workspace' });
        return;
      }

      const result = invokeSkillScript(scriptsDir, script, args, workspace, timeout);
      send(res, 200, {
        script: result.script,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      });
    }),

    // POST /anic/evaluate — cross-project evaluation
    reg('POST', '/anic/evaluate', (req, res) => {
      const body = parseBody(req);
      const workspace = typeof body.workspace === 'string' ? body.workspace : resolveWorkspaceRoots(ctx);
      const dimensions = typeof body.dimensions === 'string' ? body.dimensions : undefined;

      const wsCheck = validateWorkspace(workspace);
      if (!wsCheck.ok) { send(res, 400, { error: wsCheck.error }); return; }

      const scriptsDir = resolveSkillScriptsDir(workspace);
      if (!scriptsDir) { send(res, 404, { error: 'skill scripts not found' }); return; }

      const args = dimensions ? ['--dimensions', dimensions] : [];
      const result = invokeSkillScript(scriptsDir, 'eval-runner', args, workspace, 60000);

      send(res, 200, {
        workspace,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      });
    }),

    // POST /anic/iterate — cross-project iteration
    reg('POST', '/anic/iterate', (req, res) => {
      const body = parseBody(req);
      const workspace = typeof body.workspace === 'string' ? body.workspace : resolveWorkspaceRoots(ctx);

      const wsCheck = validateWorkspace(workspace);
      if (!wsCheck.ok) { send(res, 400, { error: wsCheck.error }); return; }

      const scriptsDir = resolveSkillScriptsDir(workspace);
      if (!scriptsDir) { send(res, 404, { error: 'skill scripts not found' }); return; }

      // Run eval + gate
      const evalResult = invokeSkillScript(scriptsDir, 'eval-runner', [], workspace, 60000);
      const gateResult = invokeSkillScript(
        scriptsDir, 'gate-check',
        ['--gate', 'all', '--quality', '--record'],
        workspace, 60000,
      );

      send(res, 200, {
        workspace,
        eval: {
          exitCode: evalResult.exitCode,
          stdout: evalResult.stdout.slice(0, 4000),
          timedOut: evalResult.timedOut,
        },
        gate: {
          exitCode: gateResult.exitCode,
          stdout: gateResult.stdout.slice(0, 4000),
          timedOut: gateResult.timedOut,
        },
      });
    }),
  ];
}
