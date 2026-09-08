/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { FocusModeBar } from '../../src/client/components/FocusModeBar.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { makeNode } from '../helpers.ts';

const sampleNodes = [
  makeNode('n1', 'findPath', 'function', '/src/a.ts', 1),
  makeNode('n2', 'renderGraph', 'module', '/src/b.ts', 1),
];

beforeEach(() => {
  useGraphStore.setState({
    rawNodes: sampleNodes,
    focusDepth: 1,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FocusModeBar (FR-26) component', () => {
  it('returns null when focusNodeId is null', () => {
    const { container } = render(
      <FocusModeBar focusNodeId={null} onExpand={vi.fn()} onContract={vi.fn()} onExit={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders focus label and depth when focusNodeId is set', () => {
    render(
      <FocusModeBar focusNodeId="n1" onExpand={vi.fn()} onContract={vi.fn()} onExit={vi.fn()} />
    );
    expect(screen.getByText(/findPath/)).toBeTruthy();
  });

  it('shows focusNodeId as label when node not found in rawNodes', () => {
    render(
      <FocusModeBar focusNodeId="unknown-id" onExpand={vi.fn()} onContract={vi.fn()} onExit={vi.fn()} />
    );
    expect(screen.getByText(/unknown-id/)).toBeTruthy();
  });

  it('disables contract button when focusDepth <= 1', () => {
    useGraphStore.setState({ focusDepth: 1 });
    render(
      <FocusModeBar focusNodeId="n1" onExpand={vi.fn()} onContract={vi.fn()} onExit={vi.fn()} />
    );
    const contractBtn = document.querySelector('.focus-contract-btn') as HTMLButtonElement;
    expect(contractBtn).toBeTruthy();
    expect(contractBtn.disabled).toBe(true);
  });

  it('enables contract button when focusDepth > 1', () => {
    useGraphStore.setState({ focusDepth: 3 });
    render(
      <FocusModeBar focusNodeId="n1" onExpand={vi.fn()} onContract={vi.fn()} onExit={vi.fn()} />
    );
    const contractBtn = document.querySelector('.focus-contract-btn') as HTMLButtonElement;
    expect(contractBtn).toBeTruthy();
    expect(contractBtn.disabled).toBe(false);
  });

  it('calls onExpand, onContract, onExit when respective buttons clicked', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    const onContract = vi.fn();
    const onExit = vi.fn();
    useGraphStore.setState({ focusDepth: 2 });
    render(
      <FocusModeBar focusNodeId="n1" onExpand={onExpand} onContract={onContract} onExit={onExit} />
    );
    const expandBtn = document.querySelector('.focus-expand-btn') as HTMLButtonElement;
    const contractBtn = document.querySelector('.focus-contract-btn') as HTMLButtonElement;
    const exitBtn = document.querySelector('.focus-exit-btn') as HTMLButtonElement;
    await user.click(expandBtn);
    expect(onExpand).toHaveBeenCalledOnce();
    await user.click(contractBtn);
    expect(onContract).toHaveBeenCalledOnce();
    await user.click(exitBtn);
    expect(onExit).toHaveBeenCalledOnce();
  });
});
