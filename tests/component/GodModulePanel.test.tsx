/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { GodModulePanel, GOD_MODULE_THRESHOLD_MIN, GOD_MODULE_THRESHOLD_MAX } from '../../src/client/components/GodModulePanel.tsx';
import type { GodModule } from '../../src/client/hooks/useAnalysisPanels.ts';

const sampleModules: GodModule[] = [
  { modulePath: 'src/core/engine.ts', nodeCount: 50, edgeCount: 120, suggestion: 'Consider splitting into smaller modules' },
  { modulePath: 'src/utils/helpers.ts', nodeCount: 30, edgeCount: 60, suggestion: 'Extract utility functions' },
];

/** 渲染辅助：GodModulePanelProps 在 cycle-113 增加了扫描态/阈值 props，集中在一处补默认值。 */
function renderPanel(overrides: Partial<Parameters<typeof GodModulePanel>[0]> = {}) {
  const props: Parameters<typeof GodModulePanel>[0] = {
    godModules: sampleModules,
    godModuleScan: { scanned: true, nodeCount: 80 },
    threshold: 50,
    onThresholdChange: vi.fn(),
    onClose: vi.fn(),
    label: 'God Modules',
    statsLabel: (n, e) => `${n} nodes, ${e} edges`,
    emptyLabel: 'no modules above threshold',
    waitLabel: 'waiting for graph data',
    thresholdLabel: 'threshold',
    ...overrides,
  };
  return render(<GodModulePanel {...props} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GodModulePanel component', () => {
  it('renders label in header', () => {
    renderPanel();
    expect(screen.getByText('God Modules')).toBeInTheDocument();
  });

  it('renders module paths', () => {
    renderPanel();
    expect(screen.getByText('src/core/engine.ts')).toBeInTheDocument();
    expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument();
  });

  it('renders stats via statsLabel callback', () => {
    renderPanel({ statsLabel: (n, e) => `${n}n/${e}e` });
    expect(screen.getByText('50n/120e')).toBeInTheDocument();
    expect(screen.getByText('30n/60e')).toBeInTheDocument();
  });

  it('renders suggestions', () => {
    renderPanel({ statsLabel: (n, e) => `${n}, ${e}` });
    expect(screen.getByText('Consider splitting into smaller modules')).toBeInTheDocument();
    expect(screen.getByText('Extract utility functions')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });
    const closeBtn = screen.getByRole('button');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has role="region" with correct aria-label', () => {
    renderPanel({ label: 'God Module Detection' });
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('God Module Detection');
  });

  it('has aria-live="polite" for accessibility', () => {
    renderPanel();
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    renderPanel();
    expect(document.querySelector('.cg-analysis-panel.cg-godmodule-panel')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-item')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-path')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-stats')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-suggestion')).toBeInTheDocument();
  });

  it('renders honest empty state when scanned but no results', () => {
    renderPanel({ godModules: [], godModuleScan: { scanned: true, nodeCount: 13 } });
    expect(screen.getByRole('status')).toHaveTextContent('no modules above threshold');
    // 空态时阈值控件仍然可用——这是「功能坏了」与「没有数据」区分的关键
    expect(document.querySelector('.cg-godmodule-threshold-input')).toBeInTheDocument();
  });

  it('renders wait state when never scanned', () => {
    renderPanel({ godModules: [], godModuleScan: { scanned: false, nodeCount: 0 } });
    expect(screen.getByRole('status')).toHaveTextContent('waiting for graph data');
  });

  it('empty list without scanned state does NOT show empty message (wait state instead)', () => {
    renderPanel({ godModules: [], godModuleScan: { scanned: false, nodeCount: 0 } });
    const items = document.querySelectorAll('.cg-godmodule-item');
    expect(items.length).toBe(0);
    expect(document.querySelector('.cg-godmodule-wait')).toBeInTheDocument();
  });

  it('updates when godModules prop changes', () => {
    const { rerender } = renderPanel();
    expect(screen.getByText('src/core/engine.ts')).toBeInTheDocument();
    rerender(<GodModulePanel
      godModules={[{ modulePath: 'new.ts', nodeCount: 1, edgeCount: 1, suggestion: 'New' }]}
      godModuleScan={{ scanned: true, nodeCount: 5 }}
      threshold={50}
      onThresholdChange={vi.fn()}
      onClose={vi.fn()}
      label="God Modules"
      statsLabel={(n, e) => `${n}`}
      emptyLabel="empty"
      waitLabel="wait"
      thresholdLabel="threshold"
    />);
    expect(screen.getByText('new.ts')).toBeInTheDocument();
    expect(screen.queryByText('src/core/engine.ts')).toBeNull();
  });

  // ---- cycle-113 阈值控件 ----

  it('renders threshold input with current value', () => {
    renderPanel({ threshold: 50 });
    const input = document.querySelector('.cg-godmodule-threshold-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('50');
  });

  it('calls onThresholdChange with parsed value', async () => {
    // 受控 input 的 value 由父组件回写；测试里回调不回写 ⇒ value 恒为初始 50，
    // user.type 会变成追加（"50"→"500"）。因此用 fireEvent.change 直接设目标值，
    // 断言解析（parseInt）与回调形状——钳制逻辑由「clamps」两例覆盖。
    const onThresholdChange = vi.fn();
    renderPanel({ threshold: 50, onThresholdChange });
    const input = document.querySelector('.cg-godmodule-threshold-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    expect(onThresholdChange).toHaveBeenLastCalledWith(10);
  });

  it('clamps below minimum to GOD_MODULE_THRESHOLD_MIN', async () => {
    const onThresholdChange = vi.fn();
    renderPanel({ threshold: 50, onThresholdChange });
    const input = document.querySelector('.cg-godmodule-threshold-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    expect(onThresholdChange).toHaveBeenLastCalledWith(GOD_MODULE_THRESHOLD_MIN);
  });

  it('clamps above maximum to GOD_MODULE_THRESHOLD_MAX', async () => {
    const onThresholdChange = vi.fn();
    renderPanel({ threshold: 50, onThresholdChange });
    const input = document.querySelector('.cg-godmodule-threshold-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999999' } });
    expect(onThresholdChange).toHaveBeenLastCalledWith(GOD_MODULE_THRESHOLD_MAX);
  });

  it('ignores non-numeric input (NaN guard)', async () => {
    const onThresholdChange = vi.fn();
    renderPanel({ threshold: 50, onThresholdChange });
    const input = document.querySelector('.cg-godmodule-threshold-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onThresholdChange).not.toHaveBeenCalled();
  });

  it('boundary constants are sane', () => {
    expect(GOD_MODULE_THRESHOLD_MIN).toBe(1);
    expect(GOD_MODULE_THRESHOLD_MAX).toBeGreaterThan(GOD_MODULE_THRESHOLD_MIN);
  });
});
