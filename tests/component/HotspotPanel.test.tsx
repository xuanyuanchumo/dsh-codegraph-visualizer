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
  { nodeId: 'n1', label: 'functionA', indegree: 15, level: 'critical' },
  { nodeId: 'n2', label: 'functionB', indegree: 10, level: 'warning' },
  { nodeId: 'n3', label: 'functionC', indegree: 6, level: 'info' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HotspotPanel component', () => {
  it('renders label in header', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('Hotspots')).toBeTruthy();
  });

  it('renders hotspot labels', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('functionA')).toBeTruthy();
    expect(screen.getByText('functionB')).toBeTruthy();
    expect(screen.getByText('functionC')).toBeTruthy();
  });

  it('renders indegree values', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('renders level badges', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('critical')).toBeTruthy();
    expect(screen.getByText('warning')).toBeTruthy();
    expect(screen.getByText('info')).toBeTruthy();
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
    expect(document.querySelector('.cg-analysis-panel.hotspot-panel')).toBeTruthy();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeTruthy();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeTruthy();
  });

  it('applies level-specific CSS class to hotspot items', () => {
    render(<HotspotPanel hotspotNodes={sampleHotspots} onClose={vi.fn()} label="Hotspots" />);
    expect(document.querySelector('.cg-hotspot-item.cg-critical')).toBeTruthy();
    expect(document.querySelector('.cg-hotspot-item.cg-warning')).toBeTruthy();
    expect(document.querySelector('.cg-hotspot-item.cg-info')).toBeTruthy();
  });

  it('limits display to 20 hotspots', () => {
    const manyHotspots: HotspotNode[] = Array.from({ length: 30 }, (_, i) => ({
      nodeId: `n${i}`,
      label: `func${i}`,
      indegree: i + 1,
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
    expect(screen.getByText('functionA')).toBeTruthy();
    rerender(<HotspotPanel hotspotNodes={[{ nodeId: 'new', label: 'newFunc', indegree: 99, level: 'critical' }]} onClose={vi.fn()} label="Hotspots" />);
    expect(screen.getByText('newFunc')).toBeTruthy();
    expect(screen.queryByText('functionA')).toBeNull();
  });
});