/**
 * @vitest-environment jsdom
 * 注册矩阵看板组件契约（cycle-117）。
 * 三态互斥：failed（不可达）/ loading（拉取中）/ board（正常）。
 * 「没有断链」必须显示而非隐藏——无断链本身是可观测事实。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

const fetchRegistryBoardMock = vi.fn();
vi.mock('../../src/client/api/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/index.ts')>();
  return { ...actual, fetchRegistryBoard: (...args: unknown[]) => fetchRegistryBoardMock(...args) };
});

import { RegistryPanel } from '../../src/client/components/RegistryPanel.tsx';

const sampleBoard = {
  version: 1,
  total: 36,
  byFace: { tools: 11, routes: 20, entries: 4, skill: 1 },
  brokenLinks: [],
  lifecycleCounts: { registered: 0, producing: 0, consuming: 36, degraded: 0, disposed: 0 },
  liveCounts: { live: 30, idle: 6, degraded: 0, unknown: 4 },
  entries: [
    { id: 'graph_query', face: 'tools', produces: 'kw', consumers: ['a'], lifecycle: 'consuming', registeredAt: 'x' },
    { id: '/data', face: 'routes', produces: 'graph', consumers: ['b'], lifecycle: 'consuming', registeredAt: 'y' },
    { id: 'conversation.view', face: 'entries', produces: 'tab', consumers: ['c'], lifecycle: 'consuming', registeredAt: 'z' },
    { id: 'graph-skill', face: 'skill', produces: 'hint', consumers: ['d'], lifecycle: 'consuming', registeredAt: 'w' },
  ],
  live: [
    { id: 'graph_query', face: 'tools', live: 'live', basis: 'ok' },
    { id: '/data', face: 'routes', live: 'live', basis: 'ok' },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RegistryPanel', () => {
  it('renders four face counts and no-broken-links line when board arrives', async () => {
    fetchRegistryBoardMock.mockResolvedValue(sampleBoard);
    render(<RegistryPanel onClose={vi.fn()} label="注册矩阵" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/无断链/)).toBeInTheDocument();
    // 生命周期列出现
    expect(screen.getAllByText('consuming').length).toBe(4);
  });

  it('renders broken links prominently when present', async () => {
    fetchRegistryBoardMock.mockResolvedValue({ ...sampleBoard, brokenLinks: ['graph_focus'] });
    render(<RegistryPanel onClose={vi.fn()} label="注册矩阵" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/断链业务/)).toHaveTextContent('graph_focus');
  });

  it('renders unreachable state (null) distinctly from empty board', async () => {
    fetchRegistryBoardMock.mockResolvedValue(null);
    render(<RegistryPanel onClose={vi.fn()} label="注册矩阵" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/不可达/)).toBeInTheDocument();
  });

  it('live counts section appears when host sends live probes', async () => {
    fetchRegistryBoardMock.mockResolvedValue(sampleBoard);
    render(<RegistryPanel onClose={vi.fn()} label="注册矩阵" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/运行中 30/)).toBeInTheDocument();
    expect(screen.getByText(/空闲 6/)).toBeInTheDocument();
  });
});
