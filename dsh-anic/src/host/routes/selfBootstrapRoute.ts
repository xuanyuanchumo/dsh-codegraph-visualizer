/**
 * Self-bootstrap routes — dsh-anic evaluates itself using the skill.
 * M7: self/evaluate + self/iterate + self/gate-check + self/status
 */

import path from 'node:path';
import fs from 'node:fs';
import type { SnapshotCtx } from '../snapshotRoute.ts';
import { type RouteReq, parseBody } from './routeContext.ts';
import { resolveWorkspaceRoots, sendJson } from '../snapshotRoute.ts';
import {
  type BootstrapState,
  loadBootstrapState,
  saveBootstrapState,
  advanceBootstrap,
  initialBootstrapState,
} from '../selfBootstrap.ts';
import {
  resolveSkillScriptsDir,
  invokeSkillScript,
} from '../skillInvoker.ts';

type SendFn = (res: unknown, code: number, body: unknown, requestId?: string) => void;

function getLatestCycleDir(cyclesDir: string): string | null {
  const cyclesRoot = path.join(cyclesDir, 'cycles');
  if (!fs.existsSync(cyclesRoot)) return null;
  const dirs = fs.readdirSync(cyclesRoot)
    .filter(d => /^cycle-\d+$/.test(d))
    .map(d => ({ name: d, num: parseInt(d.replace('cycle-', ''), 10) }))
    .sort((a, b) => b.num - a.num);
  return dirs.length > 0 ? path.join(cyclesRoot, dirs[0]!.name) : null;
}

function parseEvalScore(stdout: string): number {
  // eval-runner outputs a score line like "Overall score: 0.875"
  const m = stdout.match(/(?:Overall\s+)?score[:\s]+([0-9.]+)/i);
  return m?.[1] ? parseFloat(m[1]) : 0;
}

function parseGateVerdict(stdout: string): string {
  // gate-check outputs verdict like "GATE: PASS" or "Overall: PASS"
  const m = stdout.match(/(?:Overall|GATE|Verdict)[:\s]+(PASS|FAIL|doubt|SKIP)/i);
  return m?.[1] ?? 'unknown';
}

/** 注册自举路由（evaluate/gate-check/iterate/status）。 */
export function registerSelfBootstrapRoutes(
  ctx: SnapshotCtx,
  send: SendFn,
): Array<(() => void) | null> {
  const ws = ctx.webServer;
  if (!ws?.register) return [];

  const reg = (p: string, handler: (req: RouteReq, res: unknown) => void) => {
    const d = ws.register!({ kind: 'exact', path: p, handler: handler as (req: unknown, res: unknown) => void });
    return typeof d === 'function' ? d : null;
  };

  return [
    // POST /anic/self/evaluate — run eval-runner on dsh-anic itself
    reg('/anic/self/evaluate', (_req, res) => {
      const roots = resolveWorkspaceRoots(ctx);
      if (!roots) { send(res, 500, { error: 'no workspace' }); return; }
      const cyclesDir = path.join(roots, '.cycles');
      const scriptsDir = resolveSkillScriptsDir(roots);
      if (!scriptsDir) { send(res, 404, { error: 'skill scripts not found' }); return; }

      const result = invokeSkillScript(scriptsDir, 'eval-runner', [], roots, 60000);
      const score = parseEvalScore(result.stdout);

      // Update bootstrap state
      const state = loadBootstrapState(cyclesDir);
      const newState: BootstrapState = {
        ...state,
        status: 'EVALUATING',
        lastEvalScore: score,
      };
      saveBootstrapState(cyclesDir, newState);

      send(res, 200, {
        exitCode: result.exitCode,
        score,
        stdout: result.stdout.slice(0, 4000),
        stderr: result.stderr.slice(0, 2000),
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      });
    }),

    // POST /anic/self/gate-check — run gate-check on dsh-anic itself
    reg('/anic/self/gate-check', (_req, res) => {
      const roots = resolveWorkspaceRoots(ctx);
      if (!roots) { send(res, 500, { error: 'no workspace' }); return; }
      const cyclesDir = path.join(roots, '.cycles');
      const scriptsDir = resolveSkillScriptsDir(roots);
      if (!scriptsDir) { send(res, 404, { error: 'skill scripts not found' }); return; }

      const result = invokeSkillScript(
        scriptsDir, 'gate-check',
        ['--gate', 'all', '--quality', '--record'],
        roots, 60000,
      );
      const verdict = parseGateVerdict(result.stdout);

      const state = loadBootstrapState(cyclesDir);
      const newState: BootstrapState = {
        ...state,
        status: 'GATE_CHECKING',
        lastGateVerdict: verdict,
      };
      saveBootstrapState(cyclesDir, newState);

      send(res, 200, {
        exitCode: result.exitCode,
        verdict,
        stdout: result.stdout.slice(0, 4000),
        stderr: result.stderr.slice(0, 2000),
        timedOut: result.timedOut,
      });
    }),

    // POST /anic/self/iterate — full micro-iteration (eval→gate→tech-debt)
    reg('/anic/self/iterate', (req, res) => {
      const body = parseBody(req);
      const maxRounds = typeof body.maxRounds === 'number' ? body.maxRounds : 3;

      const roots = resolveWorkspaceRoots(ctx);
      if (!roots) { send(res, 500, { error: 'no workspace' }); return; }
      const cyclesDir = path.join(roots, '.cycles');
      const scriptsDir = resolveSkillScriptsDir(roots);
      if (!scriptsDir) { send(res, 404, { error: 'skill scripts not found' }); return; }

      let state = loadBootstrapState(cyclesDir);
      if (state.status === 'CONVERGED' || state.status === 'EXHAUSTED') {
        state = initialBootstrapState(maxRounds);
      }
      state.maxRounds = maxRounds;

      // Step 1: Evaluate
      state.status = 'EVALUATING';
      saveBootstrapState(cyclesDir, state);
      const evalResult = invokeSkillScript(scriptsDir, 'eval-runner', [], roots, 60000);
      const evalScore = parseEvalScore(evalResult.stdout);

      // Step 2: Gate check
      state.status = 'GATE_CHECKING';
      saveBootstrapState(cyclesDir, state);
      const gateResult = invokeSkillScript(
        scriptsDir, 'gate-check',
        ['--gate', 'all', '--quality', '--record'],
        roots, 60000,
      );
      const gateVerdict = parseGateVerdict(gateResult.stdout);

      // Step 3: If FAIL, produce tech-debt proposal (do NOT self-modify code — R-31)
      let fixApplied: string | null = null;
      if (gateVerdict !== 'PASS' && gateVerdict !== 'approve') {
        state.status = 'FIXING';
        saveBootstrapState(cyclesDir, state);
        // Write tech-debt proposal (not a code fix)
        const techDebtDir = path.join(cyclesDir, 'tech-debt');
        if (!fs.existsSync(techDebtDir)) fs.mkdirSync(techDebtDir, { recursive: true });
        const proposal = {
          round: state.round + 1,
          evalScore,
          gateVerdict,
          gateStderr: gateResult.stderr.slice(0, 2000),
          timestamp: new Date().toISOString(),
          source: 'self-bootstrap',
          action: 'REVIEW_REQUIRED — no auto code modification (R-31)',
        };
        const tdFile = path.join(techDebtDir, `self-bootstrap-round-${state.round + 1}.json`);
        fs.writeFileSync(tdFile, JSON.stringify(proposal, null, 2), 'utf-8');
        fixApplied = `tech-debt/self-bootstrap-round-${state.round + 1}.json`;
      }

      // Step 4: Advance state
      state = advanceBootstrap(state, evalScore, gateVerdict, fixApplied);
      saveBootstrapState(cyclesDir, state);

      send(res, 200, {
        status: state.status,
        round: state.round,
        maxRounds: state.maxRounds,
        evalScore,
        gateVerdict,
        fixApplied,
        techDebtProposals: fixApplied ? [fixApplied] : [],
        converged: state.status === 'CONVERGED',
        exhausted: state.status === 'EXHAUSTED',
      });
    }),

    // GET /anic/self/status — bootstrap state
    reg('/anic/self/status', (_req, res) => {
      const roots = resolveWorkspaceRoots(ctx);
      if (!roots) { send(res, 500, { error: 'no workspace' }); return; }
      const cyclesDir = path.join(roots, '.cycles');
      const state = loadBootstrapState(cyclesDir);
      send(res, 200, state);
    }),
  ];
}
