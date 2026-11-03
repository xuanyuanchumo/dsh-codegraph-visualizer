/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getState: vi.fn(),
    loadBootstrap: vi.fn(),
    clearGraph: vi.fn(),
  },
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: mocks.getState },
}));

import { useWorkspaceCache } from '../../../src/client/hooks/useWorkspaceCache.ts';
import type { GraphNode, GraphEdge } from '../../../src/types/index.ts';

function makeNode(id: string): GraphNode {
  return { id: `file:${id}.ts` as any, label: id, type: 'file', filePath: `/src/${id}.ts`, properties: {} };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return { id: `${source}->${target}` as any, source, target, type: 'call', properties: {} };
}

function createCache() {
  const store = new Map<string, { nodes: GraphNode[]; edges: GraphEdge[] }>();
  return {
    getCachedData: (ws: string) => store.get(ws) ?? null,
    cacheData: (ws: string, nodes: GraphNode[], edges: GraphEdge[]) => {
      store.set(ws, { nodes, edges });
    },
  };
}

const setGraphData = vi.fn();

describe('useWorkspaceCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadBootstrap.mockResolvedValue(true);
    mocks.clearGraph.mockImplementation(() => undefined);
    mocks.getState.mockReturnValue({
      loadBootstrap: mocks.loadBootstrap,
      clearGraph: mocks.clearGraph,
    });
  });

  it('缓存命中 ⇒ 立即 setGraphData（同步切换）', () => {
    const cache = createCache();
    const nodes = [makeNode('a')];
    const edges = [makeEdge('e1', 'a', 'b')];
    cache.cacheData('/ws-b', nodes, edges);

    const { rerender } = renderHook(({ ws }: { ws: string }) =>
      useWorkspaceCache({
        currentWorkspace: ws,
        rawNodes: [],
        rawEdges: [],
        graphCache: cache,
        setGraphData,
      }),
      { initialProps: { ws: '/ws-a' } }
    );

    act(() => rerender({ ws: '/ws-b' }));

    expect(setGraphData).toHaveBeenCalledWith(nodes, edges, '/ws-b');
    expect(mocks.loadBootstrap).not.toHaveBeenCalled();
  });

  it('缓存未命中 ⇒ loadBootstrap 拉取当前工作区的图', async () => {
    const cache = createCache();
    const { rerender } = renderHook(({ ws }: { ws: string }) =>
      useWorkspaceCache({
        currentWorkspace: ws,
        rawNodes: [],
        rawEdges: [],
        graphCache: cache,
        setGraphData,
      }),
      { initialProps: { ws: '/ws-a' } }
    );

    act(() => rerender({ ws: '/ws-b' }));

    // 缓存未命中 ⇒ 触发 loadBootstrap（而非什么都不做）
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
    await act(async () => { await mocks.loadBootstrap.mock.results![0]!.value; });
    expect(mocks.clearGraph).not.toHaveBeenCalled(); // 成功 ⇒ 不清空
  });

  it('缓存未命中且 loadBootstrap 失败 ⇒ clearGraph（画布绝不保留别的工作区的图）', async () => {
    const cache = createCache();
    mocks.loadBootstrap.mockResolvedValue(false);

    const { rerender } = renderHook(({ ws }: { ws: string }) =>
      useWorkspaceCache({
        currentWorkspace: ws,
        rawNodes: [],
        rawEdges: [],
        graphCache: cache,
        setGraphData,
      }),
      { initialProps: { ws: '/ws-a' } }
    );

    act(() => rerender({ ws: '/ws-b' }));

    await act(async () => { await mocks.loadBootstrap.mock.results![0]!.value; });
    expect(mocks.clearGraph).toHaveBeenCalledTimes(1);
  });

  it('缓存未命中且 loadBootstrap 抛异常 ⇒ clearGraph', async () => {
    const cache = createCache();
    mocks.loadBootstrap.mockRejectedValue(new Error('network'));

    const { rerender } = renderHook(({ ws }: { ws: string }) =>
      useWorkspaceCache({
        currentWorkspace: ws,
        rawNodes: [],
        rawEdges: [],
        graphCache: cache,
        setGraphData,
      }),
      { initialProps: { ws: '/ws-a' } }
    );

    act(() => rerender({ ws: '/ws-b' }));

    await act(async () => {
      try { await mocks.loadBootstrap.mock.results![0]!.value; } catch { /* expected */ }
    });
    expect(mocks.clearGraph).toHaveBeenCalledTimes(1);
  });

  it('rawNodes 非空 ⇒ 缓存当前工作区的图', () => {
    const cache = createCache();
    const nodes = [makeNode('a')];
    const edges = [makeEdge('e1', 'a', 'b')];

    renderHook(({ ws }: { ws: string }) =>
      useWorkspaceCache({
        currentWorkspace: ws,
        rawNodes: nodes,
        rawEdges: edges,
        graphCache: cache,
        setGraphData,
      }),
      { initialProps: { ws: '/ws-a' } }
    );

    expect(cache.getCachedData('/ws-a')).toEqual({ nodes, edges });
  });

  it('首次挂载不触发切换（prevWorkspaceRef 为 null）', () => {
    const cache = createCache();
    renderHook(({ ws }: { ws: string }) =>
      useWorkspaceCache({
        currentWorkspace: ws,
        rawNodes: [],
        rawEdges: [],
        graphCache: cache,
        setGraphData,
      }),
      { initialProps: { ws: '/ws-a' } }
    );
    expect(setGraphData).not.toHaveBeenCalled();
    expect(mocks.loadBootstrap).not.toHaveBeenCalled();
  });
});
