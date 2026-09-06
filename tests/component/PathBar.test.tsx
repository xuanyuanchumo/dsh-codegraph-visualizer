/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});

function NodeIdOf(id: string): NodeId {
  return id as NodeId;
}
