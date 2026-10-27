// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAnalysisPanels } from '../../../src/client/hooks/useAnalysisPanels.ts';
import type { GraphNode, GraphEdge } from '../../../src/types/index.ts';

// 只替换 `fetchHotspotChurn`，其余导出保持真实实现。
// 整体工厂替换（`vi.mock(path, () => ({...}))`）会让新增导出立刻炸掉所有用例，
// 这里用 importOriginal 形状只覆盖被测函数（CLAUDE.md 已记过这个坑）。
const fetchHotspotChurnMock = vi.fn();
vi.mock('../../../src/client/api/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/client/api/index.ts')>();
  return { ...actual, fetchHotspotChurn: (...args: unknown[]) => fetchHotspotChurnMock(...args) };
});

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setHealthScore: vi.fn(),
      setRules: vi.fn(),
      setRuleViolations: vi.fn(),
      rules: [],
    }),
}));

/** 构造一个合法的 churn 载荷。 */
function churnPayload(overrides: Record<string, unknown> = {}) {
  return {
    byFile: { 'a.ts': 12 },
    commitCount: 40,
    revision: 'abc123',
    truncated: false,
    available: true,
    error: null,
    ...overrides,
  };
}

describe('useAnalysisPanels', () => {
  const mockNodes: GraphNode[] = [
    { id: 'n1' as never, label: 'func1', type: 'function', filePath: 'a.ts', properties: {} },
    { id: 'n2' as never, label: 'func2', type: 'function', filePath: 'b.ts', properties: {} },
  ];

  const mockEdges: GraphEdge[] = [
    { id: 'e1' as never, source: 'n1' as never, target: 'n2' as never, type: 'call', properties: {} },
  ];

  beforeEach(() => {
    fetchHotspotChurnMock.mockReset();
    fetchHotspotChurnMock.mockResolvedValue(churnPayload());
  });

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

  it('J30: showHotspot=true 且有节点时应分析热点', () => {
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

  // ── 变更频率（churn，研究报告 §六 #11）──────────────────────────────────

  it('热点面板未打开时不请求 churn，状态保持 idle', () => {
    const { result } = renderHook(() =>
      useAnalysisPanels(mockNodes, mockEdges, false, false, false, false, false, null, () => null)
    );
    expect(fetchHotspotChurnMock).not.toHaveBeenCalled();
    expect(result.current.churnStatus.state).toBe('idle');
  });

  it('热点面板打开时按当前工作区请求 churn，成功后状态为 ready', async () => {
    const { result } = renderHook(() =>
      useAnalysisPanels(
        mockNodes, mockEdges, false, false, true, false, false, null, () => null,
        false, false, 'ws-1',
      )
    );
    await waitFor(() => expect(result.current.churnStatus.state).toBe('ready'));
    // 工作区必须真的传下去：`/churn` 是按工作区寻址的接口，传丢了会读到别的工作区。
    expect(fetchHotspotChurnMock.mock.calls[0]?.[1]).toBe('ws-1');
    expect(result.current.churnStatus.commitCount).toBe(40);
    expect(result.current.churnStatus.revision).toBe('abc123');
    expect(result.current.churnStatus.truncated).toBe(false);
  });

  it('churn 数据应参与热点排序（分数高于纯入度）', async () => {
    // a.ts 被改动 12 次 → 倍数 > 1；构造一个入度 5 的节点使其进入候选。
    const nodes: GraphNode[] = [
      { id: 'n1' as never, label: 'hot', type: 'function', filePath: 'a.ts', properties: {} },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}` as never, label: `c${i}`, type: 'function' as const,
        filePath: 'c.ts', properties: {},
      })),
    ];
    const edges: GraphEdge[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}` as never, source: `c${i}` as never, target: 'n1' as never,
      type: 'call' as const, properties: {},
    }));
    const { result } = renderHook(() =>
      useAnalysisPanels(nodes, edges, false, false, true, false, false, null, () => null)
    );
    await waitFor(() => expect(result.current.churnStatus.state).toBe('ready'));
    await waitFor(() => expect(result.current.hotspotNodes.length).toBeGreaterThan(0));
    const hot = result.current.hotspotNodes[0]!;
    expect(hot.indegree).toBe(5);
    expect(hot.churn).toBe(12);
    // 关键不变量：有 churn 时分数严格大于入度（倍数区间 (1, 4]）。
    expect(hot.hotspotScore).toBeGreaterThan(hot.indegree);
  });

  it('宿主答复 available=false 时状态为 unavailable，且分数退化为纯入度', async () => {
    fetchHotspotChurnMock.mockResolvedValue(
      churnPayload({ available: false, byFile: {}, commitCount: 0, revision: null, error: 'not a git repository' })
    );
    const nodes: GraphNode[] = [
      { id: 'n1' as never, label: 'hot', type: 'function', filePath: 'a.ts', properties: {} },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}` as never, label: `c${i}`, type: 'function' as const,
        filePath: 'c.ts', properties: {},
      })),
    ];
    const edges: GraphEdge[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}` as never, source: `c${i}` as never, target: 'n1' as never,
      type: 'call' as const, properties: {},
    }));
    const { result } = renderHook(() =>
      useAnalysisPanels(nodes, edges, false, false, true, false, false, null, () => null)
    );
    await waitFor(() => expect(result.current.churnStatus.state).toBe('unavailable'));
    expect(result.current.churnStatus.error).toBe('not a git repository');
    await waitFor(() => expect(result.current.hotspotNodes.length).toBeGreaterThan(0));
    const hot = result.current.hotspotNodes[0]!;
    // 「采集失败不能悄悄改变既有排序」：分数必须恰等于入度。
    expect(hot.hotspotScore).toBe(hot.indegree);
    expect(hot.churn).toBe(0);
  });

  it('请求本身失败（返回 null）时状态为 unavailable，error 为 request failed', async () => {
    fetchHotspotChurnMock.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useAnalysisPanels(mockNodes, mockEdges, false, false, true, false, false, null, () => null)
    );
    await waitFor(() => expect(result.current.churnStatus.state).toBe('unavailable'));
    // 必须与「宿主说它不是 git 仓库」区分开：这两种 unavailable 的原因不同。
    expect(result.current.churnStatus.error).toBe('request failed');
  });

  it('关闭热点面板后回到 idle 并清空 churn 数据', async () => {
    const { result, rerender } = renderHook(
      ({ show }) =>
        useAnalysisPanels(mockNodes, mockEdges, false, false, show, false, false, null, () => null),
      { initialProps: { show: true } }
    );
    await waitFor(() => expect(result.current.churnStatus.state).toBe('ready'));
    rerender({ show: false });
    await waitFor(() => expect(result.current.churnStatus.state).toBe('idle'));
  });
});
