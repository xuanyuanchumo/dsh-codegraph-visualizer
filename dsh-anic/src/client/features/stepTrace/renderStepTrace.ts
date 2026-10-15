/**
 * W 白盒透明化 — StepTrace 分区渲染（纯函数，L5 投影）。
 * 输入 = GET /anic/api/step-trace 的 JSON（src/shared/stepTrace.ts 的 StepTrace 形状）。
 * INV-27：heuristic 行必须带 ⚠ 标注，绝不与 structured 同视觉权重。
 */
import { createElement, type ReactElement } from 'react';

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

const STATUS_COLORS: Record<string, string> = {
  done: '#16a34a',
  active: '#2563eb',
  failed: '#dc2626',
  skipped: '#9ca3af',
  pending: '#94a3b8',
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
          padding: '3px 8px', borderBottom: '1px solid #f1f5f9',
        },
      },
      createElement('span', {
        style: {
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: STATUS_COLORS[s.status] ?? '#94a3b8',
          border: '1px solid #cbd5e1',
        },
      }),
      createElement('span', { style: { minWidth: 160, color: '#334155' } }, s.name || s.nodeId),
      createElement('span', { style: { color: '#64748b' } }, `${s.kind} · ${s.status}`),
      s.basis === 'heuristic'
        ? createElement('span', {
            'data-anic-heuristic': 'true',
            title: '启发标注（INV-27）：结构化状态缺失，由账本裁决推断',
            style: { color: '#b45309', fontSize: 10 },
          }, '⚠ heuristic')
        : createElement('span', { style: { color: '#16a34a', fontSize: 10 } }, '✓ structured'),
      s.ledgerVerdict
        ? createElement('span', { style: { color: '#7c3aed', fontSize: 10 } }, `账本: ${s.ledgerVerdict.result}`)
        : null,
      i === trace.steps.length - 1 ? null : null,
    ),
  );

  return createElement(
    'div',
    { 'data-anic-steptrace': 'section', style: { padding: '8px 10px' } },
    createElement('div', { style: { fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 } }, '步骤流程（白盒投影）'),
    createElement('div', { style: { fontSize: 10, color: '#94a3b8', marginBottom: 6 } },
      `四源: graph=${trace.sourceStatus.graph} nodeState=${trace.sourceStatus.nodeState} ledger=${trace.sourceStatus.ledger} artifacts=${trace.sourceStatus.cycleArtifacts}`),
    ...rows,
    trace.warnings.length > 0
      ? createElement('div', { 'data-anic-trace-warnings': 'true', style: { fontSize: 10, color: '#b45309', marginTop: 6 } },
          `投影告警 ${String(trace.warnings.length)} 条（诚实标注，非错误）`)
      : null,
  );
}
