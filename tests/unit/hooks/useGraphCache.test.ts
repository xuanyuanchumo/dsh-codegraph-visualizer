// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGraphCache } from '../../../src/client/hooks/useGraphCache.ts';
import type { GraphNode, GraphEdge } from '../../../src/types/index.ts';

describe('useGraphCache', () => {
  const mockNodes: GraphNode[] = [
    { id: 'n1' as never, label: 'func1', type: 'function', filePath: 'a.ts', properties: {} },
  ];
  const mockEdges: GraphEdge[] = [
    { id: 'e1' as never, source: 'n1' as never, target: 'n1' as never, type: 'call', properties: {} },
  ];

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('初始状态 getCachedData 应返回 null', () => {
    const { result } = renderHook(() => useGraphCache());
    expect(result.current.getCachedData('repo-1')).toBeNull();
  });

  it('cacheData 后 getCachedData 应返回缓存数据', () => {
    const { result } = renderHook(() => useGraphCache());
    act(() => {
      result.current.cacheData('repo-1', mockNodes, mockEdges);
    });
    const cached = result.current.getCachedData('repo-1');
    expect(cached).not.toBeNull();
    expect(cached!.nodes).toEqual(mockNodes);
    expect(cached!.edges).toEqual(mockEdges);
  });

  it('不同 repoId 应独立缓存', () => {
    const { result } = renderHook(() => useGraphCache());
    const nodes2: GraphNode[] = [
      { id: 'n2' as never, label: 'func2', type: 'class', filePath: 'b.ts', properties: {} },
    ];
    act(() => {
      result.current.cacheData('repo-1', mockNodes, mockEdges);
      result.current.cacheData('repo-2', nodes2, []);
    });
    expect(result.current.getCachedData('repo-1')?.nodes).toEqual(mockNodes);
    expect(result.current.getCachedData('repo-2')?.nodes).toEqual(nodes2);
  });

  it('未缓存的 repoId 应返回 null', () => {
    const { result } = renderHook(() => useGraphCache());
    act(() => {
      result.current.cacheData('repo-1', mockNodes, mockEdges);
    });
    expect(result.current.getCachedData('repo-unknown')).toBeNull();
  });

  it('卸载时应清理缓存', () => {
    const { result, unmount } = renderHook(() => useGraphCache());
    act(() => {
      result.current.cacheData('repo-1', mockNodes, mockEdges);
    });
    expect(result.current.getCachedData('repo-1')).not.toBeNull();
    unmount();
    const { result: result2 } = renderHook(() => useGraphCache());
    expect(result2.current.getCachedData('repo-1')).toBeNull();
  });

  it('cacheData 和 getCachedData 应是稳定引用', () => {
    const { result, rerender } = renderHook(() => useGraphCache());
    const { cacheData: cd1, getCachedData: gcd1 } = result.current;
    rerender();
    const { cacheData: cd2, getCachedData: gcd2 } = result.current;
    expect(cd1).toBe(cd2);
    expect(gcd1).toBe(gcd2);
  });
});