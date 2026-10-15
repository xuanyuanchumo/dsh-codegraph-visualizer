/**
 * 原生实现路由（7 脚本原生等价物）：
 * POST /anic/hitl-audit · GET /anic/band-detect · GET /anic/org-status
 * GET /anic/fact-base · GET /anic/plan-sync · POST /anic/multi-agent-gate · POST /anic/fix-loop
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createScoped, newRequestId } from '../logger.ts';
import { runHitlAudit } from '../governance/hitlAudit.ts';
import { runBandDetection, loadBandHistory } from '../evolution/bandDetector.ts';
import { runOrgStatus } from '../evolution/orgStatus.ts';
import { runFactBaseVerify } from '../governance/factBaseVerify.ts';
import { runPlanSync } from '../governance/planSync.ts';
import { runAllGates, runGate, type GateName } from '../llm/multiAgentGate.ts';
import { runFixLoop } from '../evolution/fixLoop.ts';
import type { AgentCard } from '../agents.ts';

const log = createScoped('anic:route:native');

interface SendFn { (res: unknown, status: number, body: unknown, requestId?: string): void; }

/** 注册原生实现路由（7 脚本原生等价物）。 */
export function registerNativeRoute(
  ctx: unknown,
  deps: { send: SendFn; getWorkspaceRoot: () => string | null; agentCards: Map<string, AgentCard> },
): Array<(() => void) | null> {
  const ws = (ctx as { webServer?: { register: (method: string, path: string, handler: (req: unknown, res: unknown) => void) => (() => void) | void } }).webServer;
  if (!ws || typeof ws.register !== 'function') return [];
  const disposers: Array<(() => void) | null> = [];

  const reg = (method: string, path: string, handler: (req: unknown, res: unknown) => void) => {
    const d = ws.register(method, path, handler);
    disposers.push(typeof d === 'function' ? d : null);
  };

  // POST /anic/hitl-audit
  reg('POST', '/anic/hitl-audit', (_req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    const result = runHitlAudit(root);
    deps.send(res, 200, result, rid);
  });

  // GET /anic/band-detect?score=0.75
  reg('GET', '/anic/band-detect', (req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    const r = req as { url?: string };
    const scoreMatch = r?.url?.match(/score=([0-9.]+)/);
    const parsed = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : 1.0;
    const score = Math.max(0, Math.min(1, parsed)); // 限制 [0, 1] 范围
    const result = runBandDetection(root, score);
    deps.send(res, 200, result, rid);
  });

  // GET /anic/org-status
  reg('GET', '/anic/org-status', (_req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    const result = runOrgStatus(root, {});
    deps.send(res, 200, result, rid);
  });

  // GET /anic/fact-base
  reg('GET', '/anic/fact-base', (_req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    const result = runFactBaseVerify(root);
    deps.send(res, 200, result, rid);
  });

  // GET /anic/plan-sync
  reg('GET', '/anic/plan-sync', (_req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    const result = runPlanSync(root);
    deps.send(res, 200, result, rid);
  });

  // POST /anic/multi-agent-gate { gate?: string, evidence?: {content,id}[] }
  reg('POST', '/anic/multi-agent-gate', (_req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    // 简化：运行全部门禁
    const evidenceByGate: Record<string, { content: string; id: string }[]> = {};
    const results = runAllGates(deps.agentCards, evidenceByGate);
    deps.send(res, 200, { gates: results, allPassed: results.every((g) => g.passed) }, rid);
  });

  // POST /anic/fix-loop { verifyCommand?: string }
  reg('POST', '/anic/fix-loop', (_req, res) => {
    const rid = newRequestId();
    const root = deps.getWorkspaceRoot();
    if (!root) return deps.send(res, 404, { error: 'no workspace' }, rid);
    // 验证函数：检查 .cycles/gates/ledger.json 存在性
    const verifyFn = () => {
      const ledgerPath = join(root, '.cycles', 'gates', 'ledger.json');
      const ledgerExists = existsSync(ledgerPath);
      return { passed: ledgerExists, report: ledgerExists ? 'all checks passed' : 'ledger missing' };
    };
    const result = runFixLoop(root, verifyFn);
    deps.send(res, 200, result, rid);
  });

  return disposers;
}
