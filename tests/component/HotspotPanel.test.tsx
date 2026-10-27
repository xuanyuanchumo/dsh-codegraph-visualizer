/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { HotspotPanel } from '../../src/client/components/HotspotPanel.tsx';
import type { HotspotNode } from '../../src/client/hooks/useAnalysisPanels.ts';

const sampleHotspots: HotspotNode[] = [
  { nodeId: 'n1', label: 'functionA', filePath: 'src/a.ts', indegree: 15, churn: 42, hotspotScore: 57, level: 'critical' },
  { nodeId: 'n2', label: 'functionB', filePath: 'src/b.ts', indegree: 10, churn: 20, hotspotScore: 30, level: 'warning' },
  { nodeId: 'n3', label: 'functionC', filePath: 'src/c.ts', indegree: 6, churn: 5, hotspotScore: 11, level: 'info' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HotspotPanel component', () => {
  it('renders label in header', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('Hotspots')).toBeInTheDocument();
  });

  it('renders hotspot labels', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('functionA')).toBeInTheDocument();
    expect(screen.getByText('functionB')).toBeInTheDocument();
    expect(screen.getByText('functionC')).toBeInTheDocument();
  });

  it('renders indegree values', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('renders level badges', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={onClose} label="Hotspots" />);
    const closeBtn = screen.getByRole('button');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has role="region"@ with correct aria-label', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspot Analysis" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('Hotspot Analysis');
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(document.querySelector('.cg-analysis-panel.cg-hotspot-panel')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeInTheDocument();
  });

  it('applies level-specific CSS class to hotspot items', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(document.querySelector('.cg-hotspot-item.cg-critical')).toBeInTheDocument();
    expect(document.querySelector('.cg-hotspot-item.cg-warning')).toBeInTheDocument();
    expect(document.querySelector('.cg-hotspot-item.cg-info')).toBeInTheDocument();
  });

  it('limits display to 20 hotspots', () => {
    const manyHotspots: HotspotNode[] = Array.from({ length: 30 }, (_, i) => ({
      nodeId: `n${i}`,
      label: `func${i}`,
      filePath: `src/f${i}.ts`,
      indegree: i + 1,
      churn: i,
      hotspotScore: i + 1,
      level: 'info',
    }));
    render(<HotspotPanel hotspotNodes={manyHotspots} onClose={vi.fn()} label="Hotspots" />);
    const items = document.querySelectorAll('.cg-hotspot-item');
    expect(items.length).toBe(20);
  });

  it('renders empty list without crashing', () => {
    render(<HotspotPanel hotspotNodes={[]} onClose={vi.fn()} label="Hotspots" />);
    const items = document.querySelectorAll('.cg-hotspot-item');
    expect(items.length).toBe(0);
  });

  it('updates when hotspotNodes prop changes', () => {
    const { rerender } = render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('functionA')).toBeInTheDocument();
    rerender(<HotspotPanel hotspotNodes={[{ nodeId: 'new', label: 'newFunc', filePath: 'src/new.ts', indegree: 99, churn: 10, hotspotScore: 109, level: 'critical' }]} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('newFunc')).toBeInTheDocument();
    expect(screen.queryByText('functionA')).toBeNull();
  });
});