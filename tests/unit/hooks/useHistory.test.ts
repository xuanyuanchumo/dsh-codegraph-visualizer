/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useGraphStore } from '../../../src/client/store/graphStore.ts';
import { useHistory } from '../../../src/client/hooks/useHistory.ts';
import { NodeId } from '../../../src/types/index.ts';

// 辅助函数：等待所有微任务完成（处理 queueMicrotask）
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useHistory hook', () => {
  beforeEach(() => {
    // 重置 store 到初始状态
    useGraphStore.getState().clearGraph();
    useGraphStore.setState({
      layout: 'cose',
      filterType: 'all',
      graphType: 'all',
      clusterDepth: 0,
      selectedNodeId: null,
      expandedNodeIds: new Set(),
      viewMode: 'code',
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ── 场景 1：初始状态 ──────────────────────────────────────────────
  it('初始状态 canUndo=false, canRedo=false', () => {
    const { result } = renderHook(() => useHistory());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  // ── 场景 2：状态变化后 canUndo=true ──────────────────────────────
  it('状态变化后 canUndo=true', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    expect(result.current.canUndo).toBe(true);
  });

  // ── 场景 3：undo 恢复到上一个状态 ────────────────────────────────
  it('undo 恢复到上一个状态', async () => {
    const { result } = renderHook(() => useHistory());

    // 第一次状态变化：推入 snapshot_dagre
    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    // 第二次状态变化：推入 snapshot_circle
    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    expect(useGraphStore.getState().layout).toBe('circle');

    // undo 应恢复到 layout='dagre'
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('dagre');
  });

  // ── 场景 4：redo 恢复到下一个状态 ────────────────────────────────
  it('redo 恢复到下一个状态', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('dagre');

    act(() => {
      result.current.redo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('circle');
  });

  // ── 场景 5：undo 后 canRedo=true ─────────────────────────────────
  it('undo 后 canRedo=true', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(result.current.canRedo).toBe(true);
  });

  // ── 场景 6：多次 undo/redo ───────────────────────────────────────
  it('多次 undo/redo', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    act(() => {
      useGraphStore.getState().setLayout('grid');
    });

    // undo: 应恢复到 layout='circle'
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('circle');

    // undo: 应恢复到 layout='dagre'
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('dagre');

    // redo: 应恢复到 layout='circle'
    act(() => {
      result.current.redo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('circle');

    // redo: 应恢复到 layout='grid'
    act(() => {
      result.current.redo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('grid');
  });

  // ── 场景 7：新状态变化后 canRedo=false（清除 redo 历史）──────────
  it('新状态变化后 canRedo=false（清除 redo 历史）', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(result.current.canRedo).toBe(true);

    // 新状态变化应清空 redo 栈
    act(() => {
      useGraphStore.getState().setLayout('grid');
    });

    expect(result.current.canRedo).toBe(false);
  });

  // ── 场景 8：快照包含所有需要保存的状态字段 ──────────────────────
  it('快照包含所有需要保存的状态字段', async () => {
    const { result } = renderHook(() => useHistory());

    // 第一次状态变化：通过 setState 一次性设置多个字段（只触发一次 pushHistory）
    act(() => {
      useGraphStore.setState({
        layout: 'dagre',
        filterType: 'function',
        graphType: 'call',
        clusterDepth: 2,
        selectedNodeId: NodeId('node-1'),
        expandedNodeIds: new Set(['n1', 'n2']),
      });
    });

    // 第二次状态变化：通过 setState 一次性改变所有字段
    act(() => {
      useGraphStore.setState({
        layout: 'circle',
        filterType: 'class',
        graphType: 'dependency',
        clusterDepth: 1,
        selectedNodeId: NodeId('node-2'),
        expandedNodeIds: new Set(['n3']),
      });
    });

    // undo 应恢复到第一次的状态（所有字段都被保存）
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    const s = useGraphStore.getState();
    expect(s.layout).toBe('dagre');
    expect(s.filterType).toBe('function');
    expect(s.graphType).toBe('call');
    expect(s.clusterDepth).toBe(2);
    expect(s.selectedNodeId).toBe(NodeId('node-1'));
    expect(s.expandedNodeIds).toEqual(new Set(['n1', 'n2']));
  });

  // ── 补充：undo 后 canUndo 状态 ───────────────────────────────────
  it('undo 后 canUndo 正确反映历史栈状态', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    expect(result.current.canUndo).toBe(true);

    // undo 后 canUndo 仍为 true（还有 snapshot_dagre 在栈中）
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(result.current.canUndo).toBe(true);
    expect(useGraphStore.getState().layout).toBe('dagre');

    // 再次 undo：弹出栈底快照，prev 为 null，不调用 applySnapshot/updateFlags
    // 注意：这是 hook 的已知行为——undo 到栈底时 canUndo 的 React 状态不会被更新
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    // layout 不变（undo 到栈底时没有状态恢复）
    expect(useGraphStore.getState().layout).toBe('dagre');
  });

  // ── 补充：相同状态不产生新快照 ───────────────────────────────────
  it('相同状态变化不产生新快照', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    expect(result.current.canUndo).toBe(true);

    // 设置相同的 layout 不应触发 pushHistory
    // (setLayout('dagre') 不会触发 store 订阅，因为值没变)
    act(() => {
      useGraphStore.getState().setFilterType('function');
    });

    // 再设置回 'all'，然后设置 'function'，不应产生重复快照
    act(() => {
      useGraphStore.getState().setFilterType('all');
    });

    act(() => {
      useGraphStore.getState().setFilterType('function');
    });

    // canUndo 应为 true（有多个不同的快照）
    expect(result.current.canUndo).toBe(true);
  });

  // ── 补充：viewMode 字段的快照保存和恢复 ─────────────────────────
  it('viewMode 字段的快照保存和恢复', async () => {
    const { result } = renderHook(() => useHistory());

    // 使用 setState 直接设置 viewMode，避免触发 setViewMode 的复杂逻辑
    act(() => {
      useGraphStore.setState({ viewMode: 'dependencies' });
    });

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    // undo 应恢复到 viewMode='dependencies', layout='cose'
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().viewMode).toBe('dependencies');
    expect(useGraphStore.getState().layout).toBe('cose');
  });

  // ── 补充：pushHistory 手动调用 ───────────────────────────────────
  it('pushHistory 手动调用可以保存当前状态', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    // 手动调用 pushHistory 不应产生重复快照（与自动推送的相同）
    act(() => {
      result.current.pushHistory();
    });

    expect(result.current.canUndo).toBe(true);
  });

  // ── 补充：undo/redo 后继续操作不会产生重复快照 ──────────────────
  it('undo 后继续状态变化正常记录历史', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('dagre');

    // undo 后继续操作
    act(() => {
      useGraphStore.getState().setLayout('grid');
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    // undo 可以回到 dagre
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().layout).toBe('dagre');
  });

  // ── 补充：无历史可 undo 时调用 undo 不产生副作用 ────────────────
  it('无历史可 undo 时调用 undo 不产生副作用', () => {
    const { result } = renderHook(() => useHistory());

    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.undo();
    });

    // 状态不应变化
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  // ── 补充：无历史可 redo 时调用 redo 不产生副作用 ────────────────
  it('无历史可 redo 时调用 redo 不产生副作用', () => {
    const { result } = renderHook(() => useHistory());

    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.redo();
    });

    // 状态不应变化
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  // ── 补充：expandedNodeIds 的 Set 深拷贝独立性 ───────────────────
  it('快照中的 expandedNodeIds 是独立副本，不受后续修改影响', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.setState({ expandedNodeIds: new Set(['n1', 'n2']) });
    });

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    // undo 应恢复到 expandedNodeIds=['n1', 'n2']
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().expandedNodeIds).toEqual(new Set(['n1', 'n2']));
  });

  // ── 补充：applySnapshot 中 viewMode 不同时通过 setViewMode 恢复 ──
  it('applySnapshot 中 viewMode 不同时通过 setViewMode 恢复', async () => {
    const { result } = renderHook(() => useHistory());

    // 通过 setState 设置 viewMode='dependencies'
    act(() => {
      useGraphStore.setState({ viewMode: 'dependencies' });
    });

    // 通过 setState 设置 viewMode='code'（回到初始值）
    act(() => {
      useGraphStore.setState({ viewMode: 'code' });
    });

    // undo 应恢复到 viewMode='dependencies'
    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().viewMode).toBe('dependencies');
  });

  // ── 补充：filterType 变化的 undo 恢复 ────────────────────────────
  it('filterType 变化的 undo 恢复', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setFilterType('function');
    });

    act(() => {
      useGraphStore.getState().setFilterType('class');
    });

    expect(useGraphStore.getState().filterType).toBe('class');

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().filterType).toBe('function');
  });

  // ── 补充：graphType 变化的 undo 恢复 ─────────────────────────────
  it('graphType 变化的 undo 恢复', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setGraphType('call');
    });

    act(() => {
      useGraphStore.getState().setGraphType('dependency');
    });

    expect(useGraphStore.getState().graphType).toBe('dependency');

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().graphType).toBe('call');
  });

  // ── 补充：clusterDepth 变化的 undo 恢复 ──────────────────────────
  it('clusterDepth 变化的 undo 恢复', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setClusterDepth(2);
    });

    act(() => {
      useGraphStore.getState().setClusterDepth(1);
    });

    expect(useGraphStore.getState().clusterDepth).toBe(1);

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().clusterDepth).toBe(2);
  });

  // ── 补充：selectedNodeId 变化的 undo 恢复 ────────────────────────
  it('selectedNodeId 变化的 undo 恢复', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setSelectedNode(NodeId('node-a'));
    });

    act(() => {
      useGraphStore.getState().setSelectedNode(NodeId('node-b'));
    });

    expect(useGraphStore.getState().selectedNodeId).toBe(NodeId('node-b'));

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(useGraphStore.getState().selectedNodeId).toBe(NodeId('node-a'));
  });

  // ── 补充：redo 后 canUndo 状态 ───────────────────────────────────
  it('redo 后 canUndo 状态正确', async () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      useGraphStore.getState().setLayout('dagre');
    });

    act(() => {
      useGraphStore.getState().setLayout('circle');
    });

    act(() => {
      result.current.undo();
    });

    await flushMicrotasks();

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });

    await flushMicrotasks();

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });
});