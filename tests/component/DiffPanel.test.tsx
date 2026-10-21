// 旅程覆盖：J19（FR-24 版本对比——DiffPanel 面板的输入/计数/差额披露/失败块）。
// @vitest-environment jsdom
/**
 * DiffPanel 组件测试（cycle-104，研究报告 §六 #13）。
 *
 * 面板的验收条款有三条，全部与「用户会不会被误导」有关：
 *   1. 首次打开必须能看到两个输入框（否则「点开开关什么都没发生」）；
 *   2. 失败与「0 处变更」必须视觉可分（失败不得渲染成「没有差异」）；
 *   3. 必须披露「已标记 / 未渲染」的差额（否则用户数着计数找不到对应的框）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { DiffPanel } from '../../src/client/components/DiffPanel.tsx';
import { setLang } from '../../src/client/i18n/index.ts';
import { buildDiffIndex } from '../../src/shared/diffStatus.ts';
import type { DiffState } from '../../src/client/store/types.ts';
import { NodeId } from '../../src/types/index.ts';

function makeDiffState(from = 'main', to = 'feature'): DiffState {
  const nodes = [
    { id: NodeId('n1'), label: 'A', type: 'function' as const, filePath: 'a.ts', lineNumber: 1, properties: { diffStatus: 'added' } },
    { id: NodeId('n2'), label: 'B', type: 'function' as const, filePath: 'a.ts', lineNumber: 2, properties: { diffStatus: 'modified' } },
    { id: NodeId('n3'), label: 'C', type: 'function' as const, filePath: 'b.ts', lineNumber: 3, properties: { diffStatus: 'removed' } },
  ];
  return { from, to, nodes, edges: [], index: buildDiffIndex(nodes, []), requestedAt: 1 };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof DiffPanel>> = {}) {
  const props = {
    diffResult: null,
    markStats: null,
    isComparing: false,
    errorMessage: null,
    onCompare: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(React.createElement(DiffPanel, props)), props };
}

beforeEach(() => {
  // 固定英文，断言文案时不依赖中文标点
  setLang('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DiffPanel', () => {
  it('shows both ref inputs before any comparison has run', () => {
    renderPanel();
    expect(screen.getByLabelText('Base ref')).toBeInTheDocument();
    expect(screen.getByLabelText('Target ref')).toBeInTheDocument();
    expect(screen.getByText('Enter two git refs to compare')).toBeInTheDocument();
  });

  it('submits the trimmed refs', () => {
    const { props } = renderPanel();
    fireEvent.change(screen.getByLabelText('Base ref'), { target: { value: '  main  ' } });
    fireEvent.change(screen.getByLabelText('Target ref'), { target: { value: ' feature ' } });
    fireEvent.click(screen.getByText('Compare'));
    expect(props.onCompare).toHaveBeenCalledWith('main', 'feature');
  });

  it('does not submit when either ref is blank', () => {
    // 空引用会被宿主以 COMMITS_REQUIRED 拒绝；先发一次注定失败的往返只是浪费用户时间。
    const { props } = renderPanel();
    fireEvent.change(screen.getByLabelText('Base ref'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Compare'));
    expect(props.onCompare).not.toHaveBeenCalled();
  });

  it('disables the compare button while a request is in flight', () => {
    renderPanel({ isComparing: true });
    const button = screen.getByRole('button', { name: 'Comparing…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the three change counts from markStats', () => {
    const diffResult = makeDiffState();
    renderPanel({
      diffResult,
      markStats: { counts: { added: 1, modified: 1, removed: 1 }, missing: 0, marked: 3 },
    });
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    // 三个 1 是三个状态各自的计数
    expect(screen.getAllByText('1')).toHaveLength(3);
  });

  it('shows the compared range', () => {
    renderPanel({
      diffResult: makeDiffState('v1.0.0', 'v1.1.0'),
      markStats: { counts: { added: 0, modified: 0, removed: 0 }, missing: 0, marked: 0 },
    });
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
  });

  it('reports all-marked when nothing is missing', () => {
    renderPanel({
      diffResult: makeDiffState(),
      markStats: { counts: { added: 2, modified: 0, removed: 0 }, missing: 0, marked: 2 },
    });
    expect(screen.getByText('2 changes marked')).toBeInTheDocument();
  });

  it('discloses the un-rendered remainder instead of hiding it', () => {
    // 这条是面板的诚实性条款：计数说「新增 3」，画布只亮 1 个时用户必须能读到解释。
    renderPanel({
      diffResult: makeDiffState(),
      markStats: { counts: { added: 3, modified: 0, removed: 0 }, missing: 2, marked: 1 },
    });
    expect(screen.getByText(/1 of 3 marked/)).toBeInTheDocument();
    expect(screen.getByText(/2 outside the current view/)).toBeInTheDocument();
  });

  it('shows the no-change message when the diff is empty', () => {
    renderPanel({
      diffResult: makeDiffState(),
      markStats: { counts: { added: 0, modified: 0, removed: 0 }, missing: 0, marked: 0 },
    });
    expect(screen.getByText('No structural graph change between the two refs')).toBeInTheDocument();
  });

  it('shows an error block on failure and keeps it distinct from an empty diff', () => {
    // 关键断言：失败时**不能**出现「没有变更」的文案——那是把失败说成事实。
    renderPanel({ errorMessage: 'Diff request failed — check that both refs exist' });
    expect(screen.getByRole('alert')).toHaveTextContent('Diff request failed');
    expect(screen.queryByText('No structural graph change between the two refs')).toBeNull();
  });

  it('renders the clear button only when a result exists', () => {
    const { unmount } = renderPanel();
    expect(screen.queryByText('Clear diff')).toBeNull();
    unmount();

    renderPanel({
      diffResult: makeDiffState(),
      markStats: { counts: { added: 1, modified: 0, removed: 0 }, missing: 0, marked: 1 },
    });
    expect(screen.getByText('Clear diff')).toBeInTheDocument();
  });

  it('calls onClear from the clear button', () => {
    const { props } = renderPanel({
      diffResult: makeDiffState(),
      markStats: { counts: { added: 1, modified: 0, removed: 0 }, missing: 0, marked: 1 },
    });
    fireEvent.click(screen.getByText('Clear diff'));
    expect(props.onClear).toHaveBeenCalled();
  });

  it('calls onClose from the header close button', () => {
    const { props } = renderPanel();
    // AnalysisPanelShell 的关闭按钮带 aria-label（i18n 的 common.close）
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(props.onClose).toHaveBeenCalled();
  });
});
