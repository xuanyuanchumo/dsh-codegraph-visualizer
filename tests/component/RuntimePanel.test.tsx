/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

import { RuntimePanel } from '../../src/client/components/RuntimePanel.tsx';
import { logger, resetLoggerListeners } from '../../src/shared/Logger.ts';
import { clearMeasurements, setThreshold, measureSync } from '../../src/shared/PerformanceMonitor.ts';
import { PERF } from '../../src/shared/constants.ts';
import { setLang } from '../../src/client/i18n/index.ts';

/**
 * 运行时层面板测试（cycle-88，P2-1 三层独立面板）。
 *
 * 面板直接读两个模块级单例（`logger` / `PerformanceMonitor`），所以这里
 * 用真实的单例 + 在 beforeEach 里清空，而不是 mock 掉——mock 掉就无法发现
 * 「面板读错了数据源」这类缺陷。
 */

beforeEach(() => {
  logger.clear();
  clearMeasurements();
  resetLoggerListeners();
  setLang('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  logger.clear();
  clearMeasurements();
  resetLoggerListeners();
  // 阈值表是模块级单例，且 clearMeasurements() 不会重置它——不还原就会把
  // 「layout 已降级」泄漏给后面的用例，制造顺序相关的假失败。
  setThreshold('layout', {
    warnMs: PERF.LAYOUT_WARN_MS,
    degradeMs: PERF.LAYOUT_DEGRADE_MS,
    degradationKey: 'slow-layout',
  });
});

describe('RuntimePanel', () => {
  it('renders the given label in the panel header', () => {
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(screen.getByText('Runtime')).toBeInTheDocument();
  });

  it('renders the time window budget so the limit is visible in the UI', () => {
    // 风险 8（docs/图谱按需加载.md:238-241）要求 UI 明确「不是数据没有，而是按预算展开」。
    // 时间窗口是这一层的两条预算之一，必须显示出来而不是藏在代码里。
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const windowBar = document.querySelector('.cg-runtime-window');
    expect(windowBar).not.toBeNull();
    expect(windowBar!.textContent).toContain('5');
  });

  it('shows the empty state instead of an empty list when nothing is observable', () => {
    // 该面板的价值之一就是显示「窗口内没有数据」这一事实本身。
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(document.querySelector('.cg-runtime-empty')).not.toBeNull();
    expect(document.querySelector('.cg-runtime-log-list')).toBeNull();
  });

  it('renders log rows from the logger ring buffer', () => {
    logger.info('host', 'indexed workspace');
    logger.warn('client', 'layout worker slow');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(screen.getByText('indexed workspace')).toBeInTheDocument();
    expect(screen.getByText('layout worker slow')).toBeInTheDocument();
    expect(document.querySelectorAll('.cg-runtime-log-row')).toHaveLength(2);
  });

  it('renders one level count per log level', () => {
    logger.warn('host', 'w');
    logger.error('host', 'e');
    logger.error('host', 'e2');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const counts = document.querySelectorAll('.cg-runtime-level-count');
    expect(counts).toHaveLength(4);
    const errorCount = document.querySelector('.cg-runtime-level-count.cg-error');
    expect(errorCount!.textContent).toContain('2');
  });

  it('replaces the whole body with the empty state when nothing is observable', () => {
    // 空态是**整体替换**而不是"列表为空"：面板要显式说明「不是数据没有，
    // 而是这一层还没有可观测数据」，而不是让用户看到一排空标题。
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(document.querySelector('.cg-runtime-empty')).not.toBeNull();
    expect(document.querySelectorAll('.cg-runtime-section-header')).toHaveLength(0);
    expect(document.querySelector('.cg-runtime-footnote')).toBeNull();
  });

  it('renders the metrics section header when there are logs but no samples', () => {
    logger.info('host', 'a line');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(screen.getByText('Performance metrics')).toBeInTheDocument();
    expect(document.querySelectorAll('.cg-runtime-metric-row')).toHaveLength(0);
  });

  it('renders a metric row for a recorded measurement', () => {
    // 用真实的 measureSync 记录样本（而不是伪造 measurements 数组）：
    // 面板读的就是这个单例，绕过它写样本会让「面板读错了数据源」永远测不出来。
    measureSync('layout', () => {
      const until = Date.now() + 5;
      while (Date.now() < until) { /* 忙等以产生非零耗时 */ }
    });
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const rows = document.querySelectorAll('.cg-runtime-metric-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector('.cg-runtime-metric-name')!.textContent).toBe('layout');
    // 样本数必须显示出来，否则「1 行」与「1 个样本」无法区分
    expect(rows[0]!.querySelector('.cg-runtime-metric-count')!.textContent).toContain('1');
  });

  it('marks a metric as degraded when its windowed average reaches the threshold', () => {
    // 阈值设成 0：任何非负耗时都达标，从而不需要控制真实耗时就能断言降级标记。
    setThreshold('layout', { degradeMs: 0 });
    measureSync('layout', () => { /* 产生一个样本 */ });
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const row = document.querySelector('.cg-runtime-metric-row');
    expect(row).not.toBeNull();
    expect(row!.querySelector('.cg-runtime-metric-degraded')).not.toBeNull();
  });

  it('filters log rows by level', () => {
    logger.info('host', 'an info line');
    logger.error('host', 'an error line');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const select = document.querySelector('.cg-runtime-level-filter') as HTMLSelectElement;
    expect(select).not.toBeNull();
    fireEvent.change(select, { target: { value: 'error' } });
    expect(screen.getByText('an error line')).toBeInTheDocument();
    expect(screen.queryByText('an info line')).toBeNull();
  });

  it('keeps every level option in the filter dropdown', () => {
    logger.info('host', 'x');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const options = Array.from(document.querySelectorAll('.cg-runtime-level-filter option'));
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['all', 'debug', 'info', 'warn', 'error']);
  });

  it('refreshes the snapshot when a new log arrives after mount', () => {
    // 纯订阅的路径：logger.subscribe 在有新日志时回调，面板必须重绘。
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(document.querySelector('.cg-runtime-empty')).not.toBeNull();
    act(() => { logger.info('host', 'arrived after mount'); });
    expect(screen.getByText('arrived after mount')).toBeInTheDocument();
  });

  it('advances the window on its own timer even when no log arrives', () => {
    // 窗口边界随时间前进这件事不产生任何日志，只靠订阅的面板会停在旧数据上。
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(setIntervalSpy).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(document.querySelector('.cg-runtime-window')).not.toBeNull();
  });

  it('renders the truncation notice only when the entry budget cut data', () => {
    // 正常量级下不应出现「已折叠」提示。
    logger.info('host', 'only one line');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(document.querySelector('.cg-runtime-truncated')).toBeNull();
  });

  it('closes via the header close button', () => {
    const onClose = vi.fn();
    render(<RuntimePanel onClose={onClose} label="Runtime" />);
    const closeBtn = document.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('declares that no Trace ID dimension is wired up', () => {
    // 诚实声明：不能因为「面板看起来完整」就假装 Trace ID 已接入。
    // 该声明只在有数据的渲染分支里出现（空态是整体替换），所以先造一条日志。
    logger.info('host', 'a line');
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    const footnote = document.querySelector('.cg-runtime-footnote');
    expect(footnote).not.toBeNull();
    expect(footnote!.textContent).toContain('Trace ID');
  });

  it('uses the runtime panel shell variant so it shares the standard chrome', () => {
    render(<RuntimePanel onClose={vi.fn()} label="Runtime" />);
    expect(document.querySelector('.cg-analysis-panel.cg-runtime-panel')).not.toBeNull();
  });
});
