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
    prerequisites: { codegraph: true, lens: true, graphSource: true },
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

  // ── 降级提示的判据是 graphSource，不是 builtin（cycle-111 / P0-N3，§61.10）─────
  //
  // 修前判据是 `prerequisites.builtin ?? true`，而宿主把 `builtin` 硬编码成 true ⇒
  // 只要上下游都缺，界面就无条件承诺「降级模式 — 使用内置 TreeSitter 和依赖分析」。
  // 真实情况：AST 分析（`/ast`、`/outline`）确实可用，但它**产不出一张图**
  // （`fetchMergedGraph` 的内置回落只记日志、不产节点，`src/tools.ts:132-134`）。
  // 承诺了却给不出的降级路径比不显示更糟：用户点「扫描工作区」只会得到一个空画布。

  it('两个上游都缺 + 有图数据通道 ⇒ 显示降级提示', () => {
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: false, graphSource: true },
    };
    const { container } = render(<EmptyState {...props} />);
    expect(container.querySelector('.cg-empty-degraded-notice')).not.toBeNull();
  });

  it('两个上游都缺 + 只有 AST 通道 ⇒ **不**显示降级提示', () => {
    // 这条是 §61.10 的客户端落点。`astSource: true` 时若渲染降级提示，
    // 界面就在承诺一条不存在的图数据通路 —— 旧实现的 `builtin` 同时代表这两件事。
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: false, astSource: true, graphSource: false },
    };
    const { container } = render(<EmptyState {...props} />);
    expect(container.querySelector('.cg-empty-degraded-notice')).toBeNull();
  });

  it('两个上游都缺 + 载荷残留 legacy builtin 键 ⇒ 不显示降级提示', () => {
    // cycle-118 别名已移除，但**旧宿主**的载荷可能仍带 `builtin` 键。判据始终是
    // `graphSource`：这条用例的存在意义是——把判据改回读 `builtin`（或任何别的位）时它会立刻变红。
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: false, builtin: true, graphSource: false },
    };
    const { container } = render(<EmptyState {...props} />);
    expect(container.querySelector('.cg-empty-degraded-notice')).toBeNull();
  });

  it('旧宿主（不发 graphSource）⇒ 不显示降级提示', () => {
    // 缺省方向是 false：不知道 ≠ 有。旧宿主无权声称存在图通道。
    const props = {
      ...defaultProps,
      prerequisites: { codegraph: false, lens: false },
    };
    const { container } = render(<EmptyState {...props} />);
    expect(container.querySelector('.cg-empty-degraded-notice')).toBeNull();
  });

  it('正常情况下（上游可用）不显示降级提示', () => {
    const { container } = render(<EmptyState {...defaultProps} />);
    expect(container.querySelector('.cg-empty-degraded-notice')).toBeNull();
  });

  it('应显示导入和扫描操作按钮', () => {
    const { container } = render(<EmptyState {...defaultProps} />);
    expect(container.querySelector('.cg-empty-import-btn')).toBeInTheDocument();
    expect(container.querySelector('.cg-empty-scan-btn')).toBeInTheDocument();
  });
});