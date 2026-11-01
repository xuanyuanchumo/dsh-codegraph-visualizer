/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSearchInteraction } from '../../../src/client/hooks/useSearchInteraction.ts';
import { logger } from '../../../src/shared/Logger.ts';
import { NodeId, type GraphNode } from '../../../src/types/index.ts';

const nodeData: GraphNode = {
  id: NodeId('n1'),
  label: 'loadGraph',
  type: 'function',
  filePath: '/src/graph.ts',
  properties: {},
};

function mount(getData: Record<string, unknown> | null) {
  const setSelectedNode = vi.fn();
  const setSelectedNodeData = vi.fn();
  const setShowSearch = vi.fn();
  const getDataRef = { current: getData as never };
  const { result } = renderHook(() =>
    useSearchInteraction({
      searchQuery: '',
      rawNodes: [],
      setSelectedNode,
      setSelectedNodeData,
      getDataRef,
      setShowSearch,
    }),
  );
  return { result, setSelectedNode, setSelectedNodeData, setShowSearch };
}

describe('useSearchInteraction.handleSelectSearchResult', () => {
  beforeEach(() => {
    logger.clear();
  });

  it('selects the result, reveals it in the graph and closes the search panel', () => {
    const revealNode = vi.fn(() => true);
    const { result, setSelectedNode, setSelectedNodeData, setShowSearch } = mount({
      getNodeData: vi.fn(() => nodeData),
      revealNode,
    });

    result.current.handleSelectSearchResult('n1');

    expect(setSelectedNode).toHaveBeenCalledWith(NodeId('n1'));
    expect(setSelectedNodeData).toHaveBeenCalledWith(nodeData);
    expect(revealNode).toHaveBeenCalledWith('n1');
    expect(setShowSearch).toHaveBeenCalledWith(false);
    expect(logger.entries().filter((e) => e.level === 'warn')).toHaveLength(0);
  });

  it('warns when the result is not revealable but still selects and closes', () => {
    const revealNode = vi.fn(() => false);
    const { result, setSelectedNode, setShowSearch } = mount({
      getNodeData: vi.fn(() => nodeData),
      revealNode,
    });

    result.current.handleSelectSearchResult('n1');

    expect(setSelectedNode).toHaveBeenCalledWith(NodeId('n1'));
    expect(setShowSearch).toHaveBeenCalledWith(false);
    const warned = logger.entries().filter((e) => e.level === 'warn' && e.scope === 'panel');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('not revealable');
  });

  it('tolerates an unset renderer handle', () => {
    const { result, setSelectedNodeData, setShowSearch } = mount(null);

    expect(() => result.current.handleSelectSearchResult('n1')).not.toThrow();
    expect(setSelectedNodeData).toHaveBeenCalledWith(null);
    expect(setShowSearch).toHaveBeenCalledWith(false);
  });

  it('logs instead of throwing when the renderer lookup fails', () => {
    const { result } = mount({
      getNodeData: vi.fn(() => { throw new Error('boom'); }),
      revealNode: vi.fn(() => true),
    });

    expect(() => result.current.handleSelectSearchResult('n1')).not.toThrow();
    const errored = logger.entries().filter((e) => e.level === 'error' && e.scope === 'panel');
    expect(errored).toHaveLength(1);
    expect(errored[0]?.message).toContain('handleSelectSearchResult failed');
  });
});

describe('useSearchInteraction remote 回退命中（cycle-132）', () => {
  // fetchKeywordQuery 走 fetchWithTimeout —— jsdom 下 mock 全局 fetch。
  function mockQuerySeeds(seeds: Array<{ id: string; label: string; score?: number; matchedTerms?: string[] }>) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['etag', 'W/"t"']]),
      json: async () => ({
        query: 'q', terms: ['q'], seeds, nodes: [], edges: [],
        text: '', tokens: 1, truncated: false, reason: 'fits',
        meta: { depth: 0, depthEffective: 0, tokenBudget: 800, source: 'slot', revision: 1, reason: 'fits' },
      }),
    }));
  }

  it('本地零命中时回退 /query：mergedResults 带 remote:true（字段必须到达渲染层）', async () => {
    vi.useFakeTimers();
    try {
      mockQuerySeeds([{ id: 'r1', label: 'skillClosure', score: 100, matchedTerms: ['skill'] }]);
      const { result } = renderHook(() =>
        useSearchInteraction({
          searchQuery: 'skillclosure',
          rawNodes: [],
          setSelectedNode: vi.fn(),
          setSelectedNodeData: vi.fn(),
          getDataRef: { current: null },
          setShowSearch: vi.fn(),
        }),
      );
      await vi.advanceTimersByTimeAsync(400); // SEARCH_DEBOUNCE_MS + 微任务排空
      // 决定性断言：remote 字段必须在 mergedResults 里——此前接口缺字段被 TS 静默丢弃，
      // 徽标从未渲染；这条用例钉住「写入 → 渲染层可见」全链路。
      await vi.waitFor(() => {
        expect(result.current.searchResults).toEqual([
          expect.objectContaining({ id: 'r1', remote: true }),
        ]);
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('useSearchInteraction remote 点击链路（cycle-133）', () => {
  it('remote 命中项点击走 revealRemoteNode，不走本地 getNodeData/revealNode', () => {
    const revealRemoteNode = vi.fn().mockResolvedValue(true);
    const revealNode = vi.fn(() => true);
    const getNodeData = vi.fn(() => nodeData);
    const setShowSearch = vi.fn();
    const isRemoteHit = vi.fn((id: string) => id === 'r1');
    const { result } = renderHook(() =>
      useSearchInteraction({
        searchQuery: 'q',
        rawNodes: [],
        setSelectedNode: vi.fn(),
        setSelectedNodeData: vi.fn(),
        getDataRef: { current: { getNodeData, revealNode, revealRemoteNode } as never },
        setShowSearch,
        isRemoteHit,
      }),
    );

    result.current.handleSelectSearchResult('r1');

    expect(isRemoteHit).toHaveBeenCalledWith('r1');
    // 第二参 = 查询词 label（结果项 label 缺省落到 id）。
    expect(revealRemoteNode).toHaveBeenCalledWith('r1', 'r1');
    // 面板先关（用户意图已表达，合并是异步的）。
    expect(setShowSearch).toHaveBeenCalledWith(false);
    // 本地路径完全不走。
    expect(getNodeData).not.toHaveBeenCalled();
    expect(revealNode).not.toHaveBeenCalled();
  });

  it('本地命中项点击路径不变（getNodeData + revealNode，零 revealRemoteNode 调用）', () => {
    const revealRemoteNode = vi.fn().mockResolvedValue(true);
    const revealNode = vi.fn(() => true);
    const getNodeData = vi.fn(() => nodeData);
    const setSelectedNode = vi.fn();
    const setShowSearch = vi.fn();
    const { result } = renderHook(() =>
      useSearchInteraction({
        searchQuery: 'q',
        rawNodes: [],
        setSelectedNode,
        setSelectedNodeData: vi.fn(),
        getDataRef: { current: { getNodeData, revealNode, revealRemoteNode } as never },
        setShowSearch,
        isRemoteHit: () => false,
      }),
    );

    result.current.handleSelectSearchResult('n1');

    expect(setSelectedNode).toHaveBeenCalledWith(NodeId('n1'));
    expect(revealNode).toHaveBeenCalledWith('n1');
    expect(revealRemoteNode).not.toHaveBeenCalled();
    expect(setShowSearch).toHaveBeenCalledWith(false);
  });

  it('remote 合并失败（false）时记 warn 且不抛错', async () => {
    const revealRemoteNode = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useSearchInteraction({
        searchQuery: 'q',
        rawNodes: [],
        setSelectedNode: vi.fn(),
        setSelectedNodeData: vi.fn(),
        getDataRef: { current: { getNodeData: vi.fn(), revealNode: vi.fn(() => true), revealRemoteNode } as never },
        setShowSearch: vi.fn(),
        isRemoteHit: () => true,
      }),
    );

    expect(() => result.current.handleSelectSearchResult('ghost')).not.toThrow();
    await vi.waitFor(() => {
      const warned = logger.entries().filter((e) => e.level === 'warn' && e.scope === 'panel');
      expect(warned.some((e) => e.message.includes('could not be revealed'))).toBe(true);
    });
  });
});

describe('useSearchInteraction remote label 闭包契约（cycle-133 防回归）', () => {
  // 缺陷实录：handleSelectSearchResult 的闭包捕获的是本地 searchResults（本地零命中
  // 时为空数组），而 UI 渲染的是 mergedResults——remote 项的 label 查找永远落空，
  // revealRemoteNode 收到 label=id，/query 以 id 查询零命中，合并失败（点了没反应）。
  // 本用例钉住：remote 项点击必须把**结果项的 label**（非 id）传给 revealRemoteNode。
  it('remote 项点击把 mergedResults 里该项的 label（非 id）作为查询词传入', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Map([['etag', 'W/"t"']]),
      json: async () => ({
        query: 'codegraph', terms: ['codegraph'],
        seeds: [{ id: 'r9', label: 'CodeGraphAdapter', score: 100, matchedTerms: ['codegraph'] }],
        nodes: [], edges: [], text: '', tokens: 1, truncated: false, reason: 'fits',
        meta: { depth: 0, depthEffective: 0, tokenBudget: 800, source: 'slot', revision: 1, reason: 'fits' },
      }),
    }));
    const revealRemoteNode = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useSearchInteraction({
        searchQuery: 'codegraph',
        rawNodes: [], // 本地零命中 ⇒ mergedResults = remoteHits
        setSelectedNode: vi.fn(),
        setSelectedNodeData: vi.fn(),
        getDataRef: { current: { getNodeData: vi.fn(), revealNode: vi.fn(() => true), revealRemoteNode } as never },
        setShowSearch: vi.fn(),
        isRemoteHit: () => true,
      }),
    );
    return vi.waitFor(() => {
      expect(result.current.searchResults.length).toBe(1);
      result.current.handleSelectSearchResult('r9');
      expect(revealRemoteNode).toHaveBeenCalledWith('r9', 'CodeGraphAdapter');
    });
  });
});
