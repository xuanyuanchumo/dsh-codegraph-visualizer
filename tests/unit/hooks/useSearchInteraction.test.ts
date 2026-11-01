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
