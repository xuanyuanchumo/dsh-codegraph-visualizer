import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { EmptyState } from '../../src/client/components/EmptyState.tsx';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

const mockWriteText = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('navigator', {
  clipboard: { writeText: mockWriteText },
});

describe('EmptyState', () => {
  const defaultProps = {
    prerequisites: { codegraph: true, lens: true },
    onImport: vi.fn(),
    onScanWorkspace: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('应显示标题和副标题', () => {
    const { getByText } = render(<EmptyState {...defaultProps} />);
    expect(getByText('empty.title')).toBeInTheDocument();
    expect(getByText('empty.subtitle')).toBeInTheDocument();
  });

  it('应显示导入和扫描按钮', () => {
    const { getByText } = render(<EmptyState {...defaultProps} />);
    expect(getByText('empty.import')).toBeInTheDocument();
    expect(getByText('empty.scanWorkspace')).toBeInTheDocument();
  });

  it('点击导入按钮应调用 onImport', () => {
    const { getByText } = render(<EmptyState {...defaultProps} />);
    fireEvent.click(getByText('empty.import'));
    expect(defaultProps.onImport).toHaveBeenCalledTimes(1);
  });

  it('点击扫描按钮应调用 onScanWorkspace', () => {
    const { getByText } = render(<EmptyState {...defaultProps} />);
    fireEvent.click(getByText('empty.scanWorkspace'));
    expect(defaultProps.onScanWorkspace).toHaveBeenCalledTimes(1);
  });

  it('prerequisites 都满足时不应显示警告', () => {
    const { container } = render(<EmptyState {...defaultProps} />);
    expect(container.querySelector('.cg-empty-prereq-warning')).toBeNull();
  });

  it('codegraph 缺失时应显示安装提示', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: true },
    };
    const { container, getByText } = render(<EmptyState {...props} />);
    expect(container.querySelector('.cg-empty-prereq-warning')).toBeInTheDocument();
    expect(getByText('prereq.codegraphLabel')).toBeInTheDocument();
    expect(getByText('prereq.installCodegraph')).toBeInTheDocument();
  });

  it('lens 缺失时应显示安装提示', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: true, lens: false },
    };
    const { getByText } = render(<EmptyState {...props} />);
    expect(getByText('prereq.lensLabel')).toBeInTheDocument();
    expect(getByText('prereq.installLens')).toBeInTheDocument();
  });

  it('两者都缺失时应显示两个安装提示', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: false },
    };
    const { getByText } = render(<EmptyState {...props} />);
    expect(getByText('prereq.codegraphLabel')).toBeInTheDocument();
    expect(getByText('prereq.lensLabel')).toBeInTheDocument();
  });

  it('点击复制按钮应调用 clipboard.writeText', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: true },
    };
    const { container } = render(<EmptyState {...props} />);
    const copyBtn = container.querySelector('.cg-prereq-copy-btn')!;
    fireEvent.click(copyBtn);
    expect(mockWriteText).toHaveBeenCalled();
  });

  it('点击 lens 复制按钮应调用 clipboard.writeText', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: true, lens: false },
    };
    const { container } = render(<EmptyState {...props} />);
    const copyBtn = container.querySelector('.cg-prereq-copy-btn')!;
    fireEvent.click(copyBtn);
    expect(mockWriteText).toHaveBeenCalledWith('prereq.installLens');
  });

  it('点击安装按钮应分发 codegraph:install-plugin 事件', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: true },
    };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = render(<EmptyState {...props} />);
    const installBtn = container.querySelector('.cg-prereq-install-btn')!;
    fireEvent.click(installBtn);
    expect(dispatchSpy).toHaveBeenCalled();
    const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe('codegraph:install-plugin');
    expect(event.detail.plugin).toBe('dsh-codegraph');
  });

  it('点击 lens 安装按钮应分发正确的 plugin 名称', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: true, lens: false },
    };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = render(<EmptyState {...props} />);
    const installBtn = container.querySelector('.cg-prereq-install-btn')!;
    fireEvent.click(installBtn);
    const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.plugin).toBe('dsh-tool-lens');
  });

  it('clipboard 不可用时不抛错', () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: true },
    };
    const { container } = render(<EmptyState {...props} />);
    const copyBtn = container.querySelector('.cg-prereq-copy-btn')!;
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
    vi.stubGlobal('navigator', { clipboard: { writeText: mockWriteText } });
  });

  it('安装按钮点击后应显示 installing 状态', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: true },
    };
    const { container } = render(<EmptyState {...props} />);
    const installBtn = container.querySelector('.cg-prereq-install-btn') as HTMLButtonElement;
    fireEvent.click(installBtn);
    expect(installBtn.disabled).toBe(true);
  });

  it('codegraph 缺失时状态点应为 cg-missing 类', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: true },
    };
    const { container } = render(<EmptyState {...props} />);
    const dot = container.querySelector('.cg-prereq-status-dot');
    expect(dot?.classList.contains('cg-missing')).toBe(true);
  });

  it('应显示导入和扫描操作按钮', () => {
    const { container } = render(<EmptyState {...defaultProps} />);
    expect(container.querySelector('.cg-empty-import-btn')).toBeInTheDocument();
    expect(container.querySelector('.cg-empty-scan-btn')).toBeInTheDocument();
  });
});