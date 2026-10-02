import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ErrorOverlay } from '../../src/client/components/ErrorOverlay.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('ErrorOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('error 为 null 时应返回 null', () => {
    const { container } = render(<ErrorOverlay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('应显示错误覆盖层当 error 存在时', () => {
    const { container, getByText } = render(<ErrorOverlay error="Some error" />);
    expect(container.querySelector('.cg-error-overlay')).toBeInTheDocument();
    expect(getByText('error.generic')).toBeInTheDocument();
  });

  it('应显示 loadDependencies 友好错误', () => {
    const { getByText } = render(<ErrorOverlay error="Failed to load dependencies: network" />);
    expect(getByText('error.loadDependencies')).toBeInTheDocument();
  });

  it('应显示 loadGraphData 友好错误', () => {
    const { getByText } = render(<ErrorOverlay error="Failed to load code graph data: 500" />);
    expect(getByText('error.loadGraphData')).toBeInTheDocument();
  });

  it('应显示 loadGraph 友好错误', () => {
    const { getByText } = render(<ErrorOverlay error="Failed to load code graph" />);
    expect(getByText('error.loadGraph')).toBeInTheDocument();
  });

  it('应显示重试按钮当 onRetry 提供时', () => {
    const onRetry = vi.fn();
    const { getByText } = render(<ErrorOverlay error="err" onRetry={onRetry} />);
    const btn = getByText('error.retry');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('应显示返回按钮当 onBack 提供时', () => {
    const onBack = vi.fn();
    const { getByText } = render(<ErrorOverlay error="err" onBack={onBack} />);
    const btn = getByText('micro.backToCode');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('不应显示操作按钮当 onBack 和 onRetry 都未提供时', () => {
    const { container } = render(<ErrorOverlay error="err" />);
    const actions = container.querySelector('.cg-error-overlay-actions');
    expect(actions).toBeNull();
  });

  it('应有 role=alert 无障碍属性', () => {
    const { container } = render(<ErrorOverlay error="err" />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeInTheDocument();
  });
});