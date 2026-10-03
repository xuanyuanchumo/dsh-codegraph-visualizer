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

const mockOnClose = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockOnClose.mockReset();
});

describe('CyclePanel component', () => {
  it('renders label in header', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByText('Cycles')).toBeInTheDocument();
  });

  it('renders cycle count badge', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders empty label when no cycles', () => {
    render(<CyclePanel cycles={[]} label="Cycles" emptyLabel="No cycles found" onClose={mockOnClose} />);
    expect(screen.getByText('No cycles found')).toBeInTheDocument();
  });

  it('renders cycle items with index', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders cycle nodes with arrows', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('renders cycle return arrow', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    const arrows = document.querySelectorAll('.cg-cycle-arrow');
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows[arrows.length - 1]!.textContent).toBe('↺');
  });

  it('renders close button', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByRole('button', { name: /close|关闭/i })).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    await user.click(screen.getByRole('button', { name: /close|关闭/i }));
    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('has role="region" with correct aria-label', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycle Detection" emptyLabel="No cycles" onClose={mockOnClose} />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Cycle Detection');
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(document.querySelector('.cg-analysis-panel.cg-cycle-panel')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeInTheDocument();
    expect(document.querySelector('.cg-cycle-count-badge')).toBeInTheDocument();
  });

  it('renders cycle node tags with correct count', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    const nodeTags = document.querySelectorAll('.cg-cycle-node-tag');
    expect(nodeTags.length).toBe(5);
  });

  it('renders inter-node arrows between nodes in cycle', () => {
    render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    const arrows = document.querySelectorAll('.cg-cycle-arrow');
    expect(arrows.length).toBe(5);
  });

  it('updates when cycles prop changes', () => {
    const { rerender } = render(<CyclePanel cycles={sampleCycles} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    rerender(<CyclePanel cycles={[]} label="Cycles" emptyLabel="No cycles" onClose={mockOnClose} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No cycles')).toBeInTheDocument();
  });
});