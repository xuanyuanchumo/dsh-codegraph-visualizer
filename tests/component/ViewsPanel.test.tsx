/**
 * @vitest-environment jsdom
 * `ViewsPanel`（Π 视图划分面板）组件契约（cycle-141 / workstream E）。
 *
 * 守五条呈现契约：
 *   1. **四张视图摘要卡**：结构/时序/所有权/领域各一张，带节点数；
 *   2. **视图分布条**：四段横向比例条 + 图例；
 *   3. **节点视图矩阵**：采样节点 × 四视图的 ✓/— 表格；
 *   4. **截断披露**：`sampled:true` 时显式说明「仅显示前 N 个（共 M 个）」；
 *   5. **降级可见**：时序/所有权 `available:false` 时卡片显示「不可用」而不是静默归零。
 *
 * 外加三态互斥：加载 / 错误（可重试）/ 未构建（INDEX_NOT_FOUND）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const fetchWithTimeoutMock = vi.fn();
vi.mock('../../src/client/api/requestCore.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/requestCore.ts')>();
  return { ...actual, fetchWithTimeout: (...args: unknown[]) => fetchWithTimeoutMock(...args) };
});

import { ViewsPanel } from '../../src/client/components/ViewsPanel.tsx';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

const WORKSPACE = '/test/workspace';

/** 一份「四视图齐备」的宿主响应。 */
const sampleViews = {
  success: true,
  errorCode: null,
  views: {
    structural: { nodeCount: 3, edgeCount: 2 },
    temporal: { nodeCount: 2, edgeCount: 1, available: true, reason: null },
    ownership: { nodeCount: 1, edgeCount: 0, available: true, reason: null },
    domain: { nodeCount: 3, edgeCount: 1, domainCount: 2, nodeCounts: { 'domain-0': 2, 'domain-1': 1 } },
  },
  totalNodes: 3,
  totalEdges: 2,
  nodeViewMatrix: [
    { id: 'n-alpha', label: 'alpha', views: ['domain', 'ownership', 'structural', 'temporal'] },
    { id: 'n-beta', label: 'beta', views: ['domain', 'structural', 'temporal'] },
    { id: 'n-gamma', label: 'gamma', views: ['structural'] },
  ],
  sampled: false,
  computedAt: 1,
};

function mockOk(body: unknown): void {
  fetchWithTimeoutMock.mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function renderPanel(): ReturnType<typeof render> {
  return render(<ViewsPanel onClose={vi.fn()} workspacePath={WORKSPACE} />);
}

/** 等待面板离开「加载中」态（fetch 的微任务 resolve 后 status 才变）。 */
async function settle(): Promise<void> {
  await waitFor(() => expect(screen.queryByText('加载视图划分中…')).toBeNull());
}

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ViewsPanel: 加载与错误态', () => {
  it('拉取中显示加载态', () => {
    fetchWithTimeoutMock.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText('加载视图划分中…')).toBeInTheDocument();
  });

  it('请求失败显示错误态并可重试', async () => {
    fetchWithTimeoutMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    await settle();
    expect(screen.getByText('视图划分加载失败')).toBeInTheDocument();

    fetchWithTimeoutMock.mockClear();
    mockOk(sampleViews);
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(screen.getAllByText('结构视图').length).toBeGreaterThan(0));
  });

  it('INDEX_NOT_FOUND 显示未构建态', async () => {
    mockOk({ success: false, errorCode: 'INDEX_NOT_FOUND', views: null });
    renderPanel();
    await settle();
    expect(screen.getByText('未找到索引，尚未构建图谱')).toBeInTheDocument();
  });
});

describe('ViewsPanel: 视图摘要卡', () => {
  it('渲染四张视图卡并显示各自的节点数', async () => {
    mockOk(sampleViews);
    const { container } = renderPanel();
    await settle();

    const titles = [...container.querySelectorAll('.cg-views-card-title')].map((el) => el.textContent);
    expect(titles).toEqual(['结构视图', '时序视图', '所有权视图', '领域视图']);

    // 卡片 hint 是唯一的「N 节点 · M 边」串，避免与矩阵表头/图例混淆。
    expect(screen.getByText('3 节点 · 2 边')).toBeInTheDocument();
    expect(screen.getByText('2 节点 · 1 边')).toBeInTheDocument();
    expect(screen.getByText('1 节点 · 0 边')).toBeInTheDocument();
    expect(screen.getByText('3 节点 · 1 边')).toBeInTheDocument();
  });

  it('时序视图不可用时卡片显示「不可用」而不是静默归零', async () => {
    mockOk({
      ...sampleViews,
      views: {
        ...sampleViews.views,
        temporal: { nodeCount: 0, edgeCount: 0, available: false, reason: '未提供 commitLog：时序视图不可用' },
      },
    });
    renderPanel();
    await settle();
    expect(screen.getByText('时序视图不可用')).toBeInTheDocument();
  });
});

describe('ViewsPanel: 视图分布条', () => {
  it('渲染四段比例条与图例', async () => {
    mockOk(sampleViews);
    const { container } = renderPanel();
    await settle();

    const bar = container.querySelector('.cg-views-bar');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll('.cg-views-bar-seg')).toHaveLength(4);
    expect(bar!.querySelector('.cg-views-bar-structural')).not.toBeNull();
    expect(bar!.querySelector('.cg-views-bar-temporal')).not.toBeNull();
    expect(bar!.querySelector('.cg-views-bar-ownership')).not.toBeNull();
    expect(bar!.querySelector('.cg-views-bar-domain')).not.toBeNull();

    expect(screen.getByText('结构视图 · 3')).toBeInTheDocument();
    expect(screen.getByText('时序视图 · 2')).toBeInTheDocument();
    expect(screen.getByText('领域视图 · 3')).toBeInTheDocument();
  });
});

describe('ViewsPanel: 节点视图矩阵', () => {
  it('渲染采样节点的 ✓/— 矩阵与四视图表头', async () => {
    mockOk(sampleViews);
    const { container } = renderPanel();
    await settle();

    expect(screen.getByText('节点视图矩阵')).toBeInTheDocument();
    // 表头四视图
    expect(screen.getByText('结构视图', { selector: '[role="columnheader"]' })).toBeInTheDocument();
    expect(screen.getByText('时序视图', { selector: '[role="columnheader"]' })).toBeInTheDocument();
    expect(screen.getByText('所有权视图', { selector: '[role="columnheader"]' })).toBeInTheDocument();
    expect(screen.getByText('领域视图', { selector: '[role="columnheader"]' })).toBeInTheDocument();

    // 三行节点
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('gamma')).toBeInTheDocument();

    // alpha 全属（4 个 ✓），gamma 只属结构视图（1 个 ✓ + 3 个 —）。
    const onCells = container.querySelectorAll('.cg-views-cell-on');
    expect(onCells).toHaveLength(4 + 3 + 1);
    expect(container.querySelectorAll('.cg-views-cell')).toHaveLength(3 * 4);
  });

  it('矩阵为空时显示空态', async () => {
    mockOk({ ...sampleViews, nodeViewMatrix: [] });
    renderPanel();
    await settle();
    expect(screen.getByText('暂无节点')).toBeInTheDocument();
  });
});

describe('ViewsPanel: 截断披露', () => {
  it('sampled:true 时显式说明采样范围', async () => {
    mockOk({
      ...sampleViews,
      totalNodes: 1200,
      nodeViewMatrix: [{ id: 'n-0', label: 'node-0', views: ['structural'] }],
      sampled: true,
    });
    renderPanel();
    await settle();
    expect(screen.getByText('仅显示前 1 个节点（共 1200 个）')).toBeInTheDocument();
  });

  it('未采样时不显示截断披露', async () => {
    mockOk(sampleViews);
    renderPanel();
    await settle();
    expect(screen.queryByText(/仅显示前/)).toBeNull();
  });
});

describe('ViewsPanel: 领域分解', () => {
  it('渲染领域名与节点数', async () => {
    mockOk(sampleViews);
    renderPanel();
    await settle();
    expect(screen.getByText('领域分布')).toBeInTheDocument();
    expect(screen.getByText('domain-0')).toBeInTheDocument();
    expect(screen.getByText('domain-1')).toBeInTheDocument();
  });
});

describe('ViewsPanel: 数据来源披露（cycle-145）', () => {
  it('响应带 gitSources 时渲染「数据来源」区，逐项显示来源与耗时', async () => {
    mockOk({
      ...sampleViews,
      gitSources: {
        commitLog: { source: 'auto', available: true, durationMs: 42, truncated: false, reason: null },
        blameLog: { source: 'query', available: true, durationMs: null, truncated: false, reason: null },
      },
    });
    renderPanel();
    await settle();
    expect(screen.getByText('数据来源')).toBeInTheDocument();
    expect(screen.getByText('提交日志')).toBeInTheDocument();
    expect(screen.getByText('归属日志')).toBeInTheDocument();
    // auto 通道带耗时披露；query 通道显示「调用方传入」。
    expect(screen.getByText(/宿主自动采集 · 耗时 42ms/)).toBeInTheDocument();
    expect(screen.getByText('调用方传入')).toBeInTheDocument();
  });

  it('采集失败的通道显示 reason（服务端诊断数据原样呈现）', async () => {
    mockOk({
      ...sampleViews,
      gitSources: {
        commitLog: { source: 'auto', available: false, durationMs: null, truncated: false, reason: '不是 git 仓库' },
        blameLog: { source: 'auto', available: true, durationMs: 10, truncated: false, reason: null },
      },
    });
    renderPanel();
    await settle();
    expect(screen.getByText('不是 git 仓库')).toBeInTheDocument();
  });

  it('旧宿主响应不带 gitSources 字段时整区不渲染（兼容降级）', async () => {
    mockOk(sampleViews); // sampleViews 无 gitSources 键。
    renderPanel();
    await settle();
    expect(screen.queryByText('数据来源')).toBeNull();
  });
});

/** 窗口选择器用例专用：取最近一次 fetch 的 URL（`calls[0]` 在断言前必已发生，非空安全）。 */
function lastFetchUrl(): string {
  const call = fetchWithTimeoutMock.mock.calls[0];
  if (call === undefined) throw new Error('fetchWithTimeout was never called');
  return call[0] as string;
}

describe('ViewsPanel: 时序窗口选择器（cycle-145）', () => {
  it('请求 URL 缺省不带 days（全部历史），点击「近 30 天」后 URL 携带 days=30', async () => {
    mockOk(sampleViews);
    renderPanel();
    await settle();
    // 首次请求：无 days 参数。
    const firstUrl = new URL(lastFetchUrl(), 'http://localhost');
    expect(firstUrl.searchParams.get('days')).toBeNull();
    // 切换到「近 30 天」：重拉，URL 携带 days=30。
    fetchWithTimeoutMock.mockClear();
    mockOk(sampleViews);
    fireEvent.click(screen.getByRole('button', { name: '近 30 天' }));
    await settle();
    const secondUrl = new URL(lastFetchUrl(), 'http://localhost');
    expect(secondUrl.searchParams.get('days')).toBe('30');
  });

  it('切回「全部」后 URL 不再携带 days 参数', async () => {
    mockOk(sampleViews);
    renderPanel();
    await settle();
    fetchWithTimeoutMock.mockClear();
    mockOk(sampleViews);
    fireEvent.click(screen.getByRole('button', { name: '近 7 天' }));
    await settle();
    fetchWithTimeoutMock.mockClear();
    mockOk(sampleViews);
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    await settle();
    const url = new URL(lastFetchUrl(), 'http://localhost');
    expect(url.searchParams.get('days')).toBeNull();
  });

  it('窗口工具条只在就绪态渲染（加载/错误/未构建态不可见）', async () => {
    mockOk(sampleViews);
    renderPanel();
    // 加载态：工具条不存在。
    expect(screen.queryByRole('toolbar')).toBeNull();
    await settle();
    expect(screen.getByRole('toolbar', { name: '时序窗口' })).toBeInTheDocument();
  });
});
