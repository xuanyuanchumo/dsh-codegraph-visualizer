import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Legend } from '../../src/client/components/Legend.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('Legend', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('应渲染标题和关闭按钮', () => {
    const onClose = vi.fn();
    const { getByText, container } = render(<Legend viewMode="code" onClose={onClose} />);
    expect(getByText('legend.title')).toBeTruthy();
    const closeBtn = container.querySelector('.cg-legend-close');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn?.getAttribute('aria-label')).toBe('legend.close');
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<Legend viewMode="code" onClose={onClose} />);
    const closeBtn = container.querySelector('.cg-legend-close')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('code 视图应显示所有节点类型', () => {
    const { getByText } = render(<Legend viewMode="code" onClose={vi.fn()} />);
    expect(getByText('legend.function')).toBeTruthy();
    expect(getByText('legend.class')).toBeTruthy();
    expect(getByText('legend.variable')).toBeTruthy();
    expect(getByText('legend.module')).toBeTruthy();
    expect(getByText('legend.interface')).toBeTruthy();
    expect(getByText('legend.type')).toBeTruthy();
  });

  it('dependencies 视图应仅显示 module/class/type 节点', () => {
    const { getByText, queryByText } = render(<Legend viewMode="dependencies" onClose={vi.fn()} />);
    expect(getByText('legend.module')).toBeTruthy();
    expect(getByText('legend.class')).toBeTruthy();
    expect(getByText('legend.type')).toBeTruthy();
    expect(queryByText('legend.function')).toBeNull();
    expect(queryByText('legend.variable')).toBeNull();
  });

  it('inheritance 视图应仅显示 class/interface/type 节点', () => {
    const { getByText, queryByText } = render(<Legend viewMode="inheritance" onClose={vi.fn()} />);
    expect(getByText('legend.class')).toBeTruthy();
    expect(getByText('legend.interface')).toBeTruthy();
    expect(queryByText('legend.function')).toBeNull();
  });

  it('callgraph 视图应仅显示 call 边', () => {
    const { getByText, queryByText } = render(<Legend viewMode="callgraph" onClose={vi.fn()} />);
    expect(getByText('legend.call')).toBeTruthy();
    expect(queryByText('legend.import')).toBeNull();
    expect(queryByText('legend.extend')).toBeNull();
  });

  it('cfg 视图应仅显示 function 节点和 call 边', () => {
    const { getByText, queryByText } = render(<Legend viewMode="cfg" onClose={vi.fn()} />);
    expect(getByText('legend.function')).toBeTruthy();
    expect(getByText('legend.call')).toBeTruthy();
    expect(queryByText('legend.class')).toBeNull();
  });

  it('应有 role=complementary 无障碍属性', () => {
    const { container } = render(<Legend viewMode="code" onClose={vi.fn()} />);
    expect(container.querySelector('[role="complementary"]')).toBeTruthy();
  });

  it('应显示节点和边分区标题', () => {
    const { getByText } = render(<Legend viewMode="code" onClose={vi.fn()} />);
    expect(getByText('legend.nodes')).toBeTruthy();
    expect(getByText('legend.edges')).toBeTruthy();
  });
});