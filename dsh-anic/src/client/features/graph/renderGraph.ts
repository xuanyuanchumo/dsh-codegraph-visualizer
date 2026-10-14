/**
 * 纯渲染：工作流图数据 → SVG 元素树（M0-① 图区 + M3 三态色/FAIL 脉冲/节点点击）。
 *
 * 从 WorkflowGraphPanel.ts 提取（12 §3.1 特性模块制：单文件 ≤~250 行）。
 * smoke 直接断言此函数，不经 React 生命周期。
 */
import { createElement, type ReactElement } from 'react';
import type { WorkflowEdge, WorkflowNode } from '../../workflowGraphData.ts';
import { gateFillOf, FAIL_PULSE_STYLE } from './gateColors.ts';

// ── 类型色 ──────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  phase: '#4a90d9',
  'micro-step': '#7fb3e8',
  gate: '#e6a23c',
  'human-gate': '#d9534f',
  cycle: '#67c23a',
  'gate-event': '#9b59b6',
  incident: '#c0392b',
  autonomy: '#16a085',
};

function colorOf(type: string): string {
  return TYPE_COLORS[type] ?? '#888888';
}

function shortLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function nodeRadius(type: string): number {
  return type === 'phase' || type === 'gate' || type === 'human-gate' ? 7 : 5;
}

// ── 接口 ────────────────────────────────────────────────────

export interface GraphData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ── 纯渲染 ──────────────────────────────────────────────────

/**
 * 数据 → SVG 元素树。M3：三态色 + FAIL 脉冲 + 节点点击。
 *
 * @param verdicts nodeId → verdict（PASS/FAIL/doubt/pending/skip），来自 step-trace
 * @param onNodeClick 节点点击回调（面板传入以打开详情抽屉）
 */
export function renderGraph(
  data: GraphData,
  verdicts?: Map<string, string>,
  onNodeClick?: (node: WorkflowNode) => void,
): ReactElement {
  const { nodes, edges } = data;
  const byId = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));

  // 包围盒计算（单遍 O(n)）
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = 30;
  minX -= pad;
  minY -= pad;
  maxX += pad + 120;
  maxY += pad;
  const width = maxX - minX;
  const height = maxY - minY;

  const children: ReactElement[] = [
    createElement('style', { key: 'fail-pulse' }, FAIL_PULSE_STYLE),
    createElement(
      'defs',
      { key: 'defs' },
      createElement(
        'marker',
        { key: 'arrow', id: 'anic-spike-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' },
        createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' }),
      ),
    ),
  ];

  edges.forEach((e, i) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    children.push(
      createElement('line', {
        key: `e${String(i)}`,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: '#cbd5e1', strokeWidth: 0.7, markerEnd: 'url(#anic-spike-arrow)',
      }),
    );
  });

  nodes.forEach((n, i) => {
    const failed = n.result === 'FAIL';
    const verdict = verdicts?.get(n.id) ?? n.result;
    const gateColor = gateFillOf(verdict);
    const fill = gateColor ?? colorOf(n.type);
    children.push(
      createElement(
        'g',
        {
          key: `n${String(i)}`,
          transform: `translate(${String(n.x)},${String(n.y)})`,
          onClick: onNodeClick ? () => { onNodeClick(n); } : undefined,
          style: onNodeClick ? { cursor: 'pointer' } : undefined,
        },
        createElement('title', null, `${n.label} [${n.type}]${verdict ? ` · ${verdict}` : ''}`),
        createElement('circle', {
          r: nodeRadius(n.type),
          fill,
          stroke: failed ? '#dc2626' : '#334155',
          strokeWidth: failed ? 2 : 0.6,
          className: failed ? 'anic-fail-node' : undefined,
        }),
        createElement('text', { x: 9, y: 3, fontSize: 7, fill: '#334155' }, shortLabel(n.label)),
      ),
    );
  });

  return createElement('svg', {
    width, height,
    viewBox: `${String(minX)} ${String(minY)} ${String(width)} ${String(height)}`,
    style: { background: '#f8fafc', fontFamily: 'monospace', display: 'block' },
  }, children);
}

// ── 辅助 ────────────────────────────────────────────────────

import type { StepTraceJson } from '../stepTrace/renderStepTrace.ts';

/** M3：从 step-trace 构建 verdicts map（nodeId → verdict） */
export function buildVerdicts(trace: StepTraceJson | null): Map<string, string> | undefined {
  if (trace === null || trace === undefined) return undefined;
  const map = new Map<string, string>();
  if (Array.isArray(trace.steps)) {
    for (const s of trace.steps) {
      if (s !== null && typeof s === 'object' && 'nodeId' in s) {
        const nodeId = s.nodeId;
        const verdict = s.ledgerVerdict?.result;
        if (typeof nodeId === 'string' && typeof verdict === 'string') {
          map.set(nodeId, verdict);
        }
      }
    }
  }
  return map.size > 0 ? map : undefined;
}
