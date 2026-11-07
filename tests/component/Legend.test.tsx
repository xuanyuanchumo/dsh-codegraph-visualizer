/**
 * T146-4 契约：图例（Legend）交互化——点击类型行切换可见性（cycle-146）。
 *
 * ## 为什么直接 `useGraphStore.setState` 而不是 mock 整个 store
 *
 * 与 `KeywordQueryPanel.test.tsx` 同一取舍：图例与 filterSlice 的接缝（字段名
 * `visibleNodeTypes` / 动作名 `setVisibleNodeTypes`）正是最容易写错的地方。真实
 * store + setState 覆盖能同时验证接缝与渲染；mock 掉整个 store 会让接缝缺陷变成
 * `undefined` 静默渲染。
 *
 * ## 钉死的三条契约
 *
 * ① 点击行 ⇄ 该类型在 `visibleNodeTypes` 中被切换（FilterController 消费同一集合）；
 * ② **防呆**：最后一个可见类型不可关闭（画布全空且无行可点回的单点故障）；
 * ③ 视觉状态：隐藏行的 `aria-pressed=false` + `cg-legend-row-hidden` 类。
 *
 * 反自我反证：③ 若无 ① 的行为断言守护，一个「只改样式不切状态」的实现会全绿。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { Legend } from '../../src/client/components/Legend.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { resetI18nListeners } from '../../src/client/i18n/index.ts';

vi.mock('../../src/client/i18n/index.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useT: () => (key: string) => key,
}));

describe('Legend interactive toggles (cycle-146 T146-4)', () => {
  beforeEach(() => {
    // 重置 filterSlice 两个集合到默认全集
    useGraphStore.setState({
      visibleNodeTypes: new Set(['function', 'class', 'variable', 'module', 'interface']),
      visibleEdgeTypes: new Set(['call', 'extend', 'implement', 'import', 'dependency', 'contains']),
    });
  });

  afterEach(() => {
    cleanup();
    resetI18nListeners();
    vi.clearAllMocks();
  });

  it('LG-1 clicking a visible node type row hides it in the store', () => {
    render(<Legend viewMode="code" onClose={() => {}} />);
    const row = screen.getByRole('button', { pressed: true, name: /legend\.function/ });
    fireEvent.click(row);
    const visible = useGraphStore.getState().visibleNodeTypes as Set<string>;
    expect(visible.has('function')).toBe(false);
    expect(visible.has('class')).toBe(true); // 其他类型不受影响
  });

  it('LG-2 clicking a hidden node type row shows it again', () => {
    // function 初始**不在**可见集（隐藏态）→ 点击后应重新可见
    useGraphStore.setState({ visibleNodeTypes: new Set(['class']) });
    render(<Legend viewMode="code" onClose={() => {}} />);
    const row = screen.getByRole('button', { pressed: false, name: /legend\.function/ });
    fireEvent.click(row);
    const visible = useGraphStore.getState().visibleNodeTypes as Set<string>;
    expect(visible.has('function')).toBe(true);
  });

  it('LG-3 the LAST visible node type cannot be turned off (single-point-of-failure guard)', () => {
    useGraphStore.setState({ visibleNodeTypes: new Set(['function']) });
    render(<Legend viewMode="code" onClose={() => {}} />);
    const row = screen.getByRole('button', { pressed: true, name: /legend\.function/ });
    fireEvent.click(row);
    const visible = useGraphStore.getState().visibleNodeTypes as Set<string>;
    expect(visible.has('function')).toBe(true); // 不允许清空
  });

  it('LG-4 the LAST visible edge type cannot be turned off either', () => {
    useGraphStore.setState({ visibleEdgeTypes: new Set(['call']) });
    render(<Legend viewMode="callgraph" onClose={() => {}} />);
    const row = screen.getByRole('button', { pressed: true, name: /legend\.call/ });
    fireEvent.click(row);
    const visible = useGraphStore.getState().visibleEdgeTypes as Set<string>;
    expect(visible.has('call')).toBe(true);
  });

  it('LG-5 hidden row carries the visual state: aria-pressed=false + hidden class', () => {
    useGraphStore.setState({ visibleNodeTypes: new Set(['class']) });
    const { container } = render(<Legend viewMode="code" onClose={() => {}} />);
    const hiddenRow = screen.getByRole('button', { pressed: false, name: /legend\.function/ });
    expect(hiddenRow.className).toContain('cg-legend-row-hidden');
    const visibleRow = screen.getByRole('button', { pressed: true, name: /legend\.class/ });
    expect(visibleRow.className).not.toContain('cg-legend-row-hidden');
    // 自我反证：容器里必须真的有图例行，否则选择器失效会让本套全绿
    expect(container.querySelectorAll('button.cg-legend-toggle').length).toBeGreaterThanOrEqual(6);
  });

  it('LG-6 viewMode=runtime renders zero toggle rows (runtime layer has no graph subgraph)', () => {
    const { container } = render(<Legend viewMode="runtime" onClose={() => {}} />);
    expect(container.querySelectorAll('button.cg-legend-toggle').length).toBe(0);
  });
});
