/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

// The detail panel now lazy-loads the authoritative edge neighbourhood. jsdom's
// AbortSignal is not the undici class, so a real request would fail noisily; stub
// the API and assert against the store instead.
const mocks = vi.hoisted(() => ({ fetchEdges: vi.fn() }));
vi.mock('../../src/client/api/index.ts', () => ({ fetchEdges: mocks.fetchEdges }));

import { NodeDetail } from '../../src/client/components/NodeDetail.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

const noop = vi.fn();

function makeEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

function makeNode(overrides: Partial<GraphNode> & Record<string, unknown> = {}): GraphNode {
  const { isCluster, childIds, childCount, ...rest } = overrides as Record<string, unknown>;
  const node: GraphNode = {
    id: NodeId('node-1'),
    label: 'myFunction',
    type: 'function',
    filePath: 'src/app.ts',
    lineNumber: 42,
    properties: {},
    ...rest,
  };
  // Attach cluster-specific fields directly on the node object (not in properties),
  // matching how the component reads them via runtime type assertions.
  const ext = node as unknown as Record<string, unknown>;
  if (isCluster !== undefined) ext.isCluster = isCluster;
  if (childIds !== undefined) ext.childIds = childIds;
  if (childCount !== undefined) ext.childCount = childCount;
  return node;
}

beforeEach(() => {
  mocks.fetchEdges.mockReset();
  mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
  useGraphStore.setState({
    rawNodes: [],
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set(),
    astPageByNodeId: new Map(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NodeDetail component', () => {
  // --- Scenario 1: Render basic node info ---
  it('renders node label, type, file path, and line number', () => {
    const node = makeNode({
      label: 'handleRequest',
      type: 'function',
      filePath: 'src/server.ts',
      lineNumber: 100,
    });
    render(<NodeDetail node={node} onClose={noop} />);

    expect(screen.getByText('handleRequest')).toBeTruthy();
    expect(screen.getByText('function')).toBeTruthy();
    expect(screen.getByText('src/server.ts')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('renders type icon for function nodes', () => {
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} />);
    const iconEl = document.querySelector('.cg-detail-type-icon');
    expect(iconEl).toBeTruthy();
    expect(iconEl?.textContent).toBe('fn');
  });

  it('renders type icon for class nodes', () => {
    const node = makeNode({ type: 'class' });
    render(<NodeDetail node={node} onClose={noop} />);
    const iconEl = document.querySelector('.cg-detail-type-icon');
    expect(iconEl?.textContent).toBe('C');
  });

  it('renders type icon for type nodes', () => {
    const node = makeNode({ type: 'type' });
    render(<NodeDetail node={node} onClose={noop} />);
    const iconEl = document.querySelector('.cg-detail-type-icon');
    expect(iconEl?.textContent).toBe('T');
  });

  it('shows EXP badge when node is exported', () => {
    const node = makeNode({ properties: { exported: true } });
    render(<NodeDetail node={node} onClose={noop} />);
    expect(screen.getByText('EXP')).toBeTruthy();
  });

  it('does not show EXP badge when node is not exported', () => {
    const node = makeNode({ properties: { exported: false } });
    render(<NodeDetail node={node} onClose={noop} />);
    expect(screen.queryByText('EXP')).toBeNull();
  });

  it('shows OPEN badge when isExpanded is true', () => {
    const node = makeNode({ type: 'module' });
    render(<NodeDetail node={node} onClose={noop} isExpanded={true} />);
    expect(screen.getByText('OPEN')).toBeTruthy();
  });

  it('shows kind when kind differs from type', () => {
    const node = makeNode({ type: 'function', properties: { kind: 'method' } });
    render(<NodeDetail node={node} onClose={noop} />);
    expect(screen.getByText('method')).toBeTruthy();
  });

  it('does not show kind when kind equals type', () => {
    const node = makeNode({ type: 'function', properties: { kind: 'function' } });
    render(<NodeDetail node={node} onClose={noop} />);
    expect(screen.queryByText('method')).toBeNull();
  });

  // --- Scenario 2: Render micro view buttons for function nodes ---
  it('renders CFG, Flowchart, and Sequence buttons for function nodes', () => {
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={noop} />);

    const microBtns = document.querySelectorAll('.cg-detail-micro-btns .cg-detail-micro-btn');
    expect(microBtns.length).toBe(3);
    expect(microBtns[0]!.textContent).toBe('CFG');
    expect(microBtns[1]!.textContent).toBe('流程');
    expect(microBtns[2]!.textContent).toBe('时序');
  });

  it('does not render micro view buttons for non-function nodes', () => {
    const node = makeNode({ type: 'class' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={noop} />);

    const microActions = document.querySelector('.cg-detail-micro-actions');
    expect(microActions).toBeNull();
  });

  it('does not render micro view buttons when onSelectFunction is not provided', () => {
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} />);

    const microActions = document.querySelector('.cg-detail-micro-actions');
    expect(microActions).toBeNull();
  });

  // --- Scenario 3: Click micro view buttons triggers onSelectFunction ---
  it('calls onSelectFunction with cfg when CFG button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={onSelectFunction} />);

    const microBtns = document.querySelectorAll('.cg-detail-micro-btns .cg-detail-micro-btn');
    await user.click(microBtns[0]!);
    expect(onSelectFunction).toHaveBeenCalledWith(node, 'cfg');
  });

  it('calls onSelectFunction with flowchart when Flow button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={onSelectFunction} />);

    const microBtns = document.querySelectorAll('.cg-detail-micro-btns .cg-detail-micro-btn');
    await user.click(microBtns[1]!);
    expect(onSelectFunction).toHaveBeenCalledWith(node, 'flowchart');
  });

  it('calls onSelectFunction with sequence when Seq button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={onSelectFunction} />);

    const microBtns = document.querySelectorAll('.cg-detail-micro-btns .cg-detail-micro-btn');
    await user.click(microBtns[2]!);
    expect(onSelectFunction).toHaveBeenCalledWith(node, 'sequence');
  });

  // --- Scenario 4: Render cluster node and child function list ---
  it('renders cluster child functions list for cluster nodes', () => {
    const childFn1: GraphNode = {
      id: NodeId('child-1'),
      label: 'childFnA',
      type: 'function',
      filePath: 'src/module.ts',
      lineNumber: 10,
      properties: {},
    };
    const childFn2: GraphNode = {
      id: NodeId('child-2'),
      label: 'childFnB',
      type: 'function',
      filePath: 'src/module.ts',
      lineNumber: 20,
      properties: {},
    };
    const clusterNode = makeNode({
      id: NodeId('cluster-1'),
      label: 'moduleCluster',
      type: 'module',
      isCluster: true,
      childIds: ['child-1', 'child-2'],
      childCount: 2,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, childFn1, childFn2] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={noop} />);

    expect(screen.getByText('childFnA')).toBeTruthy();
    expect(screen.getByText('childFnB')).toBeTruthy();
  });

  it('does not render cluster functions list when childIds is empty', () => {
    const clusterNode = makeNode({
      id: NodeId('cluster-1'),
      type: 'module',
      isCluster: true,
      childIds: [],
      childCount: 0,
    });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={noop} />);

    const clusterSection = document.querySelector('.cg-detail-cluster-functions');
    expect(clusterSection).toBeNull();
  });

  it('does not render cluster functions list for non-cluster nodes', () => {
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={noop} />);

    const clusterSection = document.querySelector('.cg-detail-cluster-functions');
    expect(clusterSection).toBeNull();
  });

  it('filters out non-function children from cluster function list', () => {
    const childFn: GraphNode = {
      id: NodeId('child-fn'),
      label: 'realFunction',
      type: 'function',
      filePath: 'src/a.ts',
      lineNumber: 1,
      properties: {},
    };
    const childClass: GraphNode = {
      id: NodeId('child-class'),
      label: 'SomeClass',
      type: 'class',
      filePath: 'src/b.ts',
      lineNumber: 2,
      properties: {},
    };
    const clusterNode = makeNode({
      id: NodeId('cluster-1'),
      type: 'module',
      isCluster: true,
      childIds: ['child-fn', 'child-class'],
      childCount: 2,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, childFn, childClass] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={noop} />);

    expect(screen.getByText('realFunction')).toBeTruthy();
    expect(screen.queryByText('SomeClass')).toBeNull();
  });

  it('shows "+" suffix when cluster has more than 50 child functions', () => {
    const childIds: string[] = [];
    const rawNodes: GraphNode[] = [];
    for (let i = 0; i < 55; i++) {
      const id = `child-${i}`;
      childIds.push(id);
      rawNodes.push({
        id: NodeId(id),
        label: `fn${i}`,
        type: 'function',
        filePath: 'src/mod.ts',
        lineNumber: i,
        properties: {},
      });
    }
    const clusterNode = makeNode({
      id: NodeId('cluster-big'),
      type: 'module',
      isCluster: true,
      childIds,
      childCount: 55,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, ...rawNodes] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={noop} />);

    const titleEl = document.querySelector('.cg-detail-cluster-functions .cg-detail-section-title');
    expect(titleEl).toBeTruthy();
    expect(titleEl?.textContent).toContain('+');
  });

  it('limits cluster function list to 50 items', () => {
    const childIds: string[] = [];
    const rawNodes: GraphNode[] = [];
    for (let i = 0; i < 55; i++) {
      const id = `child-${i}`;
      childIds.push(id);
      rawNodes.push({
        id: NodeId(id),
        label: `fn${i}`,
        type: 'function',
        filePath: 'src/mod.ts',
        lineNumber: i,
        properties: {},
      });
    }
    const clusterNode = makeNode({
      id: NodeId('cluster-big'),
      type: 'module',
      isCluster: true,
      childIds,
      childCount: 55,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, ...rawNodes] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={noop} />);

    const functionItems = document.querySelectorAll('.cg-detail-function-item');
    expect(functionItems.length).toBe(50);
  });

  // --- Scenario 5: Click child function micro view buttons ---
  it('calls onSelectFunction with child function node when child CFG button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const childFn: GraphNode = {
      id: NodeId('child-1'),
      label: 'childFnA',
      type: 'function',
      filePath: 'src/module.ts',
      lineNumber: 10,
      properties: {},
    };
    const clusterNode = makeNode({
      id: NodeId('cluster-1'),
      type: 'module',
      isCluster: true,
      childIds: ['child-1'],
      childCount: 1,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, childFn] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={onSelectFunction} />);

    const microBtns = document.querySelectorAll('.cg-detail-function-micro-btns .cg-detail-micro-btn');
    expect(microBtns.length).toBe(3);

    await user.click(microBtns[0]!); // CFG button
    expect(onSelectFunction).toHaveBeenCalledWith(childFn, 'cfg');
  });

  it('calls onSelectFunction with child function and flowchart mode', async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const childFn: GraphNode = {
      id: NodeId('child-1'),
      label: 'childFnA',
      type: 'function',
      filePath: 'src/module.ts',
      lineNumber: 10,
      properties: {},
    };
    const clusterNode = makeNode({
      id: NodeId('cluster-1'),
      type: 'module',
      isCluster: true,
      childIds: ['child-1'],
      childCount: 1,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, childFn] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={onSelectFunction} />);

    const microBtns = document.querySelectorAll('.cg-detail-function-micro-btns .cg-detail-micro-btn');
    await user.click(microBtns[1]!); // Flowchart button
    expect(onSelectFunction).toHaveBeenCalledWith(childFn, 'flowchart');
  });

  it('calls onSelectFunction with child function and sequence mode', async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const childFn: GraphNode = {
      id: NodeId('child-1'),
      label: 'childFnA',
      type: 'function',
      filePath: 'src/module.ts',
      lineNumber: 10,
      properties: {},
    };
    const clusterNode = makeNode({
      id: NodeId('cluster-1'),
      type: 'module',
      isCluster: true,
      childIds: ['child-1'],
      childCount: 1,
    });

    useGraphStore.setState({ rawNodes: [clusterNode, childFn] });

    render(<NodeDetail node={clusterNode} onClose={noop} onSelectFunction={onSelectFunction} />);

    const microBtns = document.querySelectorAll('.cg-detail-function-micro-btns .cg-detail-micro-btn');
    await user.click(microBtns[2]!); // Sequence button
    expect(onSelectFunction).toHaveBeenCalledWith(childFn, 'sequence');
  });

  // --- Scenario 6: Close button triggers onClose ---
  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const node = makeNode();
    render(<NodeDetail node={node} onClose={onClose} />);

    const closeBtn = document.querySelector('.cg-close-btn') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // --- Scenario 7: Expand/collapse button triggers onCollapse ---
  it('shows expand hint for expandable types when not expanded', () => {
    const node = makeNode({ type: 'module' });
    render(<NodeDetail node={node} onClose={noop} />);

    const hint = document.querySelector('.cg-detail-expand-hint');
    expect(hint).toBeTruthy();
  });

  it('shows collapse button when expandable type is expanded and onCollapse is provided', () => {
    const onCollapse = vi.fn();
    const node = makeNode({ type: 'module' });
    render(<NodeDetail node={node} onClose={noop} isExpanded={true} onCollapse={onCollapse} />);

    const collapseBtn = document.querySelector('.cg-detail-collapse-btn') as HTMLElement;
    expect(collapseBtn).toBeTruthy();
  });

  it('calls onCollapse when collapse button is clicked', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    const node = makeNode({ type: 'module' });
    render(<NodeDetail node={node} onClose={noop} isExpanded={true} onCollapse={onCollapse} />);

    const collapseBtn = document.querySelector('.cg-detail-collapse-btn') as HTMLElement;
    await user.click(collapseBtn);
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it('does not show collapse button when isExpanded but onCollapse is not provided', () => {
    const node = makeNode({ type: 'module' });
    render(<NodeDetail node={node} onClose={noop} isExpanded={true} />);

    const collapseBtn = document.querySelector('.cg-detail-collapse-btn');
    expect(collapseBtn).toBeNull();
  });

  it('does not show expand hint for non-expandable types', () => {
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} />);

    const hint = document.querySelector('.cg-detail-expand-hint');
    expect(hint).toBeNull();
  });

  // --- Scenario 8: Aggregate Call Chain button triggers onAggregateCallChain ---
  it('renders Aggregate Call Chain button when onAggregateCallChain is provided for function nodes', () => {
    const node = makeNode({ type: 'function' });
    render(
      <NodeDetail
        node={node}
        onClose={noop}
        onSelectFunction={noop}
        onAggregateCallChain={noop}
      />,
    );

    const chainBtn = document.querySelector('.cg-detail-chain-btn');
    expect(chainBtn).toBeTruthy();
  });

  it('calls onAggregateCallChain with node id when button is clicked', async () => {
    const user = userEvent.setup();
    const onAggregateCallChain = vi.fn();
    const node = makeNode({ id: NodeId('fn-42'), type: 'function' });
    render(
      <NodeDetail
        node={node}
        onClose={noop}
        onSelectFunction={noop}
        onAggregateCallChain={onAggregateCallChain}
      />,
    );

    const chainBtn = document.querySelector('.cg-detail-chain-btn') as HTMLElement;
    await user.click(chainBtn);
    expect(onAggregateCallChain).toHaveBeenCalledWith('fn-42');
  });

  it('does not render Aggregate Call Chain button when onAggregateCallChain is not provided', () => {
    const node = makeNode({ type: 'function' });
    render(<NodeDetail node={node} onClose={noop} onSelectFunction={noop} />);

    const chainBtn = document.querySelector('.cg-detail-chain-btn');
    expect(chainBtn).toBeNull();
  });

  // --- Scenario 8b: Function body budget action entries (P1-2) ---
  // docs/图谱按需加载.md 第五节要求预算区提供「展开更多 / 只看调用链 / 展开全部」入口。
  // 这些用例覆盖三个出口各自触发的 store 动作，以及「展开全部」的二次确认门。
  const fnA = makeNode({ id: NodeId('fn-a'), label: 'fnA', type: 'function' });
  const fnB = makeNode({ id: NodeId('fn-b'), label: 'fnB', type: 'function' });

  it('renders the budget action buttons for a function node', () => {
    useGraphStore.setState({ rawNodes: [fnA, fnB], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} onHighlightCallChain={noop} />);

    expect(screen.getByText('展开更多')).toBeTruthy();
    expect(screen.getByText('收起已展开')).toBeTruthy();
    expect(screen.getByText('只看调用链')).toBeTruthy();
    expect(screen.getByText('展开全部函数体')).toBeTruthy();
  });

  it('calls expandNode with the first collapsed candidate when 展开更多 is clicked', async () => {
    const user = userEvent.setup();
    const expandNode = vi.spyOn(useGraphStore.getState(), 'expandNode').mockImplementation(() => {});
    useGraphStore.setState({ rawNodes: [fnA, fnB], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    await user.click(screen.getByText('展开更多'));
    expect(expandNode).toHaveBeenCalledWith('fn-a');
  });

  it('disables 展开更多 when every candidate is already expanded', () => {
    useGraphStore.setState({ rawNodes: [fnA], rawEdges: [], expandedNodeIds: new Set(['fn-a']), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    expect((screen.getByText('展开更多') as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires a second confirmation before pinning and batch-expanding every candidate', async () => {
    const user = userEvent.setup();
    const pinNode = vi.spyOn(useGraphStore.getState(), 'pinNode').mockImplementation(() => {});
    const batchExpandNodes = vi.spyOn(useGraphStore.getState(), 'batchExpandNodes').mockImplementation(() => {});
    useGraphStore.setState({ rawNodes: [fnA, fnB], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    // First click only opens the inline confirmation; nothing is pinned yet.
    await user.click(screen.getByText('展开全部函数体'));
    expect(pinNode).not.toHaveBeenCalled();
    expect(batchExpandNodes).not.toHaveBeenCalled();
    expect(document.querySelector('.cg-detail-budget-confirm')).toBeTruthy();

    await user.click(screen.getByText('确认展开'));
    expect(pinNode).toHaveBeenCalledWith('fn-a');
    expect(pinNode).toHaveBeenCalledWith('fn-b');
    expect(batchExpandNodes).toHaveBeenCalledWith(['fn-a', 'fn-b']);
    expect(document.querySelector('.cg-detail-budget-confirm')).toBeNull();
  });

  it('cancels the expand-all confirmation without touching the store', async () => {
    const user = userEvent.setup();
    const pinNode = vi.spyOn(useGraphStore.getState(), 'pinNode').mockImplementation(() => {});
    useGraphStore.setState({ rawNodes: [fnA], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    await user.click(screen.getByText('展开全部函数体'));
    await user.click(screen.getByText('取消'));

    expect(pinNode).not.toHaveBeenCalled();
    expect(document.querySelector('.cg-detail-budget-confirm')).toBeNull();
    expect(screen.getByText('展开全部函数体')).toBeTruthy();
  });

  it('unpins then collapses every expanded candidate', async () => {
    const user = userEvent.setup();
    const unpinNode = vi.spyOn(useGraphStore.getState(), 'unpinNode').mockImplementation(() => {});
    const collapseNode = vi.spyOn(useGraphStore.getState(), 'collapseNode').mockImplementation(() => {});
    useGraphStore.setState({
      rawNodes: [fnA, fnB],
      rawEdges: [],
      expandedNodeIds: new Set(['fn-a', 'fn-b']),
      pinnedIds: new Set(['fn-a']),
    });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    await user.click(screen.getByText('收起已展开'));

    expect(unpinNode.mock.calls.map((c) => c[0])).toEqual(['fn-a', 'fn-b']);
    expect(collapseNode.mock.calls.map((c) => c[0])).toEqual(['fn-a', 'fn-b']);
  });

  it('disables 收起已展开 when nothing is expanded', () => {
    useGraphStore.setState({ rawNodes: [fnA], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    expect((screen.getByText('收起已展开') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onHighlightCallChain with the node id when 只看调用链 is clicked', async () => {
    const user = userEvent.setup();
    const onHighlightCallChain = vi.fn();
    useGraphStore.setState({ rawNodes: [fnA], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} onHighlightCallChain={onHighlightCallChain} />);

    await user.click(screen.getByText('只看调用链'));
    expect(onHighlightCallChain).toHaveBeenCalledWith('fn-a');
  });

  it('does not render 只看调用链 when onHighlightCallChain is not provided', () => {
    useGraphStore.setState({ rawNodes: [fnA], rawEdges: [], expandedNodeIds: new Set(), pinnedIds: new Set() });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    expect(screen.queryByText('只看调用链')).toBeNull();
  });

  // --- Scenario 8c: Single-symbol AST fold disclosure (P1-1) ---
  // docs/图谱按需加载.md:155 要求「超限时显示"该函数过大，已折叠为摘要 / 分段加载"」。
  // 服务端按 SYMBOL_AST.MAX_NODES 切页并回报 total/cursor/hasMore，面板必须如实披露。
  it('discloses the folded AST and offers 分段加载 when the server reported hasMore', () => {
    useGraphStore.setState({
      rawNodes: [fnA],
      rawEdges: [],
      expandedNodeIds: new Set(),
      pinnedIds: new Set(),
      astPageByNodeId: new Map([['fn-a', { loaded: 800, total: 1200, hasMore: true, cursor: 800 }]]),
    });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    expect(document.querySelector('.cg-detail-ast-fold')).toBeTruthy();
    expect(screen.getByText('该函数过大，已折叠为摘要（已加载 800 / 1200 个 AST 节点）')).toBeTruthy();
    expect(screen.getByText('分段加载')).toBeTruthy();
  });

  it('calls loadMoreAst with the node id when 分段加载 is clicked', async () => {
    const user = userEvent.setup();
    const loadMoreAst = vi.spyOn(useGraphStore.getState(), 'loadMoreAst').mockResolvedValue(true);
    useGraphStore.setState({
      rawNodes: [fnA],
      rawEdges: [],
      expandedNodeIds: new Set(),
      pinnedIds: new Set(),
      astPageByNodeId: new Map([['fn-a', { loaded: 800, total: 1200, hasMore: true, cursor: 800 }]]),
    });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    await user.click(screen.getByText('分段加载'));
    expect(loadMoreAst).toHaveBeenCalledWith('fn-a');
  });

  it('hides 分段加载 once the page is complete', () => {
    useGraphStore.setState({
      rawNodes: [fnA],
      rawEdges: [],
      expandedNodeIds: new Set(),
      pinnedIds: new Set(),
      astPageByNodeId: new Map([['fn-a', { loaded: 1200, total: 1200, hasMore: false, cursor: 1200 }]]),
    });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    expect(document.querySelector('.cg-detail-ast-fold')).toBeNull();
    expect(screen.queryByText('分段加载')).toBeNull();
  });

  it('renders no fold notice when no AST page has been recorded', () => {
    useGraphStore.setState({
      rawNodes: [fnA],
      rawEdges: [],
      expandedNodeIds: new Set(),
      pinnedIds: new Set(),
      astPageByNodeId: new Map(),
    });
    render(<NodeDetail node={fnA} onClose={noop} onSelectFunction={noop} />);

    expect(document.querySelector('.cg-detail-ast-fold')).toBeNull();
  });

  // --- Scenario 9: Connection count display ---
  it('shows connection count when connectionCount > 0', () => {
    const node = makeNode();
    render(<NodeDetail node={node} onClose={noop} connectionCount={5} />);

    expect(screen.getByText('5')).toBeTruthy();
  });

  it('does not show connection count when connectionCount is 0', () => {
    const node = makeNode();
    render(<NodeDetail node={node} onClose={noop} connectionCount={0} />);

    const rows = document.querySelectorAll('.cg-detail-row');
    let connectionsFound = false;
    rows.forEach((row) => {
      const label = row.querySelector('.cg-detail-label');
      if (label && label.textContent?.includes('连接数')) connectionsFound = true;
    });
    expect(connectionsFound).toBe(false);
  });

  it('does not show connection count when connectionCount is undefined', () => {
    const node = makeNode();
    render(<NodeDetail node={node} onClose={noop} />);

    const rows = document.querySelectorAll('.cg-detail-row');
    let connectionsFound = false;
    rows.forEach((row) => {
      const label = row.querySelector('.cg-detail-label');
      if (label && label.textContent?.includes('连接数')) connectionsFound = true;
    });
    expect(connectionsFound).toBe(false);
  });

  // --- Scenario 10: Signature display ---
  it('shows signature when node has signature property', () => {
    const node = makeNode({ properties: { signature: '(x: number) => string' } });
    render(<NodeDetail node={node} onClose={noop} />);

    const sigSection = document.querySelector('.cg-detail-signature');
    expect(sigSection).toBeTruthy();
    expect(screen.getByText('(x: number) => string')).toBeTruthy();
  });

  it('does not show signature section when node has no signature', () => {
    const node = makeNode({ properties: {} });
    render(<NodeDetail node={node} onClose={noop} />);

    const sigSection = document.querySelector('.cg-detail-signature');
    expect(sigSection).toBeNull();
  });

  // --- Additional: Docstring display ---
  it('shows docstring when node has docstring property', () => {
    const node = makeNode({ properties: { docstring: 'This is a test function' } });
    render(<NodeDetail node={node} onClose={noop} />);

    const docSection = document.querySelector('.cg-detail-docstring');
    expect(docSection).toBeTruthy();
    expect(screen.getByText('This is a test function')).toBeTruthy();
  });

  it('does not show docstring section when node has no docstring', () => {
    const node = makeNode({ properties: {} });
    render(<NodeDetail node={node} onClose={noop} />);

    const docSection = document.querySelector('.cg-detail-docstring');
    expect(docSection).toBeNull();
  });

  // --- Additional: Extra properties display ---
  it('shows extra properties that are not in the known keys set', () => {
    const node = makeNode({ properties: { customProp: 'customValue' } });
    render(<NodeDetail node={node} onClose={noop} />);

    expect(screen.getByText('customProp')).toBeTruthy();
    expect(screen.getByText('customValue')).toBeTruthy();
  });

  it('does not show known keys (signature, docstring, exported, kind) as extra properties', () => {
    const node = makeNode({
      properties: {
        signature: '(x: number) => string',
        docstring: 'A function',
        exported: true,
        kind: 'function',
      },
    });
    render(<NodeDetail node={node} onClose={noop} />);

    const extraSection = document.querySelector('.cg-detail-extra');
    expect(extraSection).toBeNull();
  });

  it('serializes object-valued extra properties as JSON', () => {
    const node = makeNode({ properties: { meta: { count: 3 } } });
    render(<NodeDetail node={node} onClose={noop} />);

    expect(screen.getByText('{"count":3}')).toBeTruthy();
  });

  // --- Additional: Panel accessibility ---
  it('renders panel with complementary role and aria-live', () => {
    const node = makeNode();
    render(<NodeDetail node={node} onClose={noop} />);

    const panel = document.querySelector('.cg-node-detail-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('role')).toBe('complementary');
    expect(panel?.getAttribute('aria-live')).toBe('polite');
  });

  // --- Additional: Expandable types ---
  it('recognizes module, class, and interface as expandable types', () => {
    for (const type of ['module', 'class', 'interface'] as const) {
      cleanup();
      const node = makeNode({ type });
      render(<NodeDetail node={node} onClose={noop} />);
      const hint = document.querySelector('.cg-detail-expand-hint');
      expect(hint).toBeTruthy();
    }
  });

  it('does not treat function, variable, or type as expandable', () => {
    for (const type of ['function', 'variable', 'type'] as const) {
      cleanup();
      const node = makeNode({ type });
      render(<NodeDetail node={node} onClose={noop} />);
      const hint = document.querySelector('.cg-detail-expand-hint');
      expect(hint).toBeNull();
    }
  });
});
