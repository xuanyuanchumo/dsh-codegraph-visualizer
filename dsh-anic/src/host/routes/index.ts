/**
 * 路由聚合器（一域一文件纪律的枢纽）：把 M1 全部 HTTP 面收口到一处注册。
 *
 * 路由清单（全部 exact、全部只读或显式 POST）：
 *  GET  /anic/api/workflow-snapshot  数据热更新（snapshotRoute）
 *  GET  /anic/api/step-trace         W 四源投影数据面（stepTraceRoute）
 *  GET  /anic/api/self-check         Runtime INV Probes（selfCheckRoute）
 *  POST /anic/self/init              B 自举（selfInitRoute；flow.selfInit 门控）
 *
 * 共享 deps：工作区解析（snapshotRoute 唯一实现）、sendJson（头语义唯一实现）、
 * flows（host/config.ts 唯一 loader 的 workspace 层 → resolveFlows）。
 * agent 卡目录：dist 相对推导（Junction 安装下即插件 assets/agents），
 * ANIC_AGENT_CARDS_DIR 可覆盖；找不到不报错——self-check P4 会如实呈现。
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { registerSnapshotRoute, resolveWorkspaceRoots, sendJson, type SnapshotCtx } from '../snapshotRoute.ts';
import { registerStepTraceRoute } from './stepTraceRoute.ts';
import { registerSelfCheckRoute } from './selfCheckRoute.ts';
import { registerSelfInitRoute } from './selfInitRoute.ts';
import { loadWorkspaceConfig } from '../config.ts';
import { resolveFlows } from '../../shared/flows.ts';

/** 统一 send 形态：第 4 参是 requestId（落到 X-ANIC-Request-Id 头；sendJson 唯一头实现）。 */
export type SendFn = (res: unknown, status: number, body: unknown, requestId?: string) => void;

function makeSend(): SendFn {
  return (res, status, body, requestId) => {
    sendJson(res, status, body, requestId ? { 'X-ANIC-Request-Id': requestId } : undefined);
  };
}

export interface RegisterRoutesOptions {
  /** 覆盖 agent 出厂卡目录（默认 dist/../assets/agents） */
  agentCardsDir?: string;
}

function defaultAgentCardsDir(): string {
  try {
    return fileURLToPath(new URL('../../assets/agents/', import.meta.url));
  } catch {
    return '';
  }
}

/** 注册 M1 全部路由；返回聚合 disposer（逐个调用，一次清干净）。 */
export function registerAnicRoutes(ctx: unknown, options: RegisterRoutesOptions = {}): (() => void) | null {
  const c = ctx as SnapshotCtx;
  if (!c.webServer || typeof c.webServer.register !== 'function') return null;

  const disposers: Array<(() => void) | null> = [];

  disposers.push(registerSnapshotRoute(ctx));

  const send = makeSend();

  const getWorkspaceRoot = (): string | null => {
    try {
      return resolveWorkspaceRoots(c);
    } catch {
      return null;
    }
  };

  const loadFlows = (): { selfInit: boolean } => {
    try {
      const root = getWorkspaceRoot();
      if (!root) return { selfInit: true };
      const cfg = loadWorkspaceConfig(join(root, '.cycles'));
      const resolved = resolveFlows({ workspace: cfg.values.flowOverrides });
      return { selfInit: resolved.flows['flow.selfInit']?.enabled ?? true };
    } catch {
      return { selfInit: true };
    }
  };

  disposers.push(
    registerStepTraceRoute(ctx),
    registerSelfCheckRoute(ctx, { send, getWorkspaceRoot, agentCardsDir: options.agentCardsDir ?? defaultAgentCardsDir() }),
    registerSelfInitRoute(ctx, { send, getWorkspaceRoot, loadFlows }),
  );

  const cleanups = disposers.filter((d): d is () => void => typeof d === 'function');
  if (cleanups.length === 0) return null;
  return () => { for (const d of cleanups) d(); };
}