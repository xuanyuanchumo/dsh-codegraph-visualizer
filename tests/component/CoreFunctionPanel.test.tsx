import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { CoreFunctionPanel } from '../../src/client/components/CoreFunctionPanel.tsx';
import type { CoreFunction } from '../../src/shared/analysis/CoreFunctionAnalyzer.ts';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('CoreFunctionPanel', () => {
  const mockFunctions: CoreFunction[] = [
    {
      nodeId: 'fn-1' as never,
      label: 'main',
      filePath: 'src/main.ts',
      category: 'entry',
      score: 0.95,
      reasons: ['entry-point', 'high-outdegree'],
      inDegree: 0,
      outDegree: 10,
      influenceReach: 50,
      callChainDepth: 5,
    },
    {
      nodeId: 'fn-2' as never,
      label: 'processData',
      filePath: 'src/process.ts',
      category: 'hub',
      score: 0.85,
      reasons: ['high-indegree', 'high-outdegree'],
      inDegree: 8,
      outDegree: 6,
      influenceReach: 30,
      callChainDepth: 3,
    },
    {
      nodeId: 'fn-3' as never,
      label: 'apiHandler',
      filePath: 'src/api.ts',
      category: 'api',
      score: 0.75,
      reasons: ['handler-pattern'],
      inDegree: 2,
      outDegree: 4,
      influenceReach: 15,
      callChainDepth: 2,
    },
  ];

  const defaultProps = {
    coreFunctions: mockFunctions,
    onClose: vi.fn(),
    label: '核心函数分析',
    onSelectFunction: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('应渲染面板标题', () => {
    const { getByText } = render(<CoreFunctionPanel {...defaultProps} />);
    expect(getByText('核心函数分析')).toBeTruthy();
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<CoreFunctionPanel {...defaultProps} onClose={onClose} />);
    const closeBtn = container.querySelector('.cg-close-btn');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('应渲染核心函数列表', () => {
    const { getByText } = render(<CoreFunctionPanel {...defaultProps} />);
    expect(getByText('main')).toBeTruthy();
    expect(getByText('processData')).toBeTruthy();
    expect(getByText('apiHandler')).toBeTruthy();
  });

  it('应显示函数分数', () => {
    const { getByText } = render(<CoreFunctionPanel {...defaultProps} />);
    expect(getByText('0.95')).toBeTruthy();
    expect(getByText('0.85')).toBeTruthy();
    expect(getByText('0.75')).toBeTruthy();
  });

  it('应显示函数统计信息', () => {
    const { getByText } = render(<CoreFunctionPanel {...defaultProps} />);
    expect(getByText('in:0')).toBeTruthy();
    expect(getByText('out:10')).toBeTruthy();
    expect(getByText('reach:50')).toBeTruthy();
    expect(getByText('depth:5')).toBeTruthy();
  });

  it('点击函数项应调用 onSelectFunction', () => {
    const onSelectFunction = vi.fn();
    const { getByText } = render(
      <CoreFunctionPanel {...defaultProps} onSelectFunction={onSelectFunction} />
    );
    fireEvent.click(getByText('main'));
    expect(onSelectFunction).toHaveBeenCalledWith('fn-1');
  });

  it('应显示分类徽章', () => {
    const { container } = render(<CoreFunctionPanel {...defaultProps} />);
    const badges = container.querySelectorAll('.cg-core-function-category-badge');
    expect(badges.length).toBe(3);
  });

  it('应显示原因标签', () => {
    const { container } = render(<CoreFunctionPanel {...defaultProps} />);
    const tags = container.querySelectorAll('.cg-core-function-reason-tag');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('应有 role=region 无障碍属性', () => {
    const { container } = render(<CoreFunctionPanel {...defaultProps} />);
    expect(container.querySelector('[role="region"]')).toBeTruthy();
  });

  it('应有 aria-live=polite 无障碍属性', () => {
    const { container } = render(<CoreFunctionPanel {...defaultProps} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('空列表时不应崩溃', () => {
    const { container } = render(
      <CoreFunctionPanel {...defaultProps} coreFunctions={[]} />
    );
    expect(container.querySelector('.core-function-panel')).toBeTruthy();
  });

  it('按 Enter 键应调用 onSelectFunction', () => {
    const onSelectFunction = vi.fn();
    const { container } = render(
      <CoreFunctionPanel {...defaultProps} onSelectFunction={onSelectFunction} />
    );
    const items = container.querySelectorAll('.cg-core-function-item');
    expect(items.length).toBeGreaterThan(0);
    fireEvent.keyDown(items[0]!, { key: 'Enter' });
    expect(onSelectFunction).toHaveBeenCalledWith('fn-1');
  });

  it('按 Space 键应调用 onSelectFunction', () => {
    const onSelectFunction = vi.fn();
    const { container } = render(
      <CoreFunctionPanel {...defaultProps} onSelectFunction={onSelectFunction} />
    );
    const items = container.querySelectorAll('.cg-core-function-item');
    fireEvent.keyDown(items[0]!, { key: ' ' });
    expect(onSelectFunction).toHaveBeenCalledWith('fn-1');
  });

  it('超过20个函数时只显示前20个', () => {
    const many: CoreFunction[] = Array.from({ length: 25 }, (_, i) => ({
      nodeId: `fn-${i}` as never,
      label: `func${i}`,
      filePath: `src/func${i}.ts`,
      category: 'entry' as const,
      score: 0.5,
      reasons: [],
      inDegree: 0,
      outDegree: 0,
      influenceReach: 0,
      callChainDepth: 0,
    }));
    const { container } = render(
      <CoreFunctionPanel {...defaultProps} coreFunctions={many} />
    );
    const items = container.querySelectorAll('.cg-core-function-item');
    expect(items.length).toBe(20);
  });
});