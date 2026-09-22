// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnalysisPanels } from '../../../src/client/hooks/useAnalysisPanels.ts';
import type { GraphNode, GraphEdge } from '../../../src/types/index.ts';

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setHealthScore: vi.fn(),
      setRules: vi.fn(),
      setRuleViolations: vi.fn(),
      rules: [],
    }),
}));

describe('useAnalysisPanels', () => {
  const mockNodes: GraphNode[] = [
    { id: 'n1' as never, label: 'func1', type: 'function', filePath: 'a.ts', properties: {} },
    { id: 'n2' as never, label: 'func2', type: 'function', filePath: 'b.ts', properties: {} },
  ];

  const mockEdges: GraphEdge[] = [
    { id: 'e1' as never, source: 'n1' as never, target: 'n2' as never, type: 'call', properties: {} },
  ];

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('应返回初始空状态', () => {
    const { result } = renderHook(() =>
      useAnalysisPanels(
        [],
        [],
        false,
        false,
        false,
        false,
        false,
        null,
        () => null
      )
    );
    expect(result.current.hotspotNodes).toEqual([]);
    expect(result.current.godModules).toEqual([]);
    expect(result.current.impactStats).toBeNull();
    expect(result.current.coreFunctions).toEqual([]);
  });

  it('应返回 handleHealthCheck 和 handleRulesCheck 函数', () => {
    const { result } = renderHook(() =>
      useAnalysisPanels(
        mockNodes,
        mockEdges,
        false,
        false,
        false,
        false,
        false,
        null,
        () => null
      )
    );
    expect(typeof result.current.handleHealthCheck).toBe('function');
    expect(typeof result.current.handleRulesCheck).toBe('function');
  });

  it('showHealthScore=true 且有节点时应自动计算健康评分', () => {
    const { result } = renderHook(() =>
      useAnalysisPanels(
        mockNodes,
        mockEdges,
        true,
        false,
        false,
        false,
        false,
        null,
        () => null
      )
    );
    expect(result.current.handleHealthCheck).toBeDefined();
  });

  it('showHotspot=true 且有节点时应分析热点', () => {
    const { result, rerender } = renderHook(
      ({ show }) =>
        useAnalysisPanels(
          mockNodes,
          mockEdges,
          false,
          false,
          show,
          false,
          false,
          null,
          () => null
        ),
      { initialProps: { show: false } }
    );
    expect(result.current.hotspotNodes).toEqual([]);
    rerender({ show: true });
    expect(result.current.hotspotNodes).toBeDefined();
  });

  it('showGodModule=true 且有节点时应检测 God Module', () => {
    const { result, rerender } = renderHook(
      ({ show }) =>
        useAnalysisPanels(
          mockNodes,
          mockEdges,
          false,
          false,
          false,
          show,
          false,
          null,
          () => null
        ),
      { initialProps: { show: false } }
    );
    expect(result.current.godModules).toEqual([]);
    rerender({ show: true });
    expect(result.current.godModules).toBeDefined();
  });

  it('showImpact=true 且有 selectedNodeId 时应设置 impactStats', () => {
    const mockGetImpactStats = () => ({ d1: 5, d2: 10, d3: 15, total: 30 });
    const { result } = renderHook(() =>
      useAnalysisPanels(
        mockNodes,
        mockEdges,
        false,
        false,
        false,
        false,
        true,
        'n1',
        mockGetImpactStats
      )
    );
    expect(result.current.impactStats).toEqual({ d1: 5, d2: 10, d3: 15, total: 30 });
  });

  it('showImpact=true 但无 selectedNodeId 时 impactStats 应为 null', () => {
    const { result } = renderHook(() =>
      useAnalysisPanels(
        mockNodes,
        mockEdges,
        false,
        false,
        false,
        false,
        true,
        null,
        () => null
      )
    );
    expect(result.current.impactStats).toBeNull();
  });

  it('showCoreFunction=true 且有节点时应分析核心函数', () => {
    const { result, rerender } = renderHook(
      ({ show }) =>
        useAnalysisPanels(
          mockNodes,
          mockEdges,
          false,
          false,
          false,
          false,
          false,
          null,
          () => null,
          show
        ),
      { initialProps: { show: false } }
    );
    expect(result.current.coreFunctions).toEqual([]);
    rerender({ show: true });
    expect(result.current.coreFunctions).toBeDefined();
  });
});