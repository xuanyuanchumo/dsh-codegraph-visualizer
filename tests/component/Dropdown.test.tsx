import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
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

  // --- cycle-90：下拉内容用 position: fixed + 视口坐标定位，滚动后必须重新测量 ---

  it('页面滚动后应重新测量并把下拉内容锚回触发器下方', async () => {
    // 内容定位写的是**视口坐标**（--cg-portal-top），一旦页面滚动，触发器上移而
    // fixed 内容原地不动，菜单就会飘走（真机实测滚 100px 后间距 6px → 106px）。
    // 因此组件必须监听 scroll 并重新测量。
    const { getByLabelText } = render(<Dropdown {...defaultProps} />);
    const trigger = getByLabelText('Test menu') as HTMLButtonElement;

    let triggerTop = 300;
    trigger.getBoundingClientRect = () =>
      ({ left: 100, top: triggerTop, right: 130, bottom: triggerTop + 28, width: 30, height: 28 }) as DOMRect;

    fireEvent.click(trigger);
    const content = document.querySelector('.cg-dropdown-content') as HTMLElement;
    expect(content.style.getPropertyValue('--cg-portal-top')).toBe('334px'); // 328 + 6

    // 模拟页面滚动 100px：触发器的视口位置随之上移 100px
    triggerTop = 200;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    // 若未重新测量，这里会仍是 334px（菜单停在原处）
    expect(content.style.getPropertyValue('--cg-portal-top')).toBe('234px');
  });

  it('同一帧内的多次滚动事件只重新测量一次', async () => {
    // 滚动会在每一帧触发 measure()，用 rAF 合并同一帧内的多次 scroll，
    // 避免一次滚动里反复 setState 重排。
    //
    // 判据用**测量次数**（getBoundingClientRect 的调用数），不用 React 的渲染次数：
    // 即使 commit() 返回同一个 state 对象，React 仍可能再渲染一次才 bail out，
    // 断言精确渲染次数会绑定到 React 内部实现。
    const { getByLabelText } = render(<Dropdown {...defaultProps} />);
    const trigger = getByLabelText('Test menu') as HTMLButtonElement;

    let measureCalls = 0;
    trigger.getBoundingClientRect = () => {
      measureCalls += 1;
      return { left: 100, top: 300, right: 130, bottom: 328, width: 30, height: 28 } as DOMRect;
    };

    fireEvent.click(trigger);
    const baseline = measureCalls; // 打开时的首次测量

    await act(async () => {
      // 同一帧内连发 5 次 scroll，随后只推进一帧
      for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    // 5 次事件被合并成 1 次测量；去掉 rAF 合并后这里会变成 baseline + 5
    expect(measureCalls).toBe(baseline + 1);
  });
});