import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { KeyboardHelp } from '../../src/client/components/KeyboardHelp.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('KeyboardHelp', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('visible=false 时应返回 null', () => {
    const { container } = render(<KeyboardHelp visible={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('visible=true 时应显示快捷键帮助面板', () => {
    const { getByText, container } = render(<KeyboardHelp visible={true} onClose={vi.fn()} />);
    expect(getByText('shortcut.title')).toBeTruthy();
    const closeBtn = container.querySelector('.cg-keyboard-help-close');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn?.getAttribute('aria-label')).toBe('shortcut.close');
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardHelp visible={true} onClose={onClose} />);
    const closeBtn = container.querySelector('.cg-keyboard-help-close')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩层应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardHelp visible={true} onClose={onClose} />);
    const overlay = container.querySelector('.cg-keyboard-help-overlay');
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('应有 role=dialog 和 aria-modal=true 无障碍属性', () => {
    const { container } = render(<KeyboardHelp visible={true} onClose={vi.fn()} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('应渲染快捷键列表项', () => {
    const { container } = render(<KeyboardHelp visible={true} onClose={vi.fn()} />);
    const items = container.querySelectorAll('.cg-keyboard-help-item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('应渲染 kbd 元素显示快捷键', () => {
    const { container } = render(<KeyboardHelp visible={true} onClose={vi.fn()} />);
    const kbdElements = container.querySelectorAll('kbd');
    expect(kbdElements.length).toBeGreaterThan(0);
  });

  it('Escape 键应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardHelp visible={true} onClose={onClose} />);
    const panel = container.querySelector('.cg-keyboard-help-panel') as HTMLElement;
    expect(panel).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('点击 overlay 应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardHelp visible={true} onClose={onClose} />);
    const overlay = container.querySelector('.cg-keyboard-help-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });
});