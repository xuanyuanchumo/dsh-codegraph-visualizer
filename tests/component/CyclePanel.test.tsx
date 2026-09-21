/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { CyclePanel } from '../../src/client/components/CyclePanel.tsx';
import type { CycleInfo } from '../../src/client/renderer/CycleDetector.ts';

const sampleCycles: CycleInfo[] = [
  { nodes: ['a', 'b', 'c'], length: 3, edges: ['e1', 'e2', 'e3'] },
  { nodes: ['x', 'y'], length: 2, edges: ['e4', 'e5'] },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CyclePanel component', () => {
  it('renders label in header', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.getByText('Cycles')).toBeTruthy();
  });

  it('renders cycle count badge', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders empty label when no cycles', () => {
    render(<CyclePanel cycles={[]} label="Cycles" emptyLabel="No cycles found" />);
    expect(screen.getByText('No cycles found')).toBeTruthy();
  });

  it('renders cycle items with index', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
  });

  it('renders cycle nodes with arrows', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('c')).toBeTruthy();
  });

  it('renders cycle return arrow', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    const arrows = document.querySelectorAll('.cg-cycle-arrow');
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows[arrows.length - 1]!.textContent).toBe('↺');
  });

  it('renders close button when onClose provided', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /close|关闭/i })).toBeTruthy();
  });

  it('does not render close button when onClose not provided', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.queryByRole('button', { name: /close|关闭/i })).toBeNull();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close|关闭/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has role="region" with correct aria-label', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycle Detection" emptyLabel="No cycles" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Cycle Detection');
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(document.querySelector('.cg-analysis-panel.cg-cycle-panel')).toBeTruthy();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeTruthy();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeTruthy();
    expect(document.querySelector('.cg-cycle-count-badge')).toBeTruthy();
  });

  it('renders cycle node tags with correct count', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    const nodeTags = document.querySelectorAll('.cg-cycle-node-tag');
    expect(nodeTags.length).toBe(5);
  });

  it('renders inter-node arrows between nodes in cycle', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    const arrows = document.querySelectorAll('.cg-cycle-arrow');
    expect(arrows.length).toBe(5);
  });

  it('updates when cycles prop changes', () => {
    const { rerender } = render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.getByText('2')).toBeTruthy();
    rerender(<CyclePanel cycles={[]} label="Cycles" emptyLabel="No cycles" />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('No cycles')).toBeTruthy();
  });
});