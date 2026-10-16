/**
 * 纯渲染：工作流图数据 → SVG 元素树（M0-① 图区 + M3 三态色/FAIL 脉冲/节点点击）。
 *
 * 从 WorkflowGraphPanel.ts 提取（12 §3.1 特性模块制：单文件 ≤~250 行）。
 * smoke 直接断言此函数，不经 React 生命周期。
 */
import { createElement, type ReactElement } from 'react';
import type { WorkflowEdge, WorkflowNode } from '../../workflowGraphData.ts';
import { token } from '../../../shared/tokens.ts';
import { canonicalVerdict as verdictKey, gateFillOf, FAIL_PULSE_STYLE } from './gateColors.ts';
import type { StepTraceJson } from '../stepTrace/renderStepTrace.ts';

// ── 类型色 ──────────────────────────────────────────────────

/**
 * 节点类型色改为令牌引用（P1-TOKENS）：同一张表曾是本文件私有十六进制，
 * 与 gateColors / renderStepTrace 各自重复一份，"改一处亮一处"。
 */
const TYPE_COLORS: Record<string, string> = {
  phase: token('anic-type-phase'),
  'micro-step': token('anic-type-micro-step'),
  gate: token('anic-type-gate'),
  'human-gate': token('anic-type-human-gate'),
  cycle: token('anic-type-cycle'),
  'gate-event': token('anic-type-gate-event'),
  incident: token('anic-type-incident'),
  autonomy: token('anic-type-autonomy'),
};

function colorOf(type: string): string {
  return TYPE_COLORS[type] ?? token('anic-type-unknown');
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

// ── 裁决的非颜色编码通道（P2-A11Y-COLOR）────────────────────

/**
 * 改造前裁决只靠 `fill` 一个通道表达（PASS 绿 / FAIL 红 / doubt 黄）——
 * 对红绿色盲用户（约 8% 男性）PASS 与 FAIL 完全不可区分，而**任何 DOM 断言
 * 都看不出来**：圆点照常存在、点击照常工作、颜色照常"正确"。
 * 颜色永远不能是唯一通道（WCAG 1.4.1）。
 *
 * 这里给每个裁决配一个线型 + 一个字形：
 *   PASS 实线·✓ / FAIL 虚线·✕ / doubt 点线·? / pending 细虚线· / skip 短划·–
 */
const VERDICT_SHAPE: Record<string, { dash: string | undefined; glyph: string }> = {
  pass: { dash: undefined, glyph: '✓' },
  fail: { dash: '2 1.4', glyph: '✕' },
  doubt: { dash: '0.6 1.6', glyph: '?' },
  pending: { dash: '3 2', glyph: '·' },
  skip: { dash: '1 2', glyph: '–' },
};

/**
 * 把任意裁决拼写归一到 VERDICT_SHAPE 的键。
 *
 * 实现已收敛到 `gateColors.ts` 的 `canonicalVerdict`（全仓唯一别名表）：
 * 填充色 / 线型字形 / 文本色三个消费面共用一份归一化，第三份映射的加入
 * 让"各持一份 + 测试对账"的模式走到了尽头——两份还能对账，三份必然漂移。
 * 本文件既 `import`（:142 直接调用）又 `export`（graphA11y.test.ts 从本文件
 * 导入 `verdictKey`），转出口保持调用面不变。
 */
export { canonicalVerdict as verdictKey } from './gateColors.ts';

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
        createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: token('anic-text-faint') }),
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
        stroke: token('anic-border-strong'), strokeWidth: 0.7, markerEnd: 'url(#anic-spike-arrow)',
      }),
    );
  });

  nodes.forEach((n, i) => {
    const failed = n.result === 'FAIL';
    const verdict = verdicts?.get(n.id) ?? n.result;
    const fill = gateFillOf(verdict) ?? colorOf(n.type);
    const key = verdictKey(verdict);
    const shape = key === null ? undefined : VERDICT_SHAPE[key];
    const interactive = onNodeClick !== undefined;
    const label = `${n.label} [${n.type}]${verdict ? ` · ${verdict}` : ''}`;
    children.push(
      createElement(
        'g',
        {
          key: `n${String(i)}`,
          transform: `translate(${String(n.x)},${String(n.y)})`,
          // 键盘可达性（P2-A11Y-KEY）：改造前节点只挂 onClick，SVG `g` 默认
          // 不可聚焦 ⇒ Tab 永远到不了、Enter/Space 无反应，键盘用户完全无法
          // 打开节点详情。只挂 onClick 的图 = 纯鼠标交互面。
          // role/tabIndex 只在真的可点击时给：不可交互的元素若也进 Tab 序列，
          // 反而制造一串空的焦点停靠点。
          role: interactive ? 'button' : undefined,
          tabIndex: interactive ? 0 : undefined,
          // aria-label 覆盖 <title> 的命名计算，所以它必须**自带全部**信息：
          // 带上 id 是因为 label 不唯一（同名阶段节点存在），只播报 label 时
          // 屏幕阅读器用户无法区分两个同名节点。
          'aria-label': interactive ? `节点 ${label}（id ${n.id}）` : undefined,
          'data-anic-node': n.id,
          'data-anic-verdict': key ?? 'none',
          onClick: onNodeClick ? () => { onNodeClick(n); } : undefined,
          onKeyDown: onNodeClick
            ? (ev: { key: string; preventDefault: () => void }) => {
                // 只认 Enter 与 Space。两个键都 preventDefault：
                // Space 是**必需**的（否则页面跟着滚动，用户"按了按钮"同时
                // "页面跳走了"）；Enter 上没有默认行为，统一处理是为了让
                // Space 那条不会被后续重构当成冗余顺手删掉。
                if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                  ev.preventDefault();
                  onNodeClick(n);
                }
              }
            : undefined,
          style: onNodeClick ? { cursor: 'pointer' } : undefined,
        },
        createElement('title', null, label),
        createElement('circle', {
          r: nodeRadius(n.type),
          fill,
          stroke: failed ? token('anic-bad-text') : token('anic-text'),
          strokeWidth: failed ? 2 : 0.6,
          strokeDasharray: shape?.dash,
          className: failed ? 'anic-fail-node' : undefined,
        }),
        // 字形是与颜色**正交**的第二个通道：灰度打印、色盲、强制高对比模式下
        // 仍然可读。没有裁决时不画字形（画一个"无"字反而是噪声）。
        shape === undefined
          ? null
          : createElement('text', {
              x: 0, y: 2.6, fontSize: 6, textAnchor: 'middle',
              fill: token('anic-on-accent'), 'data-anic-verdict-glyph': shape.glyph,
            }, shape.glyph),
        createElement('text', { x: 9, y: 3, fontSize: 7, fill: token('anic-text') }, shortLabel(n.label)),
      ),
    );
  });

  return createElement('svg', {
    width, height,
    viewBox: `${String(minX)} ${String(minY)} ${String(width)} ${String(height)}`,
    style: { background: token('anic-surface'), fontFamily: 'monospace', display: 'block' },
  }, children);
}

// ── 辅助 ────────────────────────────────────────────────────

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
