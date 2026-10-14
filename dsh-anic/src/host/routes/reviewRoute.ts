/**
 * M4 评审路由 — POST /anic/review。
 *
 * 条件性 LLM 接入：probe → Tier-2 / 降级 → Tier-1。
 * INV-23 fail-closed + INV-24 不进 inject。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { probeLlm, runLlmReview, heuristicReview, type ReviewRequest, type ReviewVerdict } from '../llm/reviewEngine.ts';
import type { AgentCard } from '../agents.ts';

const REVIEW_ROUTE = '/anic/review';

interface ReviewBody {
  gate?: unknown;
  role?: unknown;
  evidence?: unknown;
  provider?: unknown;
  model?: unknown;
}

function isReviewBody(raw: unknown): raw is ReviewBody {
  return raw !== null && typeof raw === 'object';
}

/** 注册评审路由 */
export function registerReviewRoute(
  register: (method: string, path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void,
  opts: {
    getAgentCards: () => Map<string, AgentCard>;
    probeCtx: unknown; // 宿主 ctx（用于 probeLlm）
    defaultProvider?: string;
    defaultModel?: string;
  },
): void {
  register('POST', REVIEW_ROUTE, async (req, res) => {
    // 读 body
    let bodyText = '';
    for await (const chunk of req) {
      bodyText += chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVALID_JSON', message: '请求体不是合法 JSON' }));
      return;
    }
    if (!isReviewBody(body) || typeof body.gate !== 'string' || typeof body.role !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVALID_REQUEST', message: '缺少 gate/role 字段' }));
      return;
    }
    const gate = body.gate;
    const role = body.role;
    const evidence = Array.isArray(body.evidence)
      ? (body.evidence as unknown[]).filter(
          (e): e is { id: string; content: string } =>
            e !== null && typeof e === 'object' &&
            typeof (e as Record<string, unknown>).id === 'string' &&
            typeof (e as Record<string, unknown>).content === 'string',
        )
      : [];

    const cardId = `anic.agent.${gate}.${role}`;
    const cards = opts.getAgentCards();
    const card = cards.get(cardId);
    if (card === undefined) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AGENT_NOT_FOUND', message: `未找到 agent 卡 ${cardId}` }));
      return;
    }

    const request: ReviewRequest = { gate, role, evidence };

    // 探测 LLM
    const runtime = probeLlm(opts.probeCtx);
    let verdict: ReviewVerdict;

    if (runtime !== null) {
      const provider = typeof body.provider === 'string' ? body.provider : (opts.defaultProvider ?? 'default');
      const model = typeof body.model === 'string' ? body.model : (opts.defaultModel ?? 'default');
      verdict = await runLlmReview(runtime, card, request, provider, model);
    } else {
      // 降级 Tier-1
      verdict = heuristicReview(request);
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'X-ANIC-Review-Tier': verdict.tier });
    res.end(JSON.stringify(verdict));
  });
}
