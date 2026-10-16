/**
 * W 白盒透明化 — StepTrace 分区渲染（纯函数，L5 投影）。
 * 输入 = GET /anic/api/step-trace 的 JSON（src/shared/stepTrace.ts 的 StepTrace 形状）。
 * INV-27：heuristic 行必须带 ⚠ 标注，绝不与 structured 同视觉权重。
 */
import { createElement, type ReactElement } from 'react';
import { token } from '../../../shared/tokens.ts';

export interface TraceStepJson {
  nodeId: string;
  name: string;
  kind: string;
  status: string;
  basis: 'structured' | 'heuristic';
  sources: string[];
  ledgerVerdict: { result: string; timestamp: string } | null;
  cyclesSeen: string[];
  warnings: string[];
}

export interface StepTraceJson {
  generatedAt: string;
  steps: TraceStepJson[];
  sourceStatus: { graph: string; nodeState: string; ledger: string; cycleArtifacts: string };
  warnings: string[];
}

/** 步骤状态色（P1-TOKENS）：原为私有十六进制表，现走语义令牌。 */
const STATUS_COLORS: Record<string, string> = {
  done: token('anic-status-done'),
  active: token('anic-status-active'),
  failed: token('anic-status-failed'),
  skipped: token('anic-status-skipped'),
  pending: token('anic-status-pending'),
};

/** 纯渲染：StepTrace JSON → 元素树（smoke 可断言）。 */
export function renderStepTrace(trace: StepTraceJson): ReactElement {
  const rows = trace.steps.map((s, i) =>
    createElement(
      'div',
      {
        key: s.nodeId,
        'data-anic-step': s.nodeId,
        style: {
          display: 'flex', gap: 8, alignItems: 'center', fontSize: 12,
          padding: '3px 8px', borderBottom: `1px solid ${token('anic-row-border')}`,
        },
      },
      createElement('span', {
        style: {
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: STATUS_COLORS[s.status] ?? token('anic-status-pending'),
          border: `1px solid ${token('anic-border-strong')}`,
        },
      }),
      createElement('span', { style: { minWidth: 160, color: token('anic-text') } }, s.name || s.nodeId),
      createElement('span', { style: { color: token('anic-text-dim') } }, `${s.kind} · ${s.status}`),
      s.basis === 'heuristic'
        ? createElement('span', {
            'data-anic-heuristic': 'true',
            title: '启发标注（INV-27）：结构化状态缺失，由账本裁决推断',
            style: { color: token('anic-warn-text'), fontSize: 10 },
          }, '⚠ heuristic')
        : createElement('span', { style: { color: token('anic-ok-text'), fontSize: 10 } }, '✓ structured'),
      s.ledgerVerdict
        ? createElement('span', { style: { color: token('anic-ledger-text'), fontSize: 10 } }, `账本: ${s.ledgerVerdict.result}`)
        : null,
      i === trace.steps.length - 1 ? null : null,
    ),
  );

  return createElement(
    'div',
    { 'data-anic-steptrace': 'section', style: { padding: '8px 10px' } },
    createElement('div', { style: { fontSize: 12, fontWeight: 600, color: token('anic-text'), marginBottom: 4 } }, '步骤流程（白盒投影）'),
    createElement('div', { style: { fontSize: 10, color: token('anic-text-faint'), marginBottom: 6 } },
      `四源: graph=${trace.sourceStatus.graph} nodeState=${trace.sourceStatus.nodeState} ledger=${trace.sourceStatus.ledger} artifacts=${trace.sourceStatus.cycleArtifacts}`),
    ...rows,
    trace.warnings.length > 0
      ? createElement('div', { 'data-anic-trace-warnings': 'true', style: { fontSize: 10, color: token('anic-warn-text'), marginTop: 6 } },
          `投影告警 ${String(trace.warnings.length)} 条（诚实标注，非错误）`)
      : null,
  );
}
