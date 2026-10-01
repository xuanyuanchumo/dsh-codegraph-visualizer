import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Dropdown } from '../../src/client/components/Dropdown.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Dropdown', () => {
  const defaultProps = {
    triggerClassName: 'cg-test-btn',
    triggerTitle: 'Test',
    triggerAriaLabel: 'Test menu',
    triggerContent: 'Click me',
    children: <div data-testid="content">Menu content</div>,
  };

  it('应渲染触发按钮', () => {
    const { getByLabelText } = render(<Dropdown {...defaultProps} />);
    const trigger = getByLabelText('Test menu');
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toBe('Click me');
  });

  it('初始状态不应显示下拉内容', () => {
    const { queryByTestId } = render(<Dropdown {...defaultProps} />);
    expect(queryByTestId('content')).toBeNull();
  });

  it('点击触发按钮应显示下拉内容', () => {
    const { getByLabelText, getByTestId } = render(<Dropdown {...defaultProps} />);
    fireEvent.click(getByLabelText('Test menu'));
    expect(getByTestId('content')).toBeTruthy();
  });

  it('再次点击触发按钮应隐藏下拉内容', () => {
    const { getByLabelText, queryByTestId } = render(<Dropdown {...defaultProps} />);
    const trigger = getByLabelText('Test menu');
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(queryByTestId('content')).toBeNull();
  });

  it('点击外部应关闭下拉', () => {
    const { getByLabelText, queryByTestId } = render(
      <div>
        <Dropdown {...defaultProps} />
        <div data-testid="outside">Outside</div>
      </div>
    );
    fireEvent.click(getByLabelText('Test menu'));
    fireEvent.mouseDown(document.body);
    expect(queryByTestId('content')).toBeNull();
  });

  it('按Escape应关闭下拉', () => {
    const { getByLabelText, queryByTestId } = render(<Dropdown {...defaultProps} />);
    fireEvent.click(getByLabelText('Test menu'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('content')).toBeNull();
  });

  it('应调用onOpenChange回调', () => {
    const onOpenChange = vi.fn();
    const { getByLabelText } = render(<Dropdown {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(getByLabelText('Test menu'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(getByLabelText('Test menu'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('应设置aria-expanded属性', () => {
    const { getByLabelText } = render(<Dropdown {...defaultProps} />);
    const trigger = getByLabelText('Test menu') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('应设置aria-haspopup属性', () => {
    const { getByLabelText } = render(
      <Dropdown {...defaultProps} triggerAriaHasPopup="menu" />
    );
    const trigger = getByLabelText('Test menu') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('打开时触发按钮应有cg-active类', () => {
    const { getByLabelText } = render(<Dropdown {...defaultProps} />);
    const trigger = getByLabelText('Test menu') as HTMLButtonElement;
    expect(trigger.className).toContain('cg-test-btn');
    fireEvent.click(trigger);
    expect(trigger.className).toContain('cg-active');
  });

  it('应使用自定义containerClassName', () => {
    const { container } = render(
      <Dropdown {...defaultProps} containerClassName="cg-custom-container" />
    );
    expect(container.firstChild).toBeTruthy();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toBe('cg-custom-container');
  });

  it('应使用自定义contentClassName', () => {
    const { getByLabelText, container } = render(
      <Dropdown {...defaultProps} contentClassName="cg-custom-content" />
    );
    fireEvent.click(getByLabelText('Test menu'));
    const content = container.querySelector('.cg-custom-content');
    expect(content).toBeTruthy();
  });

  it('应设置content的role属性', () => {
    const { getByLabelText, container } = render(
      <Dropdown {...defaultProps} contentRole="menu" />
    );
    fireEvent.click(getByLabelText('Test menu'));
    const content = container.querySelector('[role="menu"]');
    expect(content).toBeTruthy();
  });

  it('closeOnOutsideClick=false时点击外部不关闭', () => {
    const { getByLabelText, queryByTestId } = render(
      <div>
        <Dropdown {...defaultProps} closeOnOutsideClick={false} />
        <div data-testid="outside">Outside</div>
      </div>
    );
    fireEvent.click(getByLabelText('Test menu'));
    fireEvent.mouseDown(document.body);
    expect(queryByTestId('content')).toBeTruthy();
  });
});