/**
 * @vitest-environment jsdom
 * GraphManagePanel 组件契约（cycle-141 / workstream C）。
 *
 * 钉住的行为：
 *   · 状态/节点/边来自 store；`builtAt` 反映 `store.lastUpdated`（不是 `Date.now()`）；
 *   · 构建走 `requestScan` → `POST /scan`；成功与失败都复位 loading；
 *   · 更新走 `POST /manage/update`（增量，与构建不同端点）；
 *   · 删除走内联两步确认 → `POST /manage/delete`，并区分 `INDEX_NOT_FOUND` / `DELETE_FAILED`；
 *   · 指标加载带 AbortController：工作区切换时中止上一个慢请求；
 *   · truncation 明细与白盒信息渲染。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import { GraphManagePanel } from '../../src/client/components/GraphManagePanel.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';
import type { GraphState } from '../../src/client/store/types.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId, RepoId } from '../../src/types/index.ts';

const noop = vi.fn();

function makeNode(id: string): GraphNode {
  return { id: NodeId(id), label: id, type: 'function', filePath: `${id}.ts`, lineNumber: 1, properties: {} };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type: 'call', properties: {} };
}

/** 构造「图已就绪」的 store 状态；overrides 用于每个用例的局部覆盖。 */
function readyStore(overrides: Partial<GraphState> = {}) {
  useGraphStore.setState({
    nodes: [makeNode('n1')],
    edges: [],
    rawNodes: [makeNode('n1')],
    rawEdges: [],
    lastUpdated: 1_700_000_000_000,
    repoId: RepoId('repo-a'),
    graphLayer: 'native',
    error: null,
    isLoading: false,
    ...overrides,
  });
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    onClose: noop,
    workspacePath: '/ws/a',
    onSetLoading: vi.fn(),
    onSetError: vi.fn(),
    prerequisites: { codegraph: true },
    ...overrides,
  };
}

interface Stub {
  match: (url: string) => boolean;
  handle: (init?: RequestInit) => Promise<unknown>;
}

/** 模拟 fetch 的最小 Response 形状（vitest 的 jsdom 环境不保证有全局 Response）。 */
function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

let routes: Stub[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

/** 后入者优先：beforeEach 的默认桩可被用例显式覆盖。 */
function stub(match: string, payload: unknown, status = 200): void {
  routes.push({
    match: (u) => u.includes(match),
    handle: () => Promise.resolve(jsonResponse(payload, status)),
  });
}

function stubRaw(match: string, handle: (init?: RequestInit) => Promise<unknown>): void {
  routes.push({ match: (u) => u.includes(match), handle });
}

const EMPTY_METRICS = { success: true, errorCode: null, metrics: null, truncation: null };

const FULL_METRICS = {
  success: true,
  errorCode: null,
  metrics: {
    nodeCount: 2,
    edgeCount: 1,
    density: 0.5,
    avgClustering: 0.25,
    degreeDistribution: { alpha: 2.1, isPowerLaw: true, maxDegree: 4, minDegree: 1, meanDegree: 2 },
    topBetweenness: [],
    topPageRank: [],
    components: { weaklyConnected: 1, stronglyConnected: 1 },
    articulationPoints: 0,
    diameter: 3,
    avgShortestPath: 1.5,
    modularity: 0.42,
    cyclomaticNumber: 5,
    kCore: 2,
    pageRankMass: 1.0,
  },
  truncation: {
    nodesTotal: 100,
    nodesSampled: 90,
    edgesTotal: 200,
    edgesSampled: 180,
    truncated: true,
    sampled: true,
    computeMs: 42,
  },
  fingerprint: 'fp-123',
};

beforeEach(() => {
  resetI18nListeners();
  setLang('en');
  routes = [];
  readyStore();
  // 默认指标桩：避免未显式覆盖的用例产生未匹配 fetch 噪声。
  stub('/manage/metrics', EMPTY_METRICS);
  fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i]!;
      if (route.match(url)) return route.handle(init);
    }
    return Promise.reject(new Error(`unmocked fetch: ${url}`));
  });
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GraphManagePanel', () => {
  it('renders status, node count and edge count from the store', () => {
    readyStore({
      nodes: [makeNode('n1'), makeNode('n2')],
      rawNodes: [makeNode('n1'), makeNode('n2')],
      edges: [makeEdge('e1', 'n1', 'n2')],
      rawEdges: [makeEdge('e1', 'n1', 'n2')],
    });
    render(<GraphManagePanel {...makeProps()} />);

    expect(screen.getByText('Ready')).toBeInTheDocument();
    const nodeRow = screen.getByText('Nodes').closest('.cg-manage-status-row');
    expect(nodeRow?.textContent).toContain('2');
    const edgeRow = screen.getByText('Edges').closest('.cg-manage-status-row');
    expect(edgeRow?.textContent).toContain('1');
  });

  it('renders the builtAt from store.lastUpdated (not Date.now())', async () => {
    const ts = 1_700_000_000_000;
    readyStore({ lastUpdated: ts });
    render(<GraphManagePanel {...makeProps()} />);

    const expected = new Date(ts).toLocaleString();
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
    // 若实现误用 Date.now()，这里会因每帧跳动而无法命中固定时间戳。
    expect(expected).not.toBe(new Date().toLocaleString());
  });

  it('shows the error status when the store has an error', () => {
    readyStore({ error: 'boom' });
    render(<GraphManagePanel {...makeProps()} />);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('build calls requestScan (/scan) and resets loading on success', async () => {
    const onSetLoading = vi.fn();
    const onSetError = vi.fn();
    stub('/codegraph/scan', { success: true, status: 'scanning' });
    render(<GraphManagePanel {...makeProps({ onSetLoading, onSetError })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Build' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/codegraph/scan', expect.objectContaining({ method: 'POST' })),
    );
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/codegraph/scan'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ path: '/ws/a' });
    await waitFor(() => expect(onSetLoading).toHaveBeenLastCalledWith(false));
    // 动作开始时会 `onSetError(null)` 复位全局错误；成功路径不得再传入任何非空错误。
    expect(onSetError.mock.calls.every((c) => c[0] === null)).toBe(true);
  });

  it('build resets loading and surfaces an error on failure', async () => {
    const onSetLoading = vi.fn();
    const onSetError = vi.fn();
    stubRaw('/codegraph/scan', () => Promise.reject(new Error('scan boom')));
    render(<GraphManagePanel {...makeProps({ onSetLoading, onSetError })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Build' }));

    await waitFor(() => expect(onSetLoading).toHaveBeenLastCalledWith(false));
    expect(onSetError).toHaveBeenCalledWith('Build request failed');
  });

  it('update calls /manage/update with the workspace path', async () => {
    const onSetError = vi.fn();
    stub('/manage/update', { success: true, errorCode: null, synced: true, scanned: 5 });
    render(<GraphManagePanel {...makeProps({ onSetError })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/codegraph/manage/update', expect.objectContaining({ method: 'POST' })),
    );
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/manage/update'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ path: '/ws/a' });
    expect(onSetError.mock.calls.every((c) => c[0] === null)).toBe(true);
  });

  it('delete asks for confirmation before calling /manage/delete and clears metrics + graph', async () => {
    stub('/manage/metrics', FULL_METRICS);
    stub('/manage/delete', { success: true, deleted: true, errorCode: null });
    render(<GraphManagePanel {...makeProps()} />);

    // 指标先渲染出来，才能验证删除后被清空。
    await waitFor(() => expect(document.querySelector('.cg-manage-metrics')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Delete Index' }));
    expect(screen.getByText('Delete the index? This cannot be undone')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/codegraph/manage/delete', expect.objectContaining({ method: 'POST' })),
    );
    await waitFor(() => expect(useGraphStore.getState().nodes).toEqual([]));
    await waitFor(() => expect(document.querySelector('.cg-manage-metrics')).toBeNull());
  });

  it('delete surfaces INDEX_NOT_FOUND as "not built"', async () => {
    const onSetError = vi.fn();
    stub('/manage/delete', { success: false, deleted: false, errorCode: 'INDEX_NOT_FOUND' });
    render(<GraphManagePanel {...makeProps({ onSetError })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Index' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onSetError).toHaveBeenCalledWith('Index not built'));
  });

  it('delete surfaces DELETE_FAILED (HTTP 500) as an error', async () => {
    const onSetError = vi.fn();
    stub('/manage/delete', { success: false, deleted: false, errorCode: 'DELETE_FAILED', error: 'boom' }, 500);
    render(<GraphManagePanel {...makeProps({ onSetError })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Index' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onSetError).toHaveBeenCalledWith('Failed to delete index'));
  });

  it('aborts the previous metrics request when the workspace changes', async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (value: unknown) => void = () => {};
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve; });
    stubRaw('/manage/metrics', (init) => {
      if (init?.signal) signals.push(init.signal);
      return first;
    });

    const { rerender } = render(<GraphManagePanel {...makeProps({ workspacePath: '/ws/a' })} />);
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(1));
    const firstSignal = signals[0]!;

    // 切换工作区 → loadMetrics 的依赖变化 → 重新加载 → 中止上一个请求。
    rerender(<GraphManagePanel {...makeProps({ workspacePath: '/ws/b' })} />);
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2));

    expect(firstSignal.aborted).toBe(true);
    resolveFirst(jsonResponse(EMPTY_METRICS));
  });

  it('renders the truncation block and fingerprint', async () => {
    stub('/manage/metrics', FULL_METRICS);
    render(<GraphManagePanel {...makeProps()} />);

    await waitFor(() => expect(document.querySelector('.cg-manage-truncation')).toBeTruthy());
    const box = document.querySelector('.cg-manage-truncation')!;
    expect(box.textContent).toContain('100');
    expect(box.textContent).toContain('90');
    expect(box.textContent).toContain('200');
    expect(box.textContent).toContain('180');
    expect(box.textContent).toContain('42');
    expect(screen.getByText('fp-123')).toBeInTheDocument();
    expect(screen.getByText('repo-a')).toBeInTheDocument();
  });

  it('surfaces a metrics load error instead of swallowing it', async () => {
    stub('/manage/metrics', { success: false, errorCode: 'INDEX_NOT_FOUND', metrics: null, truncation: null });
    render(<GraphManagePanel {...makeProps()} />);

    await waitFor(() => expect(screen.getByText('Index not built, no metrics')).toBeInTheDocument());
  });
});
