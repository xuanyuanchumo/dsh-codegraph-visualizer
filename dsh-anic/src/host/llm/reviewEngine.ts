/**
 * M4 LLM 评审引擎 — 条件性接入。
 *
 * INV-24：'llm' 绝不进硬 inject 数组 → ctx.get 探测 + ctx.inject 增量接入。
 * INV-23：闭合 JSON 协议 + 本地校验 + 失败即 doubt（fail-closed）。
 *
 * 三态：LLM 可用 → Tier-2 语义评审 / LLM 不可用 → Tier-1 启发式降级 / 调用失败 → doubt。
 */

import type { AgentCard } from '../agents.ts';

// ── 类型 ────────────────────────────────────────────────

/** LLM 运行时最小契约（转录自 M0-② spike host-llm-service.md） */
export interface LlmRuntime {
  stream(opts: GenerateOptions): AsyncIterable<LlmChunk>;
  listProviders(): string[];
}

export interface GenerateOptions {
  provider: string;
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  purpose?: string;
}

export interface LlmChunk {
  text?: string;
  error?: { code: string; message: string };
}

/** 评审请求 */
export interface ReviewRequest {
  gate: string;
  role: string;
  evidence: { id: string; content: string }[];
}

/** 评审裁决（闭合 JSON 协议） */
export interface ReviewVerdict {
  verdict: 'approve' | 'reject' | 'doubt';
  evidenceIds: string[];
  notes: string;
  tier: 'tier-2-llm' | 'tier-1-heuristic' | 'tier-0-unavailable';
}

// ── 探测 ────────────────────────────────────────────────

/**
 * 探测 ctx.llm 是否可用。
 * INV-24：用 ctx.get('llm', false)（非 strict），绝不放 inject 数组。
 * 返回 null = 不可用（降级 Tier-1），非 null = 可用（Tier-2）。
 */
export function probeLlm(ctx: unknown): LlmRuntime | null {
  if (ctx === null || typeof ctx !== 'object') return null;
  const c = ctx as Record<string, unknown>;
  const get = c.get;
  if (typeof get !== 'function') return null;
  try {
    // ctx.get('llm', false) — false = 非 strict（不要求 provider fiber 当前 active）
    const runtime = (get as (key: string, strict?: boolean) => unknown).call(c, 'llm', false);
    if (runtime === null || runtime === undefined) return null;
    if (typeof runtime !== 'object') return null;
    const r = runtime as Record<string, unknown>;
    if (typeof r.stream !== 'function' || typeof r.listProviders !== 'function') return null;
    return runtime as LlmRuntime;
  } catch {
    return null;
  }
}

// ── 闭合协议校验 ────────────────────────────────────────

/**
 * 校验 LLM 返回的闭合 JSON。
 * INV-23：任一不满足 → doubt（fail-closed，绝不 approve）。
 */
export function validateReviewJson(raw: string): ReviewVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // JSON 解析失败 → doubt
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  // verdict 必须是三值之一
  if (p.verdict !== 'approve' && p.verdict !== 'reject' && p.verdict !== 'doubt') return null;
  // evidenceIds 必须是非空字符串数组
  if (!Array.isArray(p.evidenceIds) || p.evidenceIds.length === 0) return null;
  if (!p.evidenceIds.every((e) => typeof e === 'string')) return null;
  // notes 必须是非空字符串
  if (typeof p.notes !== 'string' || p.notes.length === 0) return null;
  return {
    verdict: p.verdict,
    evidenceIds: p.evidenceIds as string[],
    notes: p.notes,
    tier: 'tier-2-llm',
  };
}

// ── 评审引擎 ────────────────────────────────────────────

const REVIEW_TIMEOUT_MS = 30_000;

/**
 * 执行 LLM 评审。
 * fail-closed：任何异常 → doubt（绝不 approve）。
 */
export async function runLlmReview(
  runtime: LlmRuntime,
  card: AgentCard,
  request: ReviewRequest,
  provider: string,
  model: string,
): Promise<ReviewVerdict> {
  const evidenceText = request.evidence
    .map((e) => `[${e.id}] ${e.content}`)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: card.systemPrompt },
    { role: 'user' as const, content: `门：${request.gate}\n角色：${request.role}\n\n证据材料：\n${evidenceText}` },
  ];

  let rawText = '';
  try {
    const iter = runtime.stream({ provider, model, messages, purpose: 'review' });
    const chunks = await Promise.race([
      collectStream(iter),
      new Promise<LlmChunk[]>((_, reject) =>
        setTimeout(() => reject(new Error('REVIEW_TIMEOUT')), REVIEW_TIMEOUT_MS),
      ),
    ]);
    for (const chunk of chunks) {
      if (chunk.error) {
        return { verdict: 'doubt', evidenceIds: [], notes: `LLM error: ${chunk.error.code}`, tier: 'tier-2-llm' };
      }
      if (chunk.text) rawText += chunk.text;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { verdict: 'doubt', evidenceIds: [], notes: `LLM 调用失败：${msg}`, tier: 'tier-2-llm' };
  }

  const validated = validateReviewJson(rawText);
  if (validated !== null) return validated;

  // fail-closed：无法解析 → doubt
  return { verdict: 'doubt', evidenceIds: [], notes: 'LLM 返回不符合闭合 JSON 协议（fail-closed → doubt）', tier: 'tier-2-llm' };
}

/** 辅助：将 AsyncIterable 收集为数组（与 timeout race） */
async function collectStream(iter: AsyncIterable<LlmChunk>): Promise<LlmChunk[]> {
  const chunks: LlmChunk[] = [];
  for await (const chunk of iter) chunks.push(chunk);
  return chunks;
}

// ── Tier-1 降级 ─────────────────────────────────────────

/**
 * Tier-1 启发式降级评审（LLM 不可用时）。
 * 诚实标注：这是启发式，不是模型评审。
 */
export function heuristicReview(request: ReviewRequest): ReviewVerdict {
  const evidenceCount = request.evidence.length;
  if (evidenceCount === 0) {
    return { verdict: 'doubt', evidenceIds: [], notes: '无证据材料（Tier-1 启发式：零证据 → doubt）', tier: 'tier-1-heuristic' };
  }
  // 启发式：有证据即 approve（诚实标注：这不是模型评审）
  return {
    verdict: 'approve',
    evidenceIds: request.evidence.map((e) => e.id),
    notes: `Tier-1 启发式降级（${String(evidenceCount)} 条证据）；LLM 不可用，非模型评审`,
    tier: 'tier-1-heuristic',
  };
}
