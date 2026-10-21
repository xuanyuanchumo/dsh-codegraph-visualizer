// 旅程覆盖：J19（FR-24 版本对比——编排 hook 的生命周期/令牌/重放）。
// @vitest-environment jsdom
/**
 * `useDiffComparison` 的单元测试（cycle-104，研究报告 §六 #13）。
 *
 * 这一层的职责是**编排**，因此用例集中在那四条会静默出错的契约上：
 *   1. 失败与「空 diff」必须可区分（失败不得清掉上一次结果）；
 *   2. 关闭面板必须清画布标记（否则用户看到无法解释的彩色边框）；
 *   3. 慢的旧请求不得覆盖新结果（请求归属令牌）；
 *   4. 图替换后必须重放标记（渲染器重建元素会丢掉 class）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { mockFetchGraphDiff } = vi.hoisted(() => ({
  mockFetchGraphDiff: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchGraphDiff: mockFetchGraphDiff,
}));

import { useDiffComparison } from '../../../src/client/hooks/useDiffComparison.ts';
import { useGraphStore } from '../../../src/client/store/graphStore.ts';
import type { DiffState } from '../../../src/client/store/types.ts';
import { buildDiffIndex } from '../../../src/shared/diffStatus.ts';
import { NodeId } from '../../../src/types/index.ts';

function makeDiffPayload(from: string, to: string) {
  return {
    from,
    to,
    nodes: [
      { id: NodeId('n1'), label: 'A', type: 'function' as const, filePath: 'a.ts', lineNumber: 1, properties: { diffStatus: 'added' } },
      { id: NodeId('n2'), label: 'B', type: 'function' as const, filePath: 'a.ts', lineNumber: 2, properties: { diffStatus: 'removed' } },
    ],
    edges: [],
  };
}

/** 渲染器替身：记录调用，返回可控统计。 */
function makeRenderer(stats = { counts: { added: 1, modified: 0, removed: 1 }, missing: 0, marked: 2 }) {
  return {
    applyDiffMarkers: vi.fn(() => stats),
    clearDiffMarkers: vi.fn(),
  };
}

beforeEach(() => {
  mockFetchGraphDiff.mockReset();
  useGraphStore.setState({ diffResult: null, lastUpdated: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDiffComparison', () => {
  it('stores the diff and marks the canvas on success', async () => {
    mockFetchGraphDiff.mockResolvedValue(makeDiffPayload('main', 'feature'));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };

    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));

    await act(async () => { await result.current.compare('main', 'feature'); });

    const stored = useGraphStore.getState().diffResult;
    expect(stored).not.toBeNull();
    expect(stored!.from).toBe('main');
    expect(stored!.to).toBe('feature');
    // index 必须已经算好（DiffState 的契约），面板与渲染器都直接用它
    expect(stored!.index.nodes.added.has('n1')).toBe(true);
    expect(stored!.index.nodes.removed.has('n2')).toBe(true);

    await waitFor(() => expect(renderer.applyDiffMarkers).toHaveBeenCalled());
    expect(result.current.markStats).toEqual({ counts: { added: 1, modified: 0, removed: 1 }, missing: 0, marked: 2 });
  });

  it('reports an error and keeps the previous result when the request fails', async () => {
    // 第一次成功
    mockFetchGraphDiff.mockResolvedValueOnce(makeDiffPayload('a', 'b'));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));
    await act(async () => { await result.current.compare('a', 'b'); });
    const first = useGraphStore.getState().diffResult;
    expect(first).not.toBeNull();

    // 挂载时 `diffResult` 为 null，effect 会调用一次 clearDiffMarkers（幂等、无害）。
    // 这里关心的是「失败之后有没有**新增**一次清除」，所以先记录基线调用数。
    const clearsBeforeFailure = renderer.clearDiffMarkers.mock.calls.length;

    // 第二次失败（fetchGraphDiff 返回 null 表示失败）
    mockFetchGraphDiff.mockResolvedValueOnce(null);
    await act(async () => { await result.current.compare('c', 'd'); });

    expect(result.current.error).toBeTruthy();
    // 关键：失败不得把上一次结果清成空——那会显示成「0 处变更」
    expect(useGraphStore.getState().diffResult).toEqual(first);
    // 也不得清掉画布上的标记（否则用户会看到结果还在面板里、标记却全消失了）
    expect(renderer.clearDiffMarkers.mock.calls.length).toBe(clearsBeforeFailure);
  });

  it('clears store, markers and stats on clear()', async () => {
    mockFetchGraphDiff.mockResolvedValue(makeDiffPayload('a', 'b'));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));
    await act(async () => { await result.current.compare('a', 'b'); });
    expect(useGraphStore.getState().diffResult).not.toBeNull();

    act(() => { result.current.clear(); });

    expect(useGraphStore.getState().diffResult).toBeNull();
    expect(renderer.clearDiffMarkers).toHaveBeenCalled();
    expect(result.current.markStats).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('clears the canvas markers when the panel is disabled', async () => {
    mockFetchGraphDiff.mockResolvedValue(makeDiffPayload('a', 'b'));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDiffComparison({ enabled, rendererRef, workspace: '.' }),
      { initialProps: { enabled: true } },
    );
    await act(async () => { await result.current.compare('a', 'b'); });
    expect(renderer.applyDiffMarkers).toHaveBeenCalled();

    renderer.clearDiffMarkers.mockClear();
    rerender({ enabled: false });

    // 面板关闭 → 标记必须消失，但 store 里的结果保留（用户可能只是收起了面板）
    await waitFor(() => expect(renderer.clearDiffMarkers).toHaveBeenCalled());
    expect(useGraphStore.getState().diffResult).not.toBeNull();
  });

  it('ignores a stale response from an earlier request', async () => {
    // 慢的旧请求回来时不得覆盖新结果：请求归属由 generation 令牌决定，
    // 而不是由「谁先返回」决定（同族约束见 astRequestSeq / edgeRequestSeq）。
    let resolveSlow: ((v: unknown) => void) | null = null;
    const slow = new Promise((resolve) => { resolveSlow = resolve; });
    mockFetchGraphDiff
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(makeDiffPayload('new', 'ref'));

    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));

    // 先发慢请求（不 await），再发快请求
    let slowPromise: Promise<DiffState | null> = Promise.resolve(null);
    act(() => { slowPromise = result.current.compare('slow', 'one'); });
    await act(async () => { await result.current.compare('new', 'ref'); });

    // 现在让慢请求返回旧数据
    await act(async () => {
      resolveSlow?.(makeDiffPayload('slow', 'one'));
      await slowPromise;
    });

    const stored = useGraphStore.getState().diffResult;
    expect(stored!.from).toBe('new');
    expect(stored!.to).toBe('ref');
  });

  it('re-applies markers when the graph revision changes', async () => {
    // useGraphRenderer 在 nodes 变化时重建 cytoscape 元素，class 会全部丢失。
    // 这里用 lastUpdated（每次整图替换/增量补丁都会前进）模拟那件事。
    mockFetchGraphDiff.mockResolvedValue(makeDiffPayload('a', 'b'));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));
    await act(async () => { await result.current.compare('a', 'b'); });

    await waitFor(() => expect(renderer.applyDiffMarkers).toHaveBeenCalledTimes(1));

    act(() => { useGraphStore.setState({ lastUpdated: Date.now() + 1000 }); });

    await waitFor(() => expect(renderer.applyDiffMarkers).toHaveBeenCalledTimes(2));
  });

  it('does nothing when the renderer is not ready yet', async () => {
    mockFetchGraphDiff.mockResolvedValue(makeDiffPayload('a', 'b'));
    const rendererRef = { current: null as ReturnType<typeof makeRenderer> | null };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));

    await act(async () => { await result.current.compare('a', 'b'); });

    // 结果仍然落库（面板能显示），只是画布还没准备好
    expect(useGraphStore.getState().diffResult).not.toBeNull();
    expect(result.current.markStats).toBeNull();
  });

  it('sets isComparing around the request', async () => {
    let resolveRequest: ((v: unknown) => void) | null = null;
    mockFetchGraphDiff.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));

    let pending: Promise<DiffState | null> = Promise.resolve(null);
    act(() => { pending = result.current.compare('a', 'b'); });
    await waitFor(() => expect(result.current.isComparing).toBe(true));

    await act(async () => {
      resolveRequest?.(makeDiffPayload('a', 'b'));
      await pending;
    });
    expect(result.current.isComparing).toBe(false);
  });

  it('passes the workspace through to the request', async () => {
    mockFetchGraphDiff.mockResolvedValue(makeDiffPayload('a', 'b'));
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: 'D:/repo' }));

    await act(async () => { await result.current.compare('a', 'b'); });

    expect(mockFetchGraphDiff).toHaveBeenCalledWith('a', 'b', undefined, 'D:/repo');
  });

  it('builds an index that matches buildDiffIndex on the same payload', async () => {
    // 防止 hook 里出现第二份索引实现（那样会与 shared 版本静默漂移）
    const payload = makeDiffPayload('a', 'b');
    mockFetchGraphDiff.mockResolvedValue(payload);
    const renderer = makeRenderer();
    const rendererRef = { current: renderer };
    const { result } = renderHook(() =>
      useDiffComparison({ enabled: true, rendererRef, workspace: '.' }));
    await act(async () => { await result.current.compare('a', 'b'); });

    const expected = buildDiffIndex(payload.nodes, payload.edges);
    const stored = useGraphStore.getState().diffResult!;
    expect([...stored.index.nodes.added]).toEqual([...expected.nodes.added]);
    expect([...stored.index.nodes.removed]).toEqual([...expected.nodes.removed]);
    expect([...stored.index.edges.added]).toEqual([...expected.edges.added]);
  });
});
