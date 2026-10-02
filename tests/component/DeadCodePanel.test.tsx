/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { DeadCodePanel } from '../../src/client/components/DeadCodePanel.tsx';
import type { DeadCodeResult, DeadCodeNode } from '../../src/shared/analysis/DeadCodeAnalyzer.ts';
import { NodeId } from '../../src/types/index.ts';

function makeDeadNode(overrides: Partial<DeadCodeNode> = {}): DeadCodeNode {
  return {
    nodeId: NodeId('n1'),
    label: 'functionA',
    filePath: 'src/foo.ts',
    type: 'function',
    category: 'unreachable',
    confidence: 'confirmed',
    inDegree: 0,
    outDegree: 0,
    reason: 'Unreachable from any entry point',
    ...overrides,
  };
}

function makeResult(deadNodes: DeadCodeNode[]): DeadCodeResult {
  const confirmed = deadNodes.filter((d) => d.confidence === 'confirmed').length;
  const suspected = deadNodes.filter((d) => d.confidence === 'suspected').length;
  const byCategory = { unreachable: 0, 'no-incoming': 0, orphan: 0 };
  for (const d of deadNodes) byCategory[d.category]++;
  return {
    deadNodes,
    entryNodes: [],
    unreachableNodes: deadNodes.map((d) => d.nodeId),
    stats: { total: deadNodes.length, confirmed, suspected, byCategory },
  };
}

const sampleResult: DeadCodeResult = makeResult([
  makeDeadNode({ nodeId: NodeId('n1'), label: 'functionA', filePath: 'src/foo.ts', category: 'unreachable', confidence: 'confirmed' }),
  makeDeadNode({ nodeId: NodeId('n2'), label: 'functionB', filePath: 'src/bar.ts', category: 'no-incoming', confidence: 'suspected' }),
  makeDeadNode({ nodeId: NodeId('n3'), label: 'functionC', filePath: 'src/baz.ts', category: 'orphan', confidence: 'confirmed' }),
]);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeadCodePanel component', () => {
  it('renders label in header', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('Dead Code')).toBeInTheDocument();
  });

  it('renders total count badge', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders confirmed and suspected stats', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByRole('button', { name: /close|关闭/i })).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DeadCodePanel result={sampleResult} onClose={onClose} label="Dead Code" />);
    await user.click(screen.getByRole('button', { name: /close|关闭/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has role="region" with correct aria-label', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code Analysis" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Dead Code Analysis');
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(document.querySelector('.cg-analysis-panel.cg-deadcode-panel')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeInTheDocument();
    expect(document.querySelector('.cg-deadcode-count-badge')).toBeInTheDocument();
  });

  it('renders dead code item labels', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('functionA')).toBeInTheDocument();
    expect(screen.getByText('functionB')).toBeInTheDocument();
    expect(screen.getByText('functionC')).toBeInTheDocument();
  });

  it('renders category badges', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    expect(screen.getByText('no-incoming')).toBeInTheDocument();
    expect(screen.getByText('orphan')).toBeInTheDocument();
  });

  it('renders file paths', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('src/bar.ts')).toBeInTheDocument();
    expect(screen.getByText('src/baz.ts')).toBeInTheDocument();
  });

  it('applies confidence-specific CSS class to items', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(document.querySelector('.cg-deadcode-item.cg-confirmed')).toBeInTheDocument();
    expect(document.querySelector('.cg-deadcode-item.cg-suspected')).toBeInTheDocument();
  });

  it('applies category-specific CSS class to badges', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(document.querySelector('.cg-deadcode-category-badge.cg-unreachable')).toBeInTheDocument();
    expect(document.querySelector('.cg-deadcode-category-badge.cg-no-incoming')).toBeInTheDocument();
    expect(document.querySelector('.cg-deadcode-category-badge.cg-orphan')).toBeInTheDocument();
  });

  it('renders empty message when no dead nodes', () => {
    const emptyResult = makeResult([]);
    render(<DeadCodePanel result={emptyResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText(/empty|无/)).toBeInTheDocument();
  });

  it('renders empty message when all nodes filtered out', () => {
    const singleCategory = makeResult([
      makeDeadNode({ category: 'unreachable', confidence: 'confirmed' }),
    ]);
    render(<DeadCodePanel result={singleCategory} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    fireEvent.change(selects[0]!, { target: { value: 'orphan' } });
    expect(screen.getByText(/empty|无/)).toBeInTheDocument();
  });

  it('filters by category', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    fireEvent.change(selects[0]!, { target: { value: 'orphan' } });
    expect(screen.getByText('functionC')).toBeInTheDocument();
    expect(screen.queryByText('functionA')).toBeNull();
    expect(screen.queryByText('functionB')).toBeNull();
  });

  it('filters by confidence', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    fireEvent.change(selects[1]!, { target: { value: 'suspected' } });
    expect(screen.getByText('functionB')).toBeInTheDocument();
    expect(screen.queryByText('functionA')).toBeNull();
    expect(screen.queryByText('functionC')).toBeNull();
  });

  it('combines category and confidence filters', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    fireEvent.change(selects[0]!, { target: { value: 'unreachable' } });
    fireEvent.change(selects[1]!, { target: { value: 'confirmed' } });
    expect(screen.getByText('functionA')).toBeInTheDocument();
    expect(screen.queryByText('functionB')).toBeNull();
    expect(screen.queryByText('functionC')).toBeNull();
  });

  it('calls onSelectNode when item clicked', () => {
    const onSelectNode = vi.fn();
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" onSelectNode={onSelectNode} />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    fireEvent.click(items[0]!);
    expect(onSelectNode).toHaveBeenCalledWith('n1');
  });

  it('calls onSelectNode on Enter key', () => {
    const onSelectNode = vi.fn();
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" onSelectNode={onSelectNode} />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    fireEvent.keyDown(items[0]!, { key: 'Enter' });
    expect(onSelectNode).toHaveBeenCalledWith('n1');
  });

  it('calls onSelectNode on Space key', () => {
    const onSelectNode = vi.fn();
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" onSelectNode={onSelectNode} />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    fireEvent.keyDown(items[0]!, { key: ' ' });
    expect(onSelectNode).toHaveBeenCalledWith('n1');
  });

  it('does not call onSelectNode on other keys', () => {
    const onSelectNode = vi.fn();
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" onSelectNode={onSelectNode} />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    fireEvent.keyDown(items[0]!, { key: 'Tab' });
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('items have role="button" and tabIndex=0', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    expect(items[0]!.getAttribute('role')).toBe('button');
    expect(items[0]!.getAttribute('tabindex')).toBe('0');
  });

  it('limits display to 50 items', () => {
    const manyNodes: DeadCodeNode[] = Array.from({ length: 60 }, (_, i) =>
      makeDeadNode({ nodeId: NodeId(`n${i}`), label: `func${i}`, filePath: `src/f${i}.ts` }),
    );
    const manyResult = makeResult(manyNodes);
    render(<DeadCodePanel result={manyResult} onClose={vi.fn()} label="Dead Code" />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    expect(items.length).toBe(50);
  });

  it('updates when result prop changes', () => {
    const { rerender } = render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('functionA')).toBeInTheDocument();
    const newResult = makeResult([makeDeadNode({ nodeId: NodeId('new'), label: 'newFunc', filePath: 'src/new.ts' })]);
    rerender(<DeadCodePanel result={newResult} onClose={vi.fn()} label="Dead Code" />);
    expect(screen.getByText('newFunc')).toBeInTheDocument();
    expect(screen.queryByText('functionA')).toBeNull();
  });

  it('renders without onSelectNode (no crash on click)', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const items = document.querySelectorAll('.cg-deadcode-item');
    expect(() => fireEvent.click(items[0]!)).not.toThrow();
  });

  it('renders stats section with confirmed and suspected badges', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(document.querySelector('.cg-deadcode-stats')).toBeInTheDocument();
    expect(document.querySelector('.cg-deadcode-stat-badge.cg-confirmed')).toBeInTheDocument();
    expect(document.querySelector('.cg-deadcode-stat-badge.cg-suspected')).toBeInTheDocument();
  });

  it('renders filter section with two selects', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    expect(document.querySelector('.cg-deadcode-filters')).toBeInTheDocument();
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    expect(selects.length).toBe(2);
  });

  it('category select has correct options', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    const categorySelect = selects[0];
    const options = categorySelect!.querySelectorAll('option');
    expect(options.length).toBe(4);
    expect(options[0]!.getAttribute('value')).toBe('all');
    expect(options[1]!.getAttribute('value')).toBe('unreachable');
    expect(options[2]!.getAttribute('value')).toBe('no-incoming');
    expect(options[3]!.getAttribute('value')).toBe('orphan');
  });

  it('confidence select has correct options', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    const confidenceSelect = selects[1];
    const options = confidenceSelect!.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0]!.getAttribute('value')).toBe('all');
    expect(options[1]!.getAttribute('value')).toBe('confirmed');
    expect(options[2]!.getAttribute('value')).toBe('suspected');
  });

  it('resets filters to all shows all items', () => {
    render(<DeadCodePanel result={sampleResult} onClose={vi.fn()} label="Dead Code" />);
    const selects = document.querySelectorAll('.cg-deadcode-filters select');
    fireEvent.change(selects[0]!, { target: { value: 'orphan' } });
    expect(screen.queryByText('functionA')).toBeNull();
    fireEvent.change(selects[0]!, { target: { value: 'all' } });
    expect(screen.getByText('functionA')).toBeInTheDocument();
    expect(screen.getByText('functionB')).toBeInTheDocument();
    expect(screen.getByText('functionC')).toBeInTheDocument();
  });
});