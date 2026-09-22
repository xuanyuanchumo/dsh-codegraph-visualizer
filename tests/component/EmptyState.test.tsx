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
    expect(getByText('empty.title')).toBeTruthy();
    expect(getByText('empty.subtitle')).toBeTruthy();
  });

  it('应显示导入和扫描按钮', () => {
    const { getByText } = render(<EmptyState {...defaultProps} />);
    expect(getByText('empty.import')).toBeTruthy();
    expect(getByText('empty.scanWorkspace')).toBeTruthy();
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
    expect(container.querySelector('.cg-empty-prereq-warning')).toBeTruthy();
    expect(getByText('prereq.codegraphLabel')).toBeTruthy();
    expect(getByText('prereq.installCodegraph')).toBeTruthy();
  });

  it('lens 缺失时应显示安装提示', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: true, lens: false },
    };
    const { getByText } = render(<EmptyState {...props} />);
    expect(getByText('prereq.lensLabel')).toBeTruthy();
    expect(getByText('prereq.installLens')).toBeTruthy();
  });

  it('两者都缺失时应显示两个安装提示', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: false },
    };
    const { getByText } = render(<EmptyState {...props} />);
    expect(getByText('prereq.codegraphLabel')).toBeTruthy();
    expect(getByText('prereq.lensLabel')).toBeTruthy();
  });
});