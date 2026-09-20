/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNodeSearch } from '../../../src/client/hooks/useNodeSearch.ts';

const mockNodes = [
  { id: '1', label: 'getUser', type: 'function', filePath: 'a.ts' },
  { id: '2', label: 'UserClass', type: 'class', filePath: 'b.ts' },
  { id: '3', label: 'getUserById', type: 'function', filePath: 'c.ts' },
  { id: '4', label: 'deleteUser', type: 'function', filePath: 'd.ts' },
  { id: '5', label: 'AuthService', type: 'class', filePath: 'e.ts' },
];

describe('useNodeSearch', () => {
  it('returns empty array for empty query', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    expect(result.current.search('')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    expect(result.current.search('   ')).toEqual([]);
  });

  it('finds nodes by simple prefix using Trie', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    const matches = result.current.search('getUser');
    expect(matches).toHaveLength(2);
    expect(matches.map((m: any) => m.id)).toContain('1');
    expect(matches.map((m: any) => m.id)).toContain('3');
  });

  it('respects limit parameter', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    const matches = result.current.search('getUser', 1);
    expect(matches).toHaveLength(1);
  });

  it('finds nodes by case-insensitive prefix', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    const matches = result.current.search('getuser');
    expect(matches).toHaveLength(2);
  });

  it('returns empty for non-matching prefix', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    const matches = result.current.search('xyz');
    expect(matches).toHaveLength(0);
  });

  it('falls back to full search for complex queries with spaces', () => {
    const { result } = renderHook(() => useNodeSearch(mockNodes));
    const matches = result.current.search('getUser UserClass');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('rebuilds Trie when rawNodes change', () => {
    const { result, rerender } = renderHook(({ nodes }) => useNodeSearch(nodes), {
      initialProps: { nodes: mockNodes },
    });
    const newNodes = [...mockNodes, { id: '6', label: 'getUserList', type: 'function', filePath: 'f.ts' }];
    rerender({ nodes: newNodes });
    const matches = result.current.search('getUser');
    expect(matches).toHaveLength(3);
  });
});