/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { ImpactPanel } from '../../src/client/components/ImpactPanel.tsx';
import type { ImpactStats } from '../../src/client/hooks/useAnalysisPanels.ts';

const sampleStats: ImpactStats = {
  d1: 5,
  d2: 12,
  d3: 8,
  total: 25,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImpactPanel component', () => {
  it('renders D1, D2, D3 stat values correctly', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders total value correctly', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    expect(screen.getByText('Total: 25')).toBeInTheDocument();
  });

  it('renders label in header', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    expect(screen.getByText('Impact Analysis')).toBeInTheDocument();
  });

  it('renders totalLabel prefix before total value', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact" totalLabel="Affected Nodes" />);
    expect(screen.getByText('Affected Nodes: 25')).toBeInTheDocument();
  });

  it('renders D1, D2, D3 badge labels', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    expect(screen.getByText('D1')).toBeInTheDocument();
    expect(screen.getByText('D2')).toBeInTheDocument();
    expect(screen.getByText('D3')).toBeInTheDocument();
  });

  it('has role="region" with correct aria-label', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    const region = screen.getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Impact Analysis');
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    expect(document.querySelector('.cg-analysis-panel.cg-impact-panel')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeInTheDocument();
    expect(document.querySelectorAll('.cg-impact-stat-row').length).toBe(3);
    expect(document.querySelector('.cg-impact-stat-badge.cg-d1')).toBeInTheDocument();
    expect(document.querySelector('.cg-impact-stat-badge.cg-d2')).toBeInTheDocument();
    expect(document.querySelector('.cg-impact-stat-badge.cg-d3')).toBeInTheDocument();
    expect(document.querySelectorAll('.cg-impact-stat-count').length).toBe(3);
    expect(document.querySelector('.cg-impact-stat-total')).toBeInTheDocument();
  });

  it('renders zero values correctly', () => {
    const zeroStats: ImpactStats = { d1: 0, d2: 0, d3: 0, total: 0 };
    render(<ImpactPanel impactStats={zeroStats} label="Impact Analysis" totalLabel="Total" />);
    const counts = document.querySelectorAll('.cg-impact-stat-count');
    expect(counts[0]!.textContent).toBe('0');
    expect(counts[1]!.textContent).toBe('0');
    expect(counts[2]!.textContent).toBe('0');
    expect(screen.getByText('Total: 0')).toBeInTheDocument();
  });

  it('renders large values correctly', () => {
    const largeStats: ImpactStats = { d1: 9999, d2: 50000, d3: 100000, total: 159999 };
    render(<ImpactPanel impactStats={largeStats} label="Impact Analysis" totalLabel="Total" />);
    expect(screen.getByText('9999')).toBeInTheDocument();
    expect(screen.getByText('50000')).toBeInTheDocument();
    expect(screen.getByText('100000')).toBeInTheDocument();
    expect(screen.getByText('Total: 159999')).toBeInTheDocument();
  });

  it('renders each stat row with badge and count paired correctly', () => {
    render(<ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />);
    const rows = document.querySelectorAll('.cg-impact-stat-row');
    expect(rows.length).toBe(3);

    // D1 row
    expect(rows[0]!.querySelector('.cg-impact-stat-badge.cg-d1')?.textContent).toBe('D1');
    expect(rows[0]!.querySelector('.cg-impact-stat-count')?.textContent).toBe('5');

    // D2 row
    expect(rows[1]!.querySelector('.cg-impact-stat-badge.cg-d2')?.textContent).toBe('D2');
    expect(rows[1]!.querySelector('.cg-impact-stat-count')?.textContent).toBe('12');

    // D3 row
    expect(rows[2]!.querySelector('.cg-impact-stat-badge.cg-d3')?.textContent).toBe('D3');
    expect(rows[2]!.querySelector('.cg-impact-stat-count')?.textContent).toBe('8');
  });

  it('updates displayed values when impactStats prop changes', () => {
    const { rerender } = render(
      <ImpactPanel impactStats={sampleStats} label="Impact Analysis" totalLabel="Total" />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Total: 25')).toBeInTheDocument();

    const newStats: ImpactStats = { d1: 100, d2: 200, d3: 300, total: 600 };
    rerender(<ImpactPanel impactStats={newStats} label="Impact Analysis" totalLabel="Total" />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('Total: 600')).toBeInTheDocument();
  });
});