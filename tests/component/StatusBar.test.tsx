/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { StatusBar } from '../../src/client/components/StatusBar.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StatusBar component', () => {
  it('shows error status when error is present', () => {
    render(<StatusBar error="something broke" isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/错误|error/i)).toBeTruthy();
  });

  it('shows loading status when isLoading is true', () => {
    render(<StatusBar error={null} isLoading={true} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/加载|loading/i)).toBeTruthy();
  });

  it('shows ready status when no error and not loading', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/就绪|ready/i)).toBeTruthy();
  });

  it('shows workspace name when provided', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} workspaceName="/path/to/repo" />);
    expect(screen.getByText('repo')).toBeTruthy();
  });

  it('shows truncated indicator when truncated is true', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} truncated={true} totalNodeCount={1000} displayedNodeCount={500} />);
    expect(screen.getByText(/500/)).toBeTruthy();
    expect(screen.getByText(/1000/)).toBeTruthy();
  });

  it('shows complete indicator when not truncated and totalNodeCount > 0', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} totalNodeCount={500} />);
    expect(screen.getByText(/500/)).toBeTruthy();
  });

  it('shows watch indicator when watchEnabled is true', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={true} />);
    expect(screen.getByText('●')).toBeTruthy();
  });

  it('shows update time when lastUpdated > 0', () => {
    const ts = Date.now();
    render(<StatusBar error={null} isLoading={false} lastUpdated={ts} watchEnabled={false} />);
    expect(screen.getByText(/更新|updated/i)).toBeTruthy();
  });

  it('shows no-data when lastUpdated is 0', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/无数据|no data/i)).toBeTruthy();
  });

  it('shows degradation indicator when performanceDegradations is non-empty', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} performanceDegradations={['cycle-detection-skipped']} />);
    expect(screen.getByText(/循环检测已跳过|cycle detection skipped/i)).toBeTruthy();
  });

  it('shows multiple degradation indicators joined by comma', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} performanceDegradations={['cycle-detection-skipped', 'large-graph-mode']} />);
    expect(screen.getByText(/循环检测已跳过|cycle detection skipped/i)).toBeTruthy();
    expect(screen.getByText(/大规模图谱模式|large graph mode/i)).toBeTruthy();
  });

  it('does not show degradation indicator when performanceDegradations is empty', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} performanceDegradations={[]} />);
    expect(screen.queryByText(/循环检测已跳过|cycle detection skipped/i)).toBeNull();
  });

  it('does not show degradation indicator when performanceDegradations is undefined', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.queryByText(/循环检测已跳过|cycle detection skipped/i)).toBeNull();
  });
});
