import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { StatsPanel } from '../../src/client/components/StatsPanel.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('StatsPanel', () => {
  const defaultProps = {
    counts: { function: 10, class: 5, variable: 3, module: 2, interface: 1 },
    onClose: vi.fn(),
    thumbnail: null,
    viewportInfo: null,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('应渲染标题和关闭按钮', () => {
    const { getByText, container } = render(<StatsPanel {...defaultProps} />);
    expect(getByText('minimap.title')).toBeTruthy();
    const closeBtn = container.querySelector('.cg-close-btn');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn?.getAttribute('aria-label')).toBe('minimap.close');
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<StatsPanel {...defaultProps} onClose={onClose} />);
    const closeBtn = container.querySelector('.cg-close-btn')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('应显示各类型计数', () => {
    const { getByText } = render(<StatsPanel {...defaultProps} />);
    expect(getByText('minimap.functions: 10')).toBeTruthy();
    expect(getByText('minimap.classes: 5')).toBeTruthy();
    expect(getByText('minimap.variables: 3')).toBeTruthy();
    expect(getByText('minimap.modules: 2')).toBeTruthy();
    expect(getByText('minimap.interfaces: 1')).toBeTruthy();
  });

  it('应显示总数', () => {
    const { getByText } = render(<StatsPanel {...defaultProps} />);
    expect(getByText('minimap.total: 21')).toBeTruthy();
  });

  it('thumbnail 为 null 时不应显示缩略图', () => {
    const { container } = render(<StatsPanel {...defaultProps} />);
    expect(container.querySelector('.cg-mini-map-thumbnail')).toBeNull();
  });

  it('thumbnail 存在时应显示缩略图', () => {
    const props = {
      ...defaultProps,
      thumbnail: 'data:image/png;base64,abc',
    };
    const { container } = render(<StatsPanel {...props} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,abc');
  });

  it('应有 role=complementary 无障碍属性', () => {
    const { container } = render(<StatsPanel {...defaultProps} />);
    expect(container.querySelector('[role="complementary"]')).toBeTruthy();
  });

  it('应显示统计点标记', () => {
    const { container } = render(<StatsPanel {...defaultProps} />);
    const dots = container.querySelectorAll('.cg-dot');
    expect(dots.length).toBe(5);
  });
});