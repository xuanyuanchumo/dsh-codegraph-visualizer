import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { GraphErrorBoundary } from '../../src/client/components/ErrorBoundary.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

function ThrowOnRender({ error }: { error: Error }): ReactNode {
  throw error;
}

describe('GraphErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('应正常渲染子组件无错误时', () => {
    const { getByText } = render(
      <GraphErrorBoundary>
        <div>正常内容</div>
      </GraphErrorBoundary>
    );
    expect(getByText('正常内容')).toBeTruthy();
  });

  it('应捕获子组件渲染错误并显示默认 fallback', () => {
    const error = new Error('测试渲染失败');
    const { getByText } = render(
      <GraphErrorBoundary>
        <ThrowOnRender error={error} />
      </GraphErrorBoundary>
    );
    expect(getByText('error.title')).toBeTruthy();
    expect(getByText('测试渲染失败')).toBeTruthy();
    expect(getByText('error.retry')).toBeTruthy();
  });

  it('点击重试应清除错误状态', () => {
    const error = new Error('测试重试');
    const { getByText, queryByText } = render(
      <GraphErrorBoundary>
        <ThrowOnRender error={error} />
      </GraphErrorBoundary>
    );
    expect(getByText('error.title')).toBeTruthy();
    fireEvent.click(getByText('error.retry'));
    expect(queryByText('error.title')).toBeTruthy();
  });

  it('应使用自定义 fallback 当提供时', () => {
    const error = new Error('自定义fallback测试');
    const customFallback = <div>自定义错误界面</div>;
    const { getByText } = render(
      <GraphErrorBoundary fallback={customFallback}>
        <ThrowOnRender error={error} />
      </GraphErrorBoundary>
    );
    expect(getByText('自定义错误界面')).toBeTruthy();
  });

  it('应调用 onError 回调当错误发生时', () => {
    const onError = vi.fn();
    const error = new Error('回调测试');
    render(
      <GraphErrorBoundary onError={onError}>
        <ThrowOnRender error={error} />
      </GraphErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, expect.any(Object));
  });

  it('fallback 应有 role=alert 属性', () => {
    const error = new Error('无障碍测试');
    const { container } = render(
      <GraphErrorBoundary>
        <ThrowOnRender error={error} />
      </GraphErrorBoundary>
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
  });

  it('应显示报告问题链接', () => {
    const error = new Error('链接测试');
    const { getByText } = render(
      <GraphErrorBoundary>
        <ThrowOnRender error={error} />
      </GraphErrorBoundary>
    );
    const link = getByText('error.reportIssue');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toContain('github.com');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});