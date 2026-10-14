/**
 * M4 LLM 评审引擎测试。
 * INV-23 fail-closed + INV-24 不进 inject + 三态降级。
 */
import { describe, it, expect } from 'vitest';
import { probeLlm, validateReviewJson, heuristicReview, type LlmRuntime, type GenerateOptions, type LlmChunk } from '../../src/host/llm/reviewEngine.ts';

// ── probeLlm ────────────────────────────────────────────

describe('probeLlm', () => {
  it('null ctx → null', () => {
    expect(probeLlm(null)).toBeNull();
  });

  it('ctx 无 get 方法 → null', () => {
    expect(probeLlm({})).toBeNull();
  });

  it('ctx.get("llm", false) 返回有效 runtime → 返回 runtime', () => {
    const runtime: LlmRuntime = {
      async *stream(_opts: GenerateOptions): AsyncIterable<LlmChunk> { yield { text: 'ok' }; },
      listProviders: () => ['test'],
    };
    const ctx = { get: (key: string, _strict?: boolean) => key === 'llm' ? runtime : undefined };
    expect(probeLlm(ctx)).toBe(runtime);
  });

  it('ctx.get("llm") 返回 null → null', () => {
    const ctx = { get: () => null };
    expect(probeLlm(ctx)).toBeNull();
  });

  it('ctx.get 抛异常 → null（不传播）', () => {
    const ctx = { get: () => { throw new Error('boom'); } };
    expect(probeLlm(ctx)).toBeNull();
  });

  it('runtime 缺 stream 方法 → null', () => {
    const ctx = { get: () => ({ listProviders: () => [] }) };
    expect(probeLlm(ctx)).toBeNull();
  });
});

// ── validateReviewJson ──────────────────────────────────

describe('validateReviewJson', () => {
  it('合法 approve → 返回 ReviewVerdict', () => {
    const raw = JSON.stringify({ verdict: 'approve', evidenceIds: ['e1'], notes: 'ok' });
    const v = validateReviewJson(raw);
    expect(v).not.toBeNull();
    expect(v?.verdict).toBe('approve');
    expect(v?.tier).toBe('tier-2-llm');
  });

  it('合法 reject → 返回', () => {
    const v = validateReviewJson(JSON.stringify({ verdict: 'reject', evidenceIds: ['e1'], notes: 'no' }));
    expect(v?.verdict).toBe('reject');
  });

  it('合法 doubt → 返回', () => {
    const v = validateReviewJson(JSON.stringify({ verdict: 'doubt', evidenceIds: ['e1'], notes: 'unsure' }));
    expect(v?.verdict).toBe('doubt');
  });

  it('非法 verdict → null', () => {
    expect(validateReviewJson(JSON.stringify({ verdict: 'maybe', evidenceIds: ['e1'], notes: 'x' }))).toBeNull();
  });

  it('空 evidenceIds → null', () => {
    expect(validateReviewJson(JSON.stringify({ verdict: 'approve', evidenceIds: [], notes: 'x' }))).toBeNull();
  });

  it('空 notes → null', () => {
    expect(validateReviewJson(JSON.stringify({ verdict: 'approve', evidenceIds: ['e1'], notes: '' }))).toBeNull();
  });

  it('非 JSON → null', () => {
    expect(validateReviewJson('not json')).toBeNull();
  });

  it('LLM 返回多余文本包裹 JSON → null（fail-closed）', () => {
    expect(validateReviewJson('Here is my review: {"verdict":"approve","evidenceIds":["e1"],"notes":"ok"}')).toBeNull();
  });
});

// ── heuristicReview ─────────────────────────────────────

describe('heuristicReview', () => {
  it('零证据 → doubt + tier-1', () => {
    const v = heuristicReview({ gate: 'intent', role: 'planner', evidence: [] });
    expect(v.verdict).toBe('doubt');
    expect(v.tier).toBe('tier-1-heuristic');
  });

  it('有证据 → approve + tier-1 + 诚实标注', () => {
    const v = heuristicReview({ gate: 'intent', role: 'planner', evidence: [{ id: 'e1', content: 'test' }] });
    expect(v.verdict).toBe('approve');
    expect(v.tier).toBe('tier-1-heuristic');
    expect(v.notes).toContain('非模型评审');
  });
});
