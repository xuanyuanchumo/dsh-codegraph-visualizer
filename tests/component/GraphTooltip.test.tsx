import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GraphTooltip, type TooltipData, type EdgeTooltipData } from '../../src/client/components/GraphTooltip.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('GraphTooltip', () => {
  afterEach(() => {
    cleanup();
  });

  it('应渲染节点 tooltip 含名称和路径', () => {
    const data: TooltipData = {
      x: 100,
      y: 200,
      name: 'myFunction',
      path: 'src/utils/myFunction.ts',
      type: 'function',
    };
    const { getByText } = render(<GraphTooltip data={data} />);
    expect(getByText('myFunction')).toBeInTheDocument();
    expect(getByText('src/utils/myFunction.ts')).toBeInTheDocument();
    expect(getByText('function')).toBeInTheDocument();
  });

  it('应渲染 linksIn 和 linksOut 当提供时', () => {
    const data: TooltipData = {
      x: 50,
      y: 50,
      name: 'hub',
      path: 'src/hub.ts',
      type: 'function',
      linksIn: 5,
      linksOut: 3,
    };
    const { getByText } = render(<GraphTooltip data={data} />);
    expect(getByText('in: 5')).toBeInTheDocument();
    expect(getByText('out: 3')).toBeInTheDocument();
  });

  it('不应渲染 links 区域当 linksIn 和 linksOut 都未提供时', () => {
    const data: TooltipData = {
      x: 50,
      y: 50,
      name: 'fn',
      path: 'p',
      type: 'function',
    };
    const { container } = render(<GraphTooltip data={data} />);
    // 提示框 portal 到 document.body，容器内应为空
    expect(container.querySelector('.cg-tooltip-links')).toBeNull();
    expect(document.querySelector('.cg-tooltip-links')).toBeNull();
  });

  it('应渲染边 tooltip 含 source 和 target', () => {
    const data: EdgeTooltipData = {
      x: 100,
      y: 100,
      sourceLabel: 'funcA',
      targetLabel: 'funcB',
      edgeType: 'call',
    };
    const { getByText } = render(<GraphTooltip data={data} />);
    expect(getByText('funcA')).toBeInTheDocument();
    expect(getByText('funcB')).toBeInTheDocument();
    expect(getByText('legend.call')).toBeInTheDocument();
  });

  it('应有 role=tooltip 无障碍属性', () => {
    const data: TooltipData = {
      x: 10,
      y: 10,
      name: 'n',
      path: 'p',
      type: 't',
    };
    render(<GraphTooltip data={data} />);
    expect(document.querySelector('[role="tooltip"]')).toBeInTheDocument();
  });

  it('应设置 style left/top 属性', () => {
    const data: TooltipData = {
      x: 200,
      y: 300,
      name: 'n',
      path: 'p',
      type: 't',
    };
    render(<GraphTooltip data={data} />);
    const tooltip = document.querySelector('.cg-tooltip') as HTMLElement;
    expect(tooltip.style.left).toBeTruthy();
    expect(tooltip.style.top).toBeTruthy();
  });

  it('应将提示框portal到document.body以脱离面板裁剪', () => {
    const data: TooltipData = {
      x: 200,
      y: 300,
      name: 'n',
      path: 'p',
      type: 't',
    };
    const { container } = render(<GraphTooltip data={data} />);
    const tooltip = document.querySelector('.cg-tooltip');
    expect(tooltip).toBeTruthy();
    expect(container.contains(tooltip)).toBe(false);
    expect(document.body.contains(tooltip)).toBe(true);
  });
});