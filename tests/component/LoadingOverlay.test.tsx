import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LoadingOverlay } from '../../src/client/components/LoadingOverlay.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('LoadingOverlay', () => {
  afterEach(() => {
    cleanup();
  });

  it('visible=false 时应返回 null', () => {
    const { container } = render(<LoadingOverlay visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('visible=true 时应显示加载覆盖层', () => {
    const { container, getByText } = render(<LoadingOverlay visible={true} />);
    expect(container.querySelector('.cg-loading-overlay')).toBeTruthy();
    expect(container.querySelector('.cg-spinner')).toBeTruthy();
    expect(getByText('state.loading')).toBeTruthy();
  });

  it('应有 role=status 无障碍属性', () => {
    const { container } = render(<LoadingOverlay visible={true} />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
  });

  it('应有 aria-live=polite 无障碍属性', () => {
    const { container } = render(<LoadingOverlay visible={true} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
  });
});