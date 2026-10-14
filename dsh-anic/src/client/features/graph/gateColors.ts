/**
 * M3 门禁三态色 + FAIL 脉冲 + 节点详情。
 *
 * 三态色：PASS 绿 / FAIL 红 / doubt 黄 / pending 灰 / 无裁决 用类型色
 * FAIL 脉冲：CSS @keyframes，prefers-reduced-motion 禁用
 * 控制带：2σ/3σ 边框（在诊断面板呈现）
 */

import { createElement, type ReactElement } from 'react';

// ── 三态色 ──────────────────────────────────────────────

export const GATE_COLORS = {
  PASS: '#22c55e',
  FAIL: '#ef4444',
  doubt: '#f59e0b',
  pending: '#94a3b8',
  skip: '#64748b',
} as const;

/** 根据裁决返回填充色；无裁决返回 null（用类型色） */
export function gateFillOf(verdict: string | undefined): string | null {
  if (verdict === undefined || verdict === '') return null;
  const v = verdict.toLowerCase();
  if (v === 'pass' || v === 'approve') return GATE_COLORS.PASS;
  if (v === 'fail' || v === 'reject') return GATE_COLORS.FAIL;
  if (v === 'doubt') return GATE_COLORS.doubt;
  if (v === 'pending') return GATE_COLORS.pending;
  if (v === 'skip' || v === 'skipped') return GATE_COLORS.skip;
  return null;
}

// ── FAIL 脉冲 CSS ───────────────────────────────────────

export const FAIL_PULSE_STYLE = `
@keyframes anic-fail-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.anic-fail-node {
  animation: anic-fail-pulse 1.5s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .anic-fail-node {
    animation: none;
  }
}
`;

// ── 控制带（2σ/3σ） ─────────────────────────────────────

export interface ControlBand {
  mean: number;
  sigma2: number; // 2σ 边界
  sigma3: number; // 3σ 边界
  value: number;
  label: string;
}

/** 判定值在控制带中的位置 */
export function bandStatus(band: ControlBand): 'normal' | 'warn' | 'alarm' {
  const dev = Math.abs(band.value - band.mean);
  if (dev > band.sigma3) return 'alarm';
  if (dev > band.sigma2) return 'warn';
  return 'normal';
}

export const BAND_COLORS: Record<string, string> = {
  normal: '#22c55e',
  warn: '#f59e0b',
  alarm: '#ef4444',
};

/** 渲染控制带行 */
export function renderControlBand(band: ControlBand): ReactElement {
  const status = bandStatus(band);
  return createElement(
    'div',
    {
      'data-anic-band': band.label,
      style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, padding: '2px 0' },
    },
    createElement('span', { style: { minWidth: 80, color: '#475569' } }, band.label),
    createElement('span', { style: { color: BAND_COLORS[status], fontWeight: 'bold' } }, status.toUpperCase()),
    createElement('span', { style: { color: '#94a3b8' } }, `μ=${String(band.mean.toFixed(1))} 2σ=${String(band.sigma2.toFixed(1))} 3σ=${String(band.sigma3.toFixed(1))} val=${String(band.value.toFixed(1))}`),
  );
}

// ── 节点详情抽屉 ────────────────────────────────────────

export interface NodeDetail {
  id: string;
  label: string;
  type: string;
  result?: string;
  detail?: string;
  timestamp?: string;
  previousHash?: string;
}

export function renderNodeDetail(node: NodeDetail | null): ReactElement | null {
  if (node === null) return null;
  return createElement(
    'div',
    {
      'data-anic-node-detail': 'true',
      style: {
        position: 'sticky', bottom: 0, background: 'rgba(248,250,252,0.95)',
        borderTop: '2px solid #e2e8f0', padding: '8px 12px', fontSize: 11,
        fontFamily: 'monospace', maxHeight: 200, overflow: 'auto',
      },
    },
    createElement('div', { style: { fontWeight: 'bold', marginBottom: 4 } }, `${node.label} [${node.type}]`),
    createElement('div', { style: { color: '#475569' } }, `id: ${node.id}`),
    node.result !== undefined
      ? createElement('div', { style: { color: gateFillOf(node.result) ?? '#475569', fontWeight: 'bold' } }, `result: ${node.result}`)
      : null,
    node.detail !== undefined
      ? createElement('div', { style: { color: '#64748b', marginTop: 4, wordBreak: 'break-all' } }, node.detail)
      : null,
    node.timestamp !== undefined
      ? createElement('div', { style: { color: '#94a3b8', marginTop: 4 } }, `ts: ${node.timestamp}`)
      : null,
    node.previousHash !== undefined
      ? createElement('div', { style: { color: '#94a3b8' } }, `prev: ${node.previousHash.slice(0, 16)}…`)
      : null,
  );
}
