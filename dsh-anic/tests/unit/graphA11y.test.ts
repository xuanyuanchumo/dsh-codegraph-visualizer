/**
 * 图区可访问性契约（P2-A11Y-KEY / P2-A11Y-COLOR 回归）。
 *
 * 契约来源：
 *   - 调用点 `dsh-anic/src/client/WorkflowGraphPanel.ts:148`
 *     `renderGraph(data, buildVerdicts(trace), (n) => { setSelectedNode(…) })`
 *   - 渲染器 `dsh-anic/src/client/features/graph/renderGraph.ts`
 *   - 填色别名表 `dsh-anic/src/client/features/graph/gateColors.ts` 的 `gateFillOf`
 *
 * 两类缺陷，都**不可能被既有测试发现**：
 *
 * 1. **键盘不可达**。节点只挂 `onClick`，SVG `g` 默认不可聚焦 ⇒ Tab 永远到不了、
 *    Enter/Space 无反应。既有测试断言"圆点数量""点击回调被调用"，两条在纯鼠标
 *    交互面上都成立。
 * 2. **颜色是唯一通道**。裁决只靠 `fill` 表达（PASS 绿 / FAIL 红）⇒ 红绿色盲
 *    用户完全无法区分，而圆点照常存在、颜色照常"正确"。WCAG 1.4.1 要求颜色
 *    不得是唯一视觉手段。
 *
 * 本文件直接遍历 React 元素树（不经 DOM），因为要断言的正是**属性与处理器**
 * 本身；`renderToStaticMarkup` 会丢掉 `onKeyDown`，无法验证键盘行为。
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderGraph, verdictKey, type GraphData } from '../../src/client/features/graph/renderGraph.ts';
import { gateFillOf, gateTextColorOf } from '../../src/client/features/graph/gateColors.ts';

const DATA: GraphData = {
  nodes: [
    { id: 'wf:plan', type: 'phase', label: 'Plan（规划）', x: 0, y: 0 },
    { id: 'g0', type: 'gate', label: 'G0 评估收敛门', x: 10, y: 20 },
    { id: 'g1', type: 'gate', label: 'G1 任务完备门', x: 30, y: 20 },
    { id: 'g2', type: 'gate', label: 'G2 交付证据门', x: 50, y: 20 },
    { id: 'g3', type: 'gate', label: 'G3 收口门', x: 70, y: 20 },
    { id: 'd0', type: 'gate', label: '存疑门', x: 90, y: 20 },
  ],
  edges: [{ from: 'wf:plan', to: 'g0' }],
};

const VERDICTS = new Map<string, string>([
  ['g0', 'PASS'],
  ['g1', 'FAIL'],
  ['g2', 'doubt'],
  ['g3', 'pending'],
  ['d0', 'skip'],
]);

/** 元素树遍历：返回所有满足 predicate 的节点 props（函数组件不展开，本渲染器是纯 createElement）。 */
function collect(
  node: unknown,
  pred: (type: unknown, props: Record<string, unknown>) => boolean,
  out: Record<string, unknown>[] = [],
  depth = 0,
): Record<string, unknown>[] {
  if (node === null || node === undefined || typeof node !== 'object' || depth > 30) return out;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, pred, out, depth + 1);
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const props = el.props ?? {};
  if (pred(el.type, props)) out.push(props);
  const children = props.children;
  if (Array.isArray(children)) for (const c of children) collect(c, pred, out, depth + 1);
  else if (children !== undefined) collect(children, pred, out, depth + 1);
  return out;
}

const nodeGroups = (withClick: boolean) =>
  collect(
    withClick ? renderGraph(DATA, VERDICTS, () => {}) : renderGraph(DATA, VERDICTS),
    (t, p) => t === 'g' && typeof p['data-anic-node'] === 'string',
  );

describe('图区键盘可达性（P2-A11Y-KEY）', () => {
  it('每个可点击节点都是 role=button + tabIndex=0 + aria-label', () => {
    const groups = nodeGroups(true);
    expect(groups.length).toBe(DATA.nodes.length);
    for (const g of groups) {
      expect(g.role).toBe('button');
      expect(g.tabIndex).toBe(0);
      // aria-label 必须带节点身份，否则屏幕阅读器只播报"按钮"
      expect(String(g['aria-label'])).toContain(String(g['data-anic-node']));
    }
  });

  it('Enter 触发节点点击回调', () => {
    const onNodeClick = vi.fn();
    const groups = collect(renderGraph(DATA, VERDICTS, onNodeClick), (t) => t === 'g');
    const first = groups.find((g) => g['data-anic-node'] === 'wf:plan');
    expect(first).toBeDefined();
    const preventDefault = vi.fn();
    (first?.onKeyDown as (e: unknown) => void)({ key: 'Enter', preventDefault });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]?.[0]).toMatchObject({ id: 'wf:plan' });
    // 激活键统一 preventDefault：本条契约是"激活键不得再执行浏览器默认行为"。
    // Enter 在 g[role=button] 上没有默认行为，所以这一步是 no-op —— 但**统一**
    // 处理让 Space 那条必需项不会被后续重构顺手删掉。
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Space 触发点击且必须 preventDefault（否则页面同时滚动）', () => {
    const onNodeClick = vi.fn();
    const groups = collect(renderGraph(DATA, VERDICTS, onNodeClick), (t) => t === 'g');
    const first = groups.find((g) => g['data-anic-node'] === 'g1');
    const preventDefault = vi.fn();
    (first?.onKeyDown as (e: unknown) => void)({ key: ' ', preventDefault });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]?.[0]).toMatchObject({ id: 'g1' });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('其它按键不触发回调（Tab/箭头不得被吃掉，否则键盘无法离开图区）', () => {
    const onNodeClick = vi.fn();
    const groups = collect(renderGraph(DATA, VERDICTS, onNodeClick), (t) => t === 'g');
    const first = groups.find((g) => g['data-anic-node'] === 'wf:plan');
    const handler = first?.onKeyDown as (e: unknown) => void;
    for (const key of ['Tab', 'ArrowRight', 'Escape', 'a']) {
      handler({ key, preventDefault: vi.fn() });
    }
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('不可点击时不得进入 Tab 序列（空焦点停靠点）', () => {
    const groups = nodeGroups(false);
    expect(groups.length).toBe(DATA.nodes.length);
    for (const g of groups) {
      expect(g.role).toBeUndefined();
      expect(g.tabIndex).toBeUndefined();
      expect(g.onKeyDown).toBeUndefined();
    }
  });
});

describe('裁决的非颜色通道（P2-A11Y-COLOR）', () => {
  it('每个有裁决的节点都带字形，且 PASS 与 FAIL 字形不同', () => {
    const html = renderToStaticMarkup(renderGraph(DATA, VERDICTS, () => {}));
    // 五种裁决各自出现一次
    for (const glyph of ['✓', '✕', '?', '·', '–']) {
      expect(html).toContain(glyph);
    }
    // 反向：颜色以外必须还有通道 —— 若只靠 fill，字形集合是空的
    expect(html).toContain('data-anic-verdict');
  });

  it('PASS 与 FAIL 在线型上可区分（色盲下仍可辨）', () => {
    // 圆点本身不带 data-anic-verdict（那是 g 上的），所以按渲染顺序对齐：
    // 节点顺序 = DATA.nodes 顺序，circle 也按此顺序 push。
    const groups = nodeGroups(true);
    const verdictsOfNodes = groups.map((g) => g['data-anic-verdict']);
    expect(verdictsOfNodes.slice(0, 6)).toEqual(['none', 'pass', 'fail', 'doubt', 'pending', 'skip']);

    const circles = collect(renderGraph(DATA, VERDICTS, () => {}), (t) => t === 'circle');
    expect(circles.length).toBe(DATA.nodes.length);
    const dashOf = (idx: number) => circles[idx]?.strokeDasharray;
    // PASS（idx 1）实线；FAIL（idx 2）虚线 —— 两者必须在**颜色以外**可分
    expect(dashOf(1)).toBeUndefined();
    expect(dashOf(2)).toBe('2 1.4');
    expect(dashOf(1)).not.toBe(dashOf(2));
    // 五种裁决的线型两两不同（否则两种状态看起来一样）
    const dashes = [dashOf(1), dashOf(2), dashOf(3), dashOf(4), dashOf(5)];
    expect(new Set(dashes).size).toBe(dashes.length);
  });

  it('data-anic-verdict 逐节点可读（DOM 可断言的状态，不只是颜色）', () => {
    const groups = nodeGroups(true);
    const byId = new Map(groups.map((g) => [String(g['data-anic-node']), g['data-anic-verdict']]));
    expect(byId.get('g0')).toBe('pass');
    expect(byId.get('g1')).toBe('fail');
    expect(byId.get('g2')).toBe('doubt');
    expect(byId.get('g3')).toBe('pending');
    expect(byId.get('d0')).toBe('skip');
    expect(byId.get('wf:plan')).toBe('none');
  });

  it('三个裁决消费面（填色/线型/文本）必须逐别名一致（否则绿圆配虚线，自相矛盾）', () => {
    // 别名归一化已收敛到 gateColors.ts 的 canonicalVerdict（唯一事实来源），
    // verdictKey 是它的转出口。本断言的价值从"对账两份活表"变成**防重新分叉**：
    // 谁要是把某个消费面改回自带别名表（比如只给 fill 加了 'REJECT' 大写），
    // 这条立刻红——而任何行为测试都不会红。
    const aliases = ['PASS', 'pass', 'approve', 'FAIL', 'fail', 'reject', 'doubt', 'pending', 'skip', 'skipped', 'unknown', ''];
    for (const a of aliases) {
      const hasFill = gateFillOf(a) !== null;
      const hasShape = verdictKey(a) !== null;
      const hasText = gateTextColorOf(a) !== null;
      expect([a, hasShape, hasText]).toEqual([a, hasFill, hasFill]);
    }
    // 文本色还必须真的分了档：pass ≠ fail ≠ doubt ≠ pending（pending/skip 同为
    // 信息档 text-dim，可相等）。若三色退化为同一值，"result: PASS"的语义加粗
    // 就只是加粗，颜色通道整体失效。
    expect(gateTextColorOf('pass')).not.toBe(gateTextColorOf('fail'));
    expect(gateTextColorOf('fail')).not.toBe(gateTextColorOf('doubt'));
    expect(gateTextColorOf('pass')).not.toBe(gateTextColorOf('doubt'));
    // 且文本色与填充色是不同令牌：文本侧取 ≥4.5 档，填充侧取 ≥3.3 档
    expect(gateTextColorOf('pass')).not.toBe(gateFillOf('pass'));
  });

  it('反向自检：别名一致性断言真的能发现漂移', () => {
    // 造一个"只在填色表里存在"的别名：verdictKey 返回 null 而 gateFillOf 不返回 null
    // 这里用一个受控替身验证判定式本身有效
    const shape = (v: string) => (v === 'pass' ? 'pass' : null);
    const fill = (v: string) => (v === 'pass' || v === 'approve' ? '#22c55e' : null);
    const drifted = ['pass', 'approve'].some((a) => (shape(a) !== null) !== (fill(a) !== null));
    expect(drifted).toBe(true); // approve 只在 fill 表里 ⇒ 判定式能发现
  });
});
