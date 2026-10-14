/**
 * 多代理门禁（原生实现，替代技能 multi-agent-gate.mjs）。
 * 5 门 × 3 角色，聚合裁决：approve/reject/doubt。
 * Tier-1 模式：基于证据的启发式评估（诚实标注「非模型评审」）。
 * Tier-2 模式：调用 LLM 评审引擎（如果可用）。
 */
import type { AgentCard } from '../agents.ts';

export type GateVerdict = 'approve' | 'reject' | 'doubt';
export const GATE_NAMES = ['intent', 'spec', 'plan', 'pr', 'release'] as const;
export const AGENT_ROLES = ['planner', 'implementer', 'reviewer'] as const;
export type GateName = (typeof GATE_NAMES)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface AgentVerdict {
  role: AgentRole;
  verdict: GateVerdict;
  confidence: number; // 0-1
  evidenceIds: string[];
  notes: string;
  tier: 'Tier-1' | 'Tier-2';
}

export interface GateResult {
  gate: GateName;
  verdicts: AgentVerdict[];
  aggregate: GateVerdict;
  trustScore: number; // 0-100
  threshold: number; // 2 or 3
  passed: boolean;
}

/** 聚合裁决：approve 数 ≥ threshold → approve；否则 reject 优先于 doubt。 */
export function aggregateVerdicts(verdicts: AgentVerdict[], threshold: number): { verdict: GateVerdict; trustScore: number; passed: boolean } {
  const approve = verdicts.filter((v) => v.verdict === 'approve').length;
  const reject = verdicts.filter((v) => v.verdict === 'reject').length;
  const doubt = verdicts.filter((v) => v.verdict === 'doubt').length;
  const verdict: GateVerdict = approve >= threshold ? 'approve' : reject > 0 ? 'reject' : 'doubt';
  const trustScore = Math.round((approve / verdicts.length) * 100);
  return { verdict, trustScore, passed: verdict === 'approve' };
}

/** Tier-1 启发式评估（诚实标注「非模型评审」）。 */
export function heuristicEvaluate(
  role: AgentRole,
  gate: GateName,
  evidence: { content: string; id: string }[],
): AgentVerdict {
  // 基于证据数量的启发式评估
  const hasEvidence = evidence.length > 0;
  const evidenceContent = evidence.map((e) => e.content).join(' ');
  const wordCount = evidenceContent.split(/\s+/).filter(Boolean).length;
  const hasKeywords = ['通过', 'PASS', 'complete', 'done', '✓', '✅'].some((k) => evidenceContent.includes(k));
  const hasFailKeywords = ['失败', 'FAIL', 'error', '❌', '✗'].some((k) => evidenceContent.includes(k));

  let verdict: GateVerdict;
  let confidence: number;
  if (!hasEvidence || wordCount < 10) {
    verdict = 'doubt';
    confidence = 0.3;
  } else if (hasFailKeywords) {
    verdict = 'reject';
    confidence = 0.7;
  } else if (hasKeywords && wordCount >= 50) {
    verdict = 'approve';
    confidence = 0.6;
  } else {
    verdict = 'doubt';
    confidence = 0.4;
  }

  return {
    role,
    verdict,
    confidence,
    evidenceIds: evidence.map((e) => e.id),
    notes: `Tier-1 heuristic (wordCount=${wordCount}, hasFail=${hasFailKeywords})`,
    tier: 'Tier-1',
  };
}

/** 运行单门多代理评估。 */
export function runGate(
  gate: GateName,
  agentCards: Map<string, AgentCard>,
  evidence: { content: string; id: string }[],
  options?: { llmResults?: AgentVerdict[] },
): GateResult {
  const threshold = gate === 'release' ? 3 : 2; // release 门需全票
  const verdicts: AgentVerdict[] = [];

  for (const role of AGENT_ROLES) {
    const cardId = `anic.agent.${gate}.${role}`;
    const card = agentCards.get(cardId);
    if (!card) continue;

    // 优先使用 LLM 结果（Tier-2），否则 Tier-1 启发式
    const llmResult = options?.llmResults?.find((v) => v.role === role);
    if (llmResult && llmResult.tier === 'Tier-2') {
      verdicts.push(llmResult);
    } else {
      verdicts.push(heuristicEvaluate(role, gate, evidence));
    }
  }

  const { verdict, trustScore, passed } = aggregateVerdicts(verdicts, threshold);
  return { gate, verdicts, aggregate: verdict, trustScore, threshold, passed };
}

/** 运行全部门禁。 */
export function runAllGates(
  agentCards: Map<string, AgentCard>,
  evidenceByGate: Record<string, { content: string; id: string }[]>,
): GateResult[] {
  return GATE_NAMES.map((gate) => runGate(gate, agentCards, evidenceByGate[gate] ?? []));
}
