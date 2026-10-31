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
    expect(screen.getByText(/错误|error/i)).toBeInTheDocument();
  });

  it('shows loading status when isLoading is true', () => {
    render(<StatusBar error={null} isLoading={true} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/加载|loading/i)).toBeInTheDocument();
  });

  it('shows ready status when no error and not loading', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/就绪|ready/i)).toBeInTheDocument();
  });

  it('shows workspace name when provided', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} workspaceName="/path/to/repo" />);
    expect(screen.getByText('repo')).toBeInTheDocument();
  });

  it('shows truncated indicator when truncated is true', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} truncated={true} totalNodeCount={1000} displayedNodeCount={500} />);
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });

  it('shows complete indicator when not truncated and totalNodeCount > 0', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} totalNodeCount={500} />);
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('shows watch indicator when watchEnabled is true', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={true} />);
    expect(screen.getByText('●')).toBeInTheDocument();
  });

  it('shows update time when lastUpdated > 0', () => {
    const ts = Date.now();
    render(<StatusBar error={null} isLoading={false} lastUpdated={ts} watchEnabled={false} />);
    expect(screen.getByText(/更新|updated/i)).toBeInTheDocument();
  });

  it('shows no-data when lastUpdated is 0', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.getByText(/无数据|no data/i)).toBeInTheDocument();
  });

  it('shows degradation indicator when performanceDegradations is non-empty', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} performanceDegradations={['cycle-detection-skipped']} />);
    expect(screen.getByText(/循环检测已跳过|cycle detection skipped/i)).toBeInTheDocument();
  });

  it('shows multiple degradation indicators joined by comma', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} performanceDegradations={['cycle-detection-skipped', 'large-graph-mode']} />);
    expect(screen.getByText(/循环检测已跳过|cycle detection skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/大规模图谱模式|large graph mode/i)).toBeInTheDocument();
  });

  it('does not show degradation indicator when performanceDegradations is empty', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} performanceDegradations={[]} />);
    expect(screen.queryByText(/循环检测已跳过|cycle detection skipped/i)).toBeNull();
  });

  it('does not show degradation indicator when performanceDegradations is undefined', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    expect(screen.queryByText(/循环检测已跳过|cycle detection skipped/i)).toBeNull();
  });

  it('renders GitHub feedback link with correct URL', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    const link = screen.getByRole('link');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('https://github.com/xuanyuanchumo/dsh-codegraph-visualizer');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('GitHub feedback link has accessibility label', () => {
    render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-label')).toBeTruthy();
  });

  // ── 璇玑图增量引擎健康信号（cycle-122，XJ-11 消费端收口的 UI 半环）──
  describe('xuanji signal badge', () => {
    it('applied=true 显示「增量 +N」量化徽标', () => {
      render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false}
        xuanjiSignal={{ applied: true, addedPaths: 42 }} />);
      expect(screen.getByText(/增量 \+42/)).toBeInTheDocument();
    });

    it('xuanjiSignal 缺省/null 不显示（全量重建/未收到信号不伪造观测）', () => {
      const { container } = render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} />);
      expect(container.querySelector('.cg-status-xuanji')).toBeNull();
      const { container: c2 } = render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false} xuanjiSignal={null} />);
      expect(c2.querySelector('.cg-status-xuanji')).toBeNull();
    });

    it('applied=false（skipped）不显示——引擎没跑就不量化', () => {
      const { container } = render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false}
        xuanjiSignal={{ applied: false }} />);
      expect(container.querySelector('.cg-status-xuanji')).toBeNull();
    });

    it('degradedRules 非空 → 徽标染警示色（cg-xuanji-degraded）+ 悬停含规则名', () => {
      render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false}
        xuanjiSignal={{ applied: true, addedPaths: 3, degradedRules: ['cycles'] }} />);
      const badge = screen.getByText(/增量 \+3/).closest('.cg-status-xuanji');
      expect(badge).toBeTruthy();
      expect(badge!.className).toContain('cg-xuanji-degraded');
      expect(badge!.getAttribute('title')).toContain('cycles');
    });

    it('invariantViolations 也触发警示染色', () => {
      render(<StatusBar error={null} isLoading={false} lastUpdated={0} watchEnabled={false}
        xuanjiSignal={{ applied: true, invariantViolations: ['reachable'] }} />);
      expect(screen.getByText(/增量 \+/).closest('.cg-status-xuanji')!.className).toContain('cg-xuanji-degraded');
    });
  });
});
