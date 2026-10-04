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
    const { getByLabelText } = render(
      <Dropdown {...defaultProps} contentClassName="cg-custom-content" />
    );
    fireEvent.click(getByLabelText('Test menu'));
    // 内容被 portal 到 document.body，因此查询必须落在 document 上而非渲染容器内
    const content = document.querySelector('.cg-custom-content');
    expect(content).toBeTruthy();
  });

  it('应设置content的role属性', () => {
    const { getByLabelText } = render(
      <Dropdown {...defaultProps} contentRole="menu" />
    );
    fireEvent.click(getByLabelText('Test menu'));
    const content = document.querySelector('[role="menu"]');
    expect(content).toBeTruthy();
  });

  it('应将下拉内容portal到document.body以脱离工具栏与面板的裁剪', () => {
    const { getByLabelText, container } = render(<Dropdown {...defaultProps} />);
    fireEvent.click(getByLabelText('Test menu'));
    const content = document.querySelector('.cg-dropdown-content');
    expect(content).toBeTruthy();
    // 触发器仍在原容器内，内容则挂在 body 下
    expect(container.contains(content)).toBe(false);
    expect(document.body.contains(content)).toBe(true);
  });

  it('应支持注入portal挂载点', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const { getByLabelText } = render(<Dropdown {...defaultProps} portalTarget={host} />);
      fireEvent.click(getByLabelText('Test menu'));
      expect(host.querySelector('.cg-dropdown-content')).toBeTruthy();
    } finally {
      host.remove();
    }
  });

  it('窄面板下应将下拉内容切换为底部抽屉形态', () => {
    // jsdom 不做布局，clientWidth 恒为 0，因此手工注入面板宽度与矩形，
    // 模拟 `@container graphpanel (max-width: 320px)` 的窄面板场景。
    const panel = document.createElement('div');
    panel.className = 'cg-graph-panel';
    Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 300 });
    panel.getBoundingClientRect = () =>
      ({ left: 40, top: 100, right: 340, bottom: 700, width: 300, height: 600 }) as DOMRect;
    document.body.appendChild(panel);
    try {
      const { getByLabelText } = render(<Dropdown {...defaultProps} portalTarget={panel} />, {
        container: panel,
      });
      fireEvent.click(getByLabelText('Test menu'));
      const content = panel.querySelector('.cg-dropdown-content') as HTMLElement;
      expect(content).toBeTruthy();
      // 形态由组件测量后决定，不再依赖容器查询
      expect(content.className).toContain('cg-portal-drawer');
      expect(content.style.getPropertyValue('--cg-portal-width')).toBe('292px');
      expect(content.style.getPropertyValue('--cg-portal-bottom')).toBe('72px');
      expect(content.style.getPropertyValue('--cg-portal-top')).toBe('auto');
    } finally {
      panel.remove();
    }
  });

  it('宽面板下应保持锚定在触发按钮下方', () => {
    const panel = document.createElement('div');
    panel.className = 'cg-graph-panel';
    Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 900 });
    panel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 }) as DOMRect;
    document.body.appendChild(panel);
    try {
      const { getByLabelText } = render(<Dropdown {...defaultProps} portalTarget={panel} />, {
        container: panel,
      });
      fireEvent.click(getByLabelText('Test menu'));
      const content = panel.querySelector('.cg-dropdown-content') as HTMLElement;
      expect(content.className).not.toContain('cg-portal-drawer');
      expect(content.style.getPropertyValue('--cg-portal-top')).not.toBe('auto');
      expect(content.style.getPropertyValue('--cg-portal-width')).toBe('auto');
    } finally {
      panel.remove();
    }
  });

  it('点击portal出去的下拉内容不应被误判为外部点击', () => {
    const { getByLabelText, getByTestId } = render(<Dropdown {...defaultProps} />);
    fireEvent.click(getByLabelText('Test menu'));
    fireEvent.mouseDown(getByTestId('content'));
    expect(getByTestId('content')).toBeTruthy();
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