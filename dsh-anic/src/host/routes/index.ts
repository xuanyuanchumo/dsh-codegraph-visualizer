/**
 * 路由聚合器（M9 结构优化后纯组合层 ~45 行）。
 *
 * 六域分区（doc 14 §4）：
 *  data      snapshot + step-trace + self-check + self-init
 *  cycle     cycle + ledger + stack-probe + seg-ledger
 *  review    review（条件性 LLM）
 *  evolution trust + autonomy + breakers + tech-debt
 *  governance archive + budget + sweep + prune
 *  self      self-bootstrap + skill（M7+M8）
 *
 * 共享 deps 经 routeContext 提取（单一职责）；agent 卡目录 dist 相对推导。
 */
import { fileURLToPath } from 'node:url';
import { registerSnapshotRoute, type SnapshotCtx } from '../snapshotRoute.ts';
import { registerStepTraceRoute } from './stepTraceRoute.ts';
import { registerSelfCheckRoute } from './selfCheckRoute.ts';
import { registerSelfInitRoute } from './selfInitRoute.ts';
import { registerCycleRoute } from './cycleRoute.ts';
import { registerLedgerRoute } from './ledgerRoute.ts';
import { registerStackProbeRoute } from './stackProbeRoute.ts';
import { registerSegmentedLedgerRoute } from './segmentedLedgerRoute.ts';
import { registerReviewRoute } from './reviewRoute.ts';
import { registerEvolutionRoute } from './evolutionRoute.ts';
import { registerGovernanceRoute } from './governanceRoute.ts';
import { registerSelfBootstrapRoutes } from './selfBootstrapRoute.ts';
import { registerSkillRoutes } from './skillRoute.ts';
import { registerSkillInstallRoute } from './skillInstallRoute.ts';
import { registerNativeRoute } from './nativeRoute.ts';
import { registerDualBootstrapRoute } from './dualBootstrapRoute.ts';
import { registerTruthAuditRoute } from './truthAuditRoute.ts';
import { buildRouteContext, type SendFn } from './routeContext.ts';
import { loadAgentCards } from '../agents.ts';

export type { SendFn } from './routeContext.ts';

export interface RegisterRoutesOptions {
  agentCardsDir?: string;
}

function defaultAgentCardsDir(): string {
  try { return fileURLToPath(new URL('../../assets/agents/', import.meta.url)); } catch { return ''; }
}

/** 注册全部 ANIC 路由（六域分区聚合）。 */
export function registerAnicRoutes(ctx: unknown, options: RegisterRoutesOptions = {}): (() => void) | null {
  const c = ctx as SnapshotCtx;
  if (!c.webServer || typeof c.webServer.register !== 'function') return null;

  const { send, getWorkspaceRoot, loadFlows } = buildRouteContext(ctx);
  const agentCardsDir = options.agentCardsDir ?? defaultAgentCardsDir();
  const disposers: Array<(() => void) | null> = [];

  // ── data 域 ──
  disposers.push(
    registerSnapshotRoute(ctx),
    registerStepTraceRoute(ctx),
    registerSelfCheckRoute(ctx, { send, getWorkspaceRoot, agentCardsDir }),
    registerSelfInitRoute(ctx, { send, getWorkspaceRoot, loadFlows }),
  );

  // ── cycle 域 ──
  disposers.push(
    registerCycleRoute(ctx, { send, getWorkspaceRoot }),
    registerLedgerRoute(ctx, { send, getWorkspaceRoot }),
    registerStackProbeRoute(ctx, { send, getWorkspaceRoot }),
    registerSegmentedLedgerRoute(c, { send, getWorkspaceRoot }),
  );

  // ── review 域（条件性 LLM）──
  if (agentCardsDir) {
    const { cards } = loadAgentCards(agentCardsDir);
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    registerReviewRoute(
      (method, path, handler) => {
        const d = c.webServer?.register?.(method, path, handler as (req: unknown, res: unknown) => void);
        if (typeof d === 'function') disposers.push(d);
      },
      { getAgentCards: () => cardMap, probeCtx: ctx },
    );
  }

  // ── evolution 域 ──
  disposers.push(...registerEvolutionRoute(c, send));

  // ── governance 域 ──
  disposers.push(...registerGovernanceRoute(c, send));

  // ── self 域（M7 自举 + M8 跨项目 + 技能自动安装）──
  disposers.push(...registerSelfBootstrapRoutes(c, send));
  disposers.push(...registerSkillRoutes(c, send));
  disposers.push(...registerSkillInstallRoute(ctx, { send, getWorkspaceRoot }));

  // ── native 域（7 脚本原生等价物）──
  if (agentCardsDir) {
    const { cards } = loadAgentCards(agentCardsDir);
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    disposers.push(...registerNativeRoute(ctx, { send, getWorkspaceRoot, agentCards: cardMap }));
  }

  // ── dual 域（双向自举 M11）──
  {
    const pluginDir = fileURLToPath(new URL('../../../', import.meta.url));
    disposers.push(...registerDualBootstrapRoute({ ctx: c, send, getWorkspaceRoot, pluginDir }));
    disposers.push(...registerTruthAuditRoute(c, send));
  }

  const cleanups = disposers.filter((d): d is () => void => typeof d === 'function');
  if (cleanups.length === 0) return null;
  return () => { for (const d of cleanups) d(); };
}
