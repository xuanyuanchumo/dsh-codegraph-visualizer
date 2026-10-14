/**
 * Skill invocation routes — generic skill script calling + cross-project evaluation.
 * M8: skill/invoke + skill/list + evaluate + iterate
 */

import path from 'node:path';
import type { SnapshotCtx } from '../snapshotRoute.ts';
import { resolveWorkspaceRoots, sendJson } from '../snapshotRoute.ts';
import {
  isAllowedScript,
  listSkillScripts,
  resolveSkillScriptsDir,
  validateWorkspace,
  invokeSkillScript,
} from '../skillInvoker.ts';

type SendFn = (res: any, code: number, body: unknown, requestId?: string) => void;

export function registerSkillRoutes(
  ctx: SnapshotCtx,
  send: SendFn,
): Array<(() => void) | null> {
  const ws = ctx.webServer;
  if (!ws?.register) return [];

  const reg = (method: string, p: string, handler: (req: any, res: any) => void) => {
    const d = ws.register!(method, p, handler);
    return typeof d === 'function' ? d : null;
  };

  return [
    // GET /anic/skill/list — list available skill scripts
    reg('GET', '/anic/skill/list', (req, res) => {
      send(res, 200, { scripts: listSkillScripts() });
    }),

    // POST /anic/skill/invoke — invoke a skill script on a workspace
    reg('POST', '/anic/skill/invoke', (req, res) => {
      const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
      const script = body?.script;
      const args: string[] = Array.isArray(body?.args) ? body.args : [];
      const workspace = body?.workspace ?? resolveWorkspaceRoots(ctx);
      const timeout = body?.timeout ?? 30000;

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
      const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
      const workspace = body?.workspace ?? resolveWorkspaceRoots(ctx);
      const dimensions = body?.dimensions;

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
      const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
      const workspace = body?.workspace ?? resolveWorkspaceRoots(ctx);

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

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}
