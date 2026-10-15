/**
 * Runtime INV Probes（docs/anic/12 §2.1 的 M1 落地切片）：GET /anic/api/self-check
 *
 * 六项探针（全部只读，绝不修改工作区）：
 *  P1 INV-13 确定性：同一 .cycles 两次 buildWorkflowSnapshot digest 必须全等。
 *  P2 INV-21 结构化身份：快照节点 id 全部来自结构化字段（`an-` 前缀契约），
 *     不含从自由文本解析的 id。
 *  P3 配置单入口：loadWorkspaceConfig 成功加载且 source != legacy
 *     （legacy=降级可用但响亮告警，missing=ok:false）。
 *  P4 agent 卡装载：loadAgentCards 无错误（15 张出厂卡）。
 *  P5 投影可重算（INV-18）：stepTrace(workflowGraph) 两次构建结果 JSON 全等。
 *  P6 诊断域隔离（INV-26 源码形态）：本探针自身仅读，不写 `.cycles/`。
 *
 * 失败不抛异常：逐项 ok:false + detail，整体 200（诊断端点的诚实形态——
 * 探针本身不可用才是 500）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildWorkflowSnapshot } from '../../shared/snapshotCore.ts';
import { buildStepTrace } from '../../shared/stepTrace.ts';
import { loadWorkspaceConfig } from '../config.ts';
import { loadAgentCards } from '../agents.ts';
import { createScoped, newRequestId } from '../logger.ts';
import type { SnapshotCtx } from '../snapshotRoute.ts';

const log = createScoped('anic:route:self-check');
export const SELF_CHECK_ROUTE = '/anic/api/self-check';

export interface ProbeResult {
  id: string;
  inv?: string;
  ok: boolean;
  detail: string;
}

export interface SelfCheckInput {
  workspaceRoot: string;
  /** 出厂 agent 卡目录（Junction 安装下即插件 assets/agents） */
  agentCardsDir: string;
}

/** 运行六项运行时不变量探针并返回逐项结果。 */
export function runSelfChecks(input: SelfCheckInput): { checks: ProbeResult[]; allOk: boolean; requestId: string } {
  const requestId = newRequestId();
  const checks: ProbeResult[] = [];
  const cyclesDir = join(input.workspaceRoot, '.cycles');

  // P1 INV-13 确定性：固定 generatedAt 排除时间戳非确定性，只比较内容
  try {
    const hasCycles = existsSync(cyclesDir);
    const FIXED_TS = '2025-01-01T00:00:00.000Z';
    const a = hasCycles ? buildWorkflowSnapshot(cyclesDir, FIXED_TS) : null;
    const b = hasCycles ? buildWorkflowSnapshot(cyclesDir, FIXED_TS) : null;
    const da = a ? createHash('sha256').update(JSON.stringify(a)).digest('hex').slice(0, 16) : 'absent';
    const db = b ? createHash('sha256').update(JSON.stringify(b)).digest('hex').slice(0, 16) : 'absent';
    checks.push({ id: 'P1-snapshot-deterministic', inv: 'INV-13', ok: da === db, detail: `digest=${da}` + (da !== db ? ` vs ${db}` : '') });
  } catch (e) {
    checks.push({ id: 'P1-snapshot-deterministic', inv: 'INV-13', ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` });
  }

  // P2 INV-21 结构化身份：节点 id 必须使用结构化前缀（wf:/cycle:/evt:/inc:/aux:），
  // 不含从自由文本解析的 id。an- 是旧约定，实际结构化前缀见 snapshotCore.ts。
  const STRUCTURED_PREFIXES = ['wf:', 'cycle:', 'evt:', 'inc:', 'aux:'];
  try {
    const snap = existsSync(cyclesDir) ? buildWorkflowSnapshot(cyclesDir) : null;
    const bad = snap ? snap.nodes.filter((n: { id: string }) => !STRUCTURED_PREFIXES.some((p) => n.id.startsWith(p))).map((n: { id: string }) => n.id).slice(0, 5) : [];
    checks.push({ id: 'P2-structured-identity', inv: 'INV-21', ok: snap ? bad.length === 0 : true, detail: snap ? (bad.length === 0 ? `all ${snap.nodes.length} node ids are structured` : `non-structured ids: ${bad.join(',')}`) : 'no .cycles (vacuous ok)' });
  } catch (e) {
    checks.push({ id: 'P2-structured-identity', inv: 'INV-21', ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` });
  }

  // P3 配置单入口
  try {
    const cfg = loadWorkspaceConfig(cyclesDir);
    checks.push({ id: 'P3-config-single-entry', inv: 'INV-25', ok: cfg.source !== 'missing' && cfg.source !== 'legacy', detail: `source=${cfg.source}${cfg.warnings.length > 0 ? `; warnings: ${cfg.warnings.join(' | ')}` : ''}` });
  } catch (e) {
    checks.push({ id: 'P3-config-single-entry', inv: 'INV-25', ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` });
  }

  // P4 agent 卡
  try {
    const agents = loadAgentCards(input.agentCardsDir);
    checks.push({ id: 'P4-agent-cards', ok: agents.errors.length === 0, detail: agents.errors.length === 0 ? `${agents.cards.length} cards loaded` : agents.errors.slice(0, 3).join(' | ') });
  } catch (e) {
    checks.push({ id: 'P4-agent-cards', ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` });
  }

  // P5 INV-18 投影可重算（stepTrace 纯函数）
  try {
    if (existsSync(join(cyclesDir, 'workflow-graph.yaml'))) {
      // 固定 generatedAt 排除时间戳非确定性（与 P1 同理）
      const snap = buildWorkflowSnapshot(cyclesDir, '2025-01-01T00:00:00.000Z');
      const fixedNow = new Date('2025-01-01T00:00:00.000Z');
      const t1 = JSON.stringify(buildStepTrace(snap, { cyclesDir, now: fixedNow }));
      const t2 = JSON.stringify(buildStepTrace(snap, { cyclesDir, now: fixedNow }));
      checks.push({ id: 'P5-steptrace-reproducible', inv: 'INV-18', ok: t1 === t2, detail: t1 === t2 ? `trace stable (${t1.length} chars)` : 'two builds differ' });
    } else {
      checks.push({ id: 'P5-steptrace-reproducible', inv: 'INV-18', ok: true, detail: 'no workflow-graph.yaml (vacuous ok)' });
    }
  } catch (e) {
    checks.push({ id: 'P5-steptrace-reproducible', inv: 'INV-18', ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` });
  }

  // P6 INV-26 形态声明（运行时无副作用：本端点零写路径；源码守卫 G-IND 常驻）
  checks.push({ id: 'P6-diagnostics-domain-isolation', inv: 'INV-26', ok: true, detail: 'self-check is read-only by construction (no write path in this module)' });

  const allOk = checks.every((c) => c.ok);
  log[allOk ? 'info' : 'warn'](`self-check ${allOk ? 'all green' : 'has failures'} (${checks.filter((c) => c.ok).length}/${checks.length})`, requestId);
  return { checks, allOk, requestId };
}

/** HTTP 注册（GET /anic/api/self-check）。deps 注入与 selfInit 同形态；只读。 */
export function registerSelfCheckRoute(ctx: unknown, deps: { send: (res: unknown, status: number, body: unknown, requestId?: string) => void; getWorkspaceRoot: () => string | null; agentCardsDir: string }): (() => void) | null {
  const c = ctx as SnapshotCtx;
  const webServer = c.webServer;
  if (!webServer || typeof webServer.register !== 'function') return null;
  const disposer = webServer.register({
    kind: 'exact',
    path: SELF_CHECK_ROUTE,
    handler: (_req: unknown, res: unknown) => {
      const root = deps.getWorkspaceRoot();
      if (!root) {
        deps.send(res, 404, { error: { code: 'ANIC_ROUTE_SELF_CHECK_NO_WORKSPACE', message: 'no workspace resolvable' } });
        return;
      }
      try {
        const result = runSelfChecks({ workspaceRoot: root, agentCardsDir: deps.agentCardsDir });
        deps.send(res, 200, result, result.requestId);
      } catch (e) {
        deps.send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  });
  return typeof disposer === 'function' ? disposer : null;
}
