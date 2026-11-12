import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ContextMenu } from '../../src/client/components/ContextMenu.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';

const mockT = (key: string) => key;

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => mockT,
}));

describe('ContextMenu', () => {
  const defaultProps = {
    nodeId: 'node-1',
    nodeData: null,
    position: { x: 100, y: 200 },
    isCluster: false,
    isExpanded: false,
    hasHiddenNodes: false,
    onClose: vi.fn(),
    onFocusNode: vi.fn(),
    onIsolateNode: vi.fn(),
    onHideNode: vi.fn(),
    onShowAllNodes: vi.fn(),
    onExpandNode: vi.fn(),
    onCollapseNode: vi.fn(),
    onFindPath: vi.fn(),
    onHighlightCallChain: vi.fn(),
    onHighlightImpact: vi.fn(),
    onOpenSource: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('应渲染所有基本菜单项', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    expect(getByText('contextMenu.focus')).toBeTruthy();
    expect(getByText('contextMenu.isolate')).toBeTruthy();
    expect(getByText('contextMenu.hide')).toBeTruthy();
    expect(getByText('contextMenu.callChain')).toBeTruthy();
    expect(getByText('contextMenu.impact')).toBeTruthy();
    expect(getByText('contextMenu.findPath')).toBeTruthy();
  });

  it('点击 Focus Node 应调用 onFocusNode 并关闭菜单', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.focus'));
    expect(defaultProps.onFocusNode).toHaveBeenCalledWith('node-1');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('点击 Isolate 应调用 onIsolateNode', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.isolate'));
    expect(defaultProps.onIsolateNode).toHaveBeenCalledWith('node-1');
  });

  it('点击 Hide Node 应调用 onHideNode', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.hide'));
    expect(defaultProps.onHideNode).toHaveBeenCalledWith('node-1');
  });

  it('点击 Call Chain 应调用 onHighlightCallChain', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.callChain'));
    expect(defaultProps.onHighlightCallChain).toHaveBeenCalledWith('node-1');
  });

  it('点击 Impact 应调用 onHighlightImpact', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.impact'));
    expect(defaultProps.onHighlightImpact).toHaveBeenCalledWith('node-1');
  });

  it('点击 Find Path 应调用 onFindPath', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.findPath'));
    expect(defaultProps.onFindPath).toHaveBeenCalledWith('node-1');
  });

  it('当 isCluster=true 且 isExpanded=false 时应显示 Expand Cluster', () => {
    const { getByText } = render(
      <ContextMenu {...defaultProps} isCluster={true} isExpanded={false} />
    );
    expect(getByText('contextMenu.expand')).toBeTruthy();
  });

  it('当 isCluster=true 且 isExpanded=true 时应显示 Collapse Cluster', () => {
    const { getByText } = render(
      <ContextMenu {...defaultProps} isCluster={true} isExpanded={true} />
    );
    expect(getByText('contextMenu.collapse')).toBeTruthy();
  });

  it('当 isCluster=false 时不应显示 Expand/Collapse', () => {
    const { queryByText } = render(
      <ContextMenu {...defaultProps} isCluster={false} />
    );
    expect(queryByText('contextMenu.expand')).toBeNull();
    expect(queryByText('contextMenu.collapse')).toBeNull();
  });

  it('点击 Expand Cluster 应调用 onExpandNode', () => {
    const { getByText } = render(
      <ContextMenu {...defaultProps} isCluster={true} isExpanded={false} />
    );
    fireEvent.click(getByText('contextMenu.expand'));
    expect(defaultProps.onExpandNode).toHaveBeenCalledWith('node-1');
  });

  it('点击 Collapse Cluster 应调用 onCollapseNode', () => {
    const { getByText } = render(
      <ContextMenu {...defaultProps} isCluster={true} isExpanded={true} />
    );
    fireEvent.click(getByText('contextMenu.collapse'));
    expect(defaultProps.onCollapseNode).toHaveBeenCalledWith('node-1');
  });

  it('按 Escape 应关闭菜单', () => {
    render(<ContextMenu {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  // BUG-R12-02: the real key used to be swallowed because the listener was re-registered on
  // every render (inline onClose) and left on the bubble phase.
  it('按 Escape 应在捕获阶段消费事件并调用最新的 onClose', () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const leaked = vi.fn();
    document.addEventListener('keydown', leaked);

    try {
      const { rerender } = render(<ContextMenu {...defaultProps} onClose={firstClose} />);
      rerender(<ContextMenu {...defaultProps} onClose={secondClose} />);

      // 菜单 portal 到 document.body，故查询落在 document 上
      const item = document.querySelector('.cg-context-menu-item') as HTMLButtonElement;
      const notCancelled = fireEvent.keyDown(item, { key: 'Escape' });

      expect(notCancelled).toBe(false);
      expect(secondClose).toHaveBeenCalledTimes(1);
      expect(firstClose).not.toHaveBeenCalled();
      expect(leaked).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', leaked);
    }
  });

  it('按方向键仍能移动菜单项焦点', () => {
    render(<ContextMenu {...defaultProps} />);
    const items = document.querySelectorAll<HTMLButtonElement>('.cg-context-menu-item');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document.activeElement ?? document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(document.activeElement ?? document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('点击菜单外部应关闭菜单', () => {
    render(<ContextMenu {...defaultProps} />);
    fireEvent.mouseDown(document.body);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('菜单应定位在指定位置', () => {
    render(<ContextMenu {...defaultProps} position={{ x: 300, y: 400 }} />);
    const menu = document.querySelector('.cg-context-menu') as HTMLElement;
    expect(menu.style.left).toBe('300px');
    expect(menu.style.top).toBe('400px');
  });

  it('应将菜单portal到document.body以脱离面板裁剪', () => {
    const { container } = render(<ContextMenu {...defaultProps} />);
    const menu = document.querySelector('.cg-context-menu');
    expect(menu).toBeTruthy();
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  // ---- FBX-03：右键菜单增强四项 ------------------------------------------

  it('FBX-03a 点击 从此展开 调用 onExpandNode 并关闭菜单', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.expandHere'));
    expect(defaultProps.onExpandNode).toHaveBeenCalledWith('node-1');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('FBX-03b 点击 收起到这里 调用 onCollapseNode 并关闭菜单', () => {
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.collapseHere'));
    expect(defaultProps.onCollapseNode).toHaveBeenCalledWith('node-1');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('FBX-03c 固定/取消固定：读 pinnedIds 切换文案并调用 store 动作', () => {
    useGraphStore.setState({ pinnedIds: new Set(['node-1']) });
    const first = render(<ContextMenu {...defaultProps} />);
    expect(first.getByText('contextMenu.unpinNode')).toBeTruthy();
    fireEvent.click(first.getByText('contextMenu.unpinNode'));
    expect(useGraphStore.getState().pinnedIds.has('node-1')).toBe(false);
    first.unmount();

    const second = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(second.getByText('contextMenu.pinNode'));
    expect(useGraphStore.getState().pinnedIds.has('node-1')).toBe(true);
    second.unmount();
    useGraphStore.setState({ pinnedIds: new Set() });
  });

  it('FBX-03d 复制符号ID：写剪贴板并显示已复制反馈', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { getByText } = render(<ContextMenu {...defaultProps} />);
    fireEvent.click(getByText('contextMenu.copyId'));
    expect(writeText).toHaveBeenCalledWith('node-1');
    expect(getByText('contextMenu.copied')).toBeTruthy();
  });

  it('FBX-03e 菜单项带 data-action-id（测试绑定不再依赖文案）', () => {
    render(<ContextMenu {...defaultProps} />);
    expect(document.querySelector('[data-action-id="focus"]')).toBeTruthy();
    expect(document.querySelector('[data-action-id="expandHere"]')).toBeTruthy();
    expect(document.querySelector('[data-action-id="collapseHere"]')).toBeTruthy();
    expect(document.querySelector('[data-action-id="pinNode"]')).toBeTruthy();
    expect(document.querySelector('[data-action-id="copyId"]')).toBeTruthy();
  });
});