/**
 * cycle-149 契约：多选链路消费面（multiSelectSlice）。
 *
 * ## 为什么走**真实组合 store** 而不是 mock
 *
 * 多选镜像的意义就在接缝：渲染器回调 → store 动作 → 批量动作复用（batchExpandNodes 的
 * 预算/pinned 语义）。mock 掉 store 会让接缝缺陷变成 undefined 静默通过（Legend.test.tsx
 * 同一取舍）。批量展开/收起断言的是**真实 recluster 后的 expandedNodeIds**，不是调用记录。
 *
 * ## 钉死的契约
 *
 * - MS-SLICE-1 镜像同步：syncMultiSelection 以完整集合为准（不是增量 toggle）；
 * - MS-SLICE-2 幂等：同集合重复同步不产生状态翻动；
 * - MS-SLICE-3/4 清空与空清空 no-op；
 * - MS-SLICE-5/6 批量展开：空选区返回 0；有选区走 batchExpandNodes 后 expandedNodeIds 真实增长；
 * - MS-SLICE-7 批量收起：pinned 豁免（collapseNode 语义一致），返回实际收起数；
 * - MS-SLICE-8 导出：rawNodes 过滤 + 聚合 id 静默跳过（诚实缺口，见 multiSelectSlice 注释）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

import { useGraphStore } from '../../src/client/store/graphStore.ts';
import type { GraphNode } from '../../src/client/../types/index.ts';

function node(id: string, type: GraphNode['type'] = 'function'): GraphNode {
  return {
    id: id as GraphNode['id'],
    label: id.toUpperCase(),
    filePath: `src/${id}.ts`,
    lineNumber: 1,
    type,
    properties: {},
  } as GraphNode;
}

describe('multiSelectSlice (cycle-149)', () => {
  beforeEach(() => {
    useGraphStore.setState({
      multiSelectedIds: new Set<string>(),
      pinnedIds: new Set<string>(),
    });
  });

  it('MS-SLICE-1 syncMultiSelection mirrors the complete set (not incremental)', () => {
    useGraphStore.getState().syncMultiSelection(['a', 'b']);
    expect([...useGraphStore.getState().multiSelectedIds].sort()).toEqual(['a', 'b']);
    // 完整集合为准：再次同步一个**更小**的集合应整体替换（增量语义会残留 'a'）
    useGraphStore.getState().syncMultiSelection(['b']);
    expect([...useGraphStore.getState().multiSelectedIds]).toEqual(['b']);
  });

  it('MS-SLICE-2 syncMultiSelection is idempotent for the same membership', () => {
    useGraphStore.getState().syncMultiSelection(['a', 'b']);
    const first = useGraphStore.getState().multiSelectedIds;
    useGraphStore.getState().syncMultiSelection(['b', 'a']); // 同成员不同顺序
    expect(useGraphStore.getState().multiSelectedIds).toBe(first); // 引用不变 = 无状态翻动
  });

  it('MS-SLICE-3 clearMultiSelection empties the mirror', () => {
    useGraphStore.getState().syncMultiSelection(['a']);
    useGraphStore.getState().clearMultiSelection();
    expect(useGraphStore.getState().multiSelectedIds.size).toBe(0);
  });

  it('MS-SLICE-4 clearMultiSelection on empty is a no-op', () => {
    const before = useGraphStore.getState().multiSelectedIds;
    useGraphStore.getState().clearMultiSelection();
    expect(useGraphStore.getState().multiSelectedIds).toBe(before);
  });

  it('MS-SLICE-5 batchExpandSelected with empty selection returns 0 and does not touch expandedNodeIds', () => {
    useGraphStore.setState({ expandedNodeIds: new Set<string>(['x']) });
    const ret = useGraphStore.getState().batchExpandSelected();
    expect(ret).toBe(0);
    expect([...useGraphStore.getState().expandedNodeIds]).toEqual(['x']);
  });

  it('MS-SLICE-6 batchExpandSelected expands via batchExpandNodes (real recluster)', () => {
    const nodes = [node('a', 'module'), node('b', 'module'), node('c', 'function')];
    useGraphStore.setState({
      rawNodes: nodes,
      nodes: [],
      rawEdges: [],
      viewMode: 'code',
      panelWidth: 1200,
      expandedNodeIds: new Set<string>(),
      expandedNodeIdsByViewMode: { code: new Set<string>() },
    });
    useGraphStore.getState().syncMultiSelection(['a', 'b']);
    const ret = useGraphStore.getState().batchExpandSelected();
    expect(ret).toBe(2);
    const expanded = useGraphStore.getState().expandedNodeIds;
    expect(expanded.has('a')).toBe(true);
    expect(expanded.has('b')).toBe(true);
  });

  it('MS-SLICE-7 batchCollapseSelected collapses unpinned members in ONE pass, pinned survive', () => {
    useGraphStore.setState({
      viewMode: 'code',
      panelWidth: 1200,
      rawNodes: [node('a', 'module'), node('b', 'module'), node('c', 'module')],
      nodes: [],
      rawEdges: [],
      expandedNodeIds: new Set<string>(['a', 'b', 'c']),
      expandedNodeIdsByViewMode: { code: new Set<string>(['a', 'b', 'c']) },
      multiSelectedIds: new Set<string>(['a', 'b']),
      pinnedIds: new Set<string>(['b']),
    });
    const ret = useGraphStore.getState().batchCollapseSelected();
    expect(ret).toBe(1); // a 收起，b pinned 豁免
    const expanded = useGraphStore.getState().expandedNodeIds;
    expect(expanded.has('a')).toBe(false);
    expect(expanded.has('b')).toBe(true); // pinned 存活
    expect(expanded.has('c')).toBe(true); // 未选中不受影响
  });

  it('MS-SLICE-8 exportSelectedNodes filters rawNodes and silently skips cluster ids', () => {
    useGraphStore.setState({
      rawNodes: [node('a'), node('b')],
    });
    useGraphStore.getState().syncMultiSelection(['a', 'cluster:src', 'b']);
    const exported = useGraphStore.getState().exportSelectedNodes();
    expect(exported.map((n) => n.id)).toEqual(['a', 'b']); // cluster id 不在 rawNodes → 跳过
  });
});
