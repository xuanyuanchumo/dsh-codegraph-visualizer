/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { PathBar } from '../../src/client/components/PathBar.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { makeNode } from '../helpers.ts';
import type { NodeId } from '../../src/types/index.ts';

const sampleNodes = [
  makeNode('n1', 'findPath', 'function', '/src/a.ts', 1),
  makeNode('n2', 'findShortestPath', 'function', '/src/a.ts', 20),
  makeNode('n3', 'renderGraph', 'module', '/src/b.ts', 1),
  makeNode('n4', 'UserController', 'class', '/src/c.ts', 1),
];

beforeEach(() => {
  useGraphStore.setState({
    rawNodes: sampleNodes,
    rawEdges: [],
    pathStartId: null,
    pathEndId: null,
    pathResult: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PathBar (FR-25) component', () => {
  it('associates labels with inputs via htmlFor/id for a11y', () => {
    render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
    expect(screen.getByLabelText('起点')).toBeTruthy();
    expect(screen.getByLabelText('终点')).toBeTruthy();
  });

  it('shows suggestions matching the start query', async () => {
    const user = userEvent.setup();
    render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
    const startInput = screen.getByLabelText('起点');
    await user.type(startInput, 'path');
    expect(screen.getByText('findPath')).toBeTruthy();
    expect(screen.getByText('findShortestPath')).toBeTruthy();
  });

  it('selecting suggestions sets endpoints and enables Find', async () => {
    const user = userEvent.setup();
    const onFindPath = vi.fn();
    render(<PathBar onFindPath={onFindPath} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
    const findBtn = screen.getByRole('button', { name: '查找路径' }) as HTMLButtonElement;
    expect(findBtn.disabled).toBe(true);

    await user.type(screen.getByLabelText('起点'), 'findPath');
    await user.click(screen.getByText('findPath'));
    expect(useGraphStore.getState().pathStartId).toBe(NodeIdOf('n1'));

    await user.type(screen.getByLabelText('终点'), 'UserController');
    await user.click(screen.getByText('UserController'));
    expect(useGraphStore.getState().pathEndId).toBe(NodeIdOf('n4'));

    expect(findBtn.disabled).toBe(false);
    await user.click(findBtn);
    expect(onFindPath).toHaveBeenCalledWith(NodeIdOf('n1'), NodeIdOf('n4'));
  });

  it('typing a new query resets the previously selected endpoint', async () => {
    const user = userEvent.setup();
    render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('起点'), 'renderGraph');
    await user.click(screen.getByText('renderGraph'));
    expect(useGraphStore.getState().pathStartId).toBe(NodeIdOf('n3'));
    await user.type(screen.getByLabelText('起点'), '2');
    expect(useGraphStore.getState().pathStartId).toBeNull();
  });

  it('clear resets path state and queries', async () => {
    const user = userEvent.setup();
    const onClearPath = vi.fn();
    useGraphStore.setState({ pathStartId: NodeIdOf('n1'), pathEndId: NodeIdOf('n2'), pathResult: [NodeIdOf('n1'), NodeIdOf('n2')] });
    render(<PathBar onFindPath={vi.fn()} onClearPath={onClearPath} pathResult={[NodeIdOf('n1'), NodeIdOf('n2')]} pathLength={1} onClose={vi.fn()} />);
    expect(screen.getByText(/路径长度/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '清除' }));
    expect(onClearPath).toHaveBeenCalledOnce();
    expect(useGraphStore.getState().pathStartId).toBeNull();
    expect(useGraphStore.getState().pathEndId).toBeNull();
    expect(useGraphStore.getState().pathResult).toBeNull();
  });

  // ── 双模（cycle-124：/paths 路由的 UI 消费面）────────────────────────
  describe('enumerate mode', () => {
    const mockFetchPathEnumerate = vi.fn();

    beforeEach(async () => {
      const api = await import('../../src/client/api/hostRequests.ts');
      vi.spyOn(api, 'fetchPathEnumerate').mockImplementation(mockFetchPathEnumerate);
    });

    async function switchToEnumerate(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('radio', { name: '枚举' }));
    }

    async function selectEndpoints(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText('起点'), 'findPath');
      await user.click(screen.getByRole('option', { name: /findPath/ }));
      await user.type(screen.getByLabelText('终点'), 'renderGraph');
      await user.click(screen.getByRole('option', { name: /renderGraph/ }));
    }

    it('默认最短路模式：枚举控件不可见，切换后出现', async () => {
      const user = userEvent.setup();
      render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
      expect(screen.queryByLabelText('最大跳数')).toBeNull();
      await switchToEnumerate(user);
      expect(screen.getByLabelText('最大跳数')).toBeTruthy();
      expect(screen.getByRole('radio', { name: '枚举' }).getAttribute('aria-checked')).toBe('true');
    });

    it('枚举调用 fetchPathEnumerate 并渲染 label 链结果', async () => {
      mockFetchPathEnumerate.mockResolvedValue({
        paths: [{ ids: ['n1', 'n3'], labels: ['findPath', 'renderGraph'] }],
        truncated: false,
        total: 1,
        nextCursor: null,
      });
      const user = userEvent.setup();
      render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
      await switchToEnumerate(user);
      await selectEndpoints(user);
      await user.click(screen.getByRole('button', { name: '枚举路径' }));
      expect(await screen.findByText(/共 1 条路径/)).toBeTruthy();
      expect(screen.getByText('findPath → renderGraph')).toBeTruthy();
      // 调用参数：端点 + workspace（store 的 currentWorkspace）
      expect(mockFetchPathEnumerate).toHaveBeenCalledWith(
        'n1', 'n3',
        expect.objectContaining({ maxHops: 5, workspace: expect.any(String) }),
      );
    });

    it('端点不在图（reason）⇒ 提示文案而非空结果（三态不冒充）', async () => {
      mockFetchPathEnumerate.mockResolvedValue({
        paths: [], truncated: false, total: 0, nextCursor: null, reason: 'endpoint-not-in-graph',
      });
      const user = userEvent.setup();
      render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
      await switchToEnumerate(user);
      await selectEndpoints(user);
      await user.click(screen.getByRole('button', { name: '枚举路径' }));
      expect(await screen.findByText('端点符号不在当前图中——先用关键词检索定位符号')).toBeTruthy();
    });

    it('路由 404（null）⇒ 「不可用」提示（查询没做成 ≠ 没有路径）', async () => {
      mockFetchPathEnumerate.mockResolvedValue(null);
      const user = userEvent.setup();
      render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
      await switchToEnumerate(user);
      await selectEndpoints(user);
      await user.click(screen.getByRole('button', { name: '枚举路径' }));
      expect(await screen.findByText('路径枚举不可用（索引未就绪或服务不可达）')).toBeTruthy();
    });

    it('空路径数组 ⇒ 「没有路径」提示（图里真的没有）', async () => {
      mockFetchPathEnumerate.mockResolvedValue({
        paths: [], truncated: false, total: 0, nextCursor: null,
      });
      const user = userEvent.setup();
      render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
      await switchToEnumerate(user);
      await selectEndpoints(user);
      await user.click(screen.getByRole('button', { name: '枚举路径' }));
      expect(await screen.findByText('两符号之间在当前跳数内没有路径')).toBeTruthy();
    });

    it('模式切换清另一模式的结果（互斥呈现）', async () => {
      mockFetchPathEnumerate.mockResolvedValue({
        paths: [{ ids: ['n1', 'n3'], labels: ['findPath', 'renderGraph'] }],
        truncated: false, total: 1, nextCursor: null,
      });
      const user = userEvent.setup();
      render(<PathBar onFindPath={vi.fn()} onClearPath={vi.fn()} pathResult={null} pathLength={null} onClose={vi.fn()} />);
      await switchToEnumerate(user);
      await selectEndpoints(user);
      await user.click(screen.getByRole('button', { name: '枚举路径' }));
      expect(await screen.findByText(/共 1 条路径/)).toBeTruthy();
      await user.click(screen.getByRole('radio', { name: '最短路' }));
      expect(screen.queryByText(/共 1 条路径/)).toBeNull();
    });
  });
});

function NodeIdOf(id: string): NodeId {
  return id as NodeId;
}
