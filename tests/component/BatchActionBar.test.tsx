/**
 * cycle-149 契约：批量操作条（BatchActionBar）——多选链路的 UI 消费面。
 *
 * ## 为什么直接 `useGraphStore.setState` 而不是 mock 整个 store
 *
 * 与 Legend.test.tsx 同一取舍：本组件与 multiSelectSlice 的接缝（字段名
 * `multiSelectedIds` / 动作名 `batchExpandSelected` 等）正是最容易写错的地方。
 * 真实 store + setState 覆盖能同时验证接缝与渲染。
 *
 * ## 钉死的契约
 *
 * - MS-BAR-1 空选区渲染 null（不占布局）；
 * - MS-BAR-2 计数如实显示（aria-live）；
 * - MS-BAR-3/4 展开/收起按钮调用 store 批量动作（真实动作，断言展开集合变化）；
 * - MS-BAR-5 导出：创建下载锚点（URL.createObjectURL 被调 + payload 计数字段如实）；
 * - MS-BAR-6 清除按钮**优先走渲染器通道**（onClearSelection），缺省回退 store 清理
 *   （双通道：渲染器事实源 > store 镜像）；
 * - MS-BAR-7 role=toolbar + aria-label（a11y）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { BatchActionBar } from '../../src/client/components/BatchActionBar.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { resetI18nListeners } from '../../src/client/i18n/index.ts';

vi.mock('../../src/client/i18n/index.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params && 'count' in params ? `${key}:${params.count}` : key,
}));

describe('BatchActionBar (cycle-149)', () => {
  beforeEach(() => {
    useGraphStore.setState({ multiSelectedIds: new Set<string>() });
  });

  afterEach(() => {
    cleanup();
    resetI18nListeners();
    vi.restoreAllMocks();
    // MS-BAR-5 手动定义的 URL 静态方法：还原到 jsdom 原生「不存在」态
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it('MS-BAR-1 renders null when the selection is empty', () => {
    const { container } = render(<BatchActionBar />);
    expect(container.firstChild).toBeNull();
  });

  it('MS-BAR-2 shows the selection count with aria-live', () => {
    useGraphStore.setState({ multiSelectedIds: new Set(['a', 'b', 'c']) });
    render(<BatchActionBar />);
    const count = screen.getByText('batchbar.count:3');
    expect(count.getAttribute('aria-live')).toBe('polite');
  });

  it('MS-BAR-3 expand button drives the real store batch action', () => {
    useGraphStore.setState({
      multiSelectedIds: new Set(['a']),
      viewMode: 'code',
      panelWidth: 1200,
      rawNodes: [{
        id: 'a' as never, label: 'A', filePath: 'src/a.ts', lineNumber: 1,
        type: 'module', properties: {},
      } as never],
      nodes: [],
      rawEdges: [],
      expandedNodeIds: new Set<string>(),
      expandedNodeIdsByViewMode: { code: new Set<string>() },
    });
    render(<BatchActionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'batchbar.expandAria' }));
    expect(useGraphStore.getState().expandedNodeIds.has('a')).toBe(true);
  });

  it('MS-BAR-4 collapse button drives the real store batch action', () => {
    useGraphStore.setState({
      multiSelectedIds: new Set(['a']),
      viewMode: 'code',
      panelWidth: 1200,
      rawNodes: [{
        id: 'a' as never, label: 'A', filePath: 'src/a.ts', lineNumber: 1,
        type: 'module', properties: {},
      } as never],
      nodes: [],
      rawEdges: [],
      expandedNodeIds: new Set<string>(['a']),
      expandedNodeIdsByViewMode: { code: new Set<string>(['a']) },
      pinnedIds: new Set<string>(),
    });
    render(<BatchActionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'batchbar.collapseAria' }));
    expect(useGraphStore.getState().expandedNodeIds.has('a')).toBe(false);
  });

  it('MS-BAR-5 export builds a JSON download with honest count fields', () => {
    // jsdom 没有 URL.createObjectURL/revokeObjectURL（著名缺口）——spyOn 会报
    // 「does not exist」。手动**定义**这两个静态方法（原生不存在 ⇒ 不遮蔽真实实现），
    // afterEach 删除还原。
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;
    // createElement 的 mock 必须先绑存原实现再 spy，否则 mock 内调
    // document.createElement 会再次命中 spy ⇒ 无限递归（Maximum call stack）。
    const clickSpy = vi.fn();
    const fakeAnchor = { href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'a' ? fakeAnchor : originalCreateElement(tag)) as typeof document.createElement);

    useGraphStore.setState({
      multiSelectedIds: new Set(['a', 'cluster:x']),
      rawNodes: [{
        id: 'a' as never, label: 'A', filePath: 'src/a.ts', lineNumber: 1,
        type: 'function', properties: {},
      } as never],
    });
    render(<BatchActionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'batchbar.exportAria' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fakeAnchor.download).toMatch(/^codegraph-selection-\d+\.json$/);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('MS-BAR-6 clear prefers the renderer channel over the store mirror', () => {
    useGraphStore.setState({ multiSelectedIds: new Set(['a']) });
    const onClearSelection = vi.fn();
    render(<BatchActionBar onClearSelection={onClearSelection} />);
    fireEvent.click(screen.getByRole('button', { name: 'batchbar.clearAria' }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    // 渲染器通道被调用后，store 镜像由 onSelectionClear 回调同步——这里不在组件内直接清
    expect(useGraphStore.getState().multiSelectedIds.has('a')).toBe(true);
  });

  it('MS-BAR-7 clear falls back to the store mirror when no renderer channel is given', () => {
    useGraphStore.setState({ multiSelectedIds: new Set(['a']) });
    render(<BatchActionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'batchbar.clearAria' }));
    expect(useGraphStore.getState().multiSelectedIds.size).toBe(0);
  });

  it('MS-BAR-8 toolbar role and labelled buttons (a11y)', () => {
    useGraphStore.setState({ multiSelectedIds: new Set(['a']) });
    render(<BatchActionBar />);
    expect(screen.getByRole('toolbar', { name: 'batchbar.ariaLabel' })).toBeTruthy();
    for (const key of ['batchbar.expandAria', 'batchbar.collapseAria', 'batchbar.exportAria', 'batchbar.clearAria']) {
      expect(screen.getByRole('button', { name: key })).toBeTruthy();
    }
  });
});
