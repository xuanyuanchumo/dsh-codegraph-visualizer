/**
 * 视图切换数据保存/恢复契约（cycle-125 真机冒烟发现的「切回 code 丢全量图」疑云的 store 层固化）。
 *
 * 真机现象：依赖视图切回 code 后状态条短暂显示 34 节点（依赖聚合数）。
 * 本文件实证 store 层保存/恢复语义正确：
 *   1. code→dependencies 切换时 viewModeTransition 保存 savedRawNodes=骨架；
 *   2. dependencies fetch 回来 setGraphData(依赖聚合) **覆盖 rawNodes 但不动 savedRawNodes**；
 *   3. 切回 code 时 restoreNodes = savedRawNodes（骨架）——恢复正确。
 *
 * 真机 34 的解释：状态条显示的是 loadBootstrap 异步窗口的中间态（时序显示），
 * 或 /dependencies 响应本身的聚合数——不是 store 层丢数据。
 * 本文件把这对语义钉成契约：未来任何人改动 setGraphData 或 viewModeTransition
 * 的保存/恢复逻辑，这里会红。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { NodeId } from '../../src/types/index.ts';

const skeleton = Array.from({ length: 50 }, (_, i) => ({
  id: NodeId('file:' + i),
  label: 'f' + i,
  type: 'module' as const,
  filePath: 'f' + i,
  lineNumber: 1,
  properties: {},
}));

const depAggregated = Array.from({ length: 7 }, (_, i) => ({
  id: NodeId('dir:' + i),
  label: 'd' + i,
  type: 'module' as const,
  filePath: 'd' + i,
  lineNumber: 1,
  properties: {},
}));

beforeEach(() => {
  useGraphStore.getState().setGraphData(skeleton, [], NodeId('r'), {});
});

describe('视图切换数据保存/恢复（dependencies ↔ code）', () => {
  it('code→dependencies 切换保存 savedRawNodes=骨架', () => {
    useGraphStore.getState().setViewMode('dependencies');
    expect(useGraphStore.getState().savedRawNodes.length).toBe(50);
  });

  it('dependencies fetch 回来 setGraphData(聚合) 覆盖 rawNodes 但不动 savedRawNodes', () => {
    useGraphStore.getState().setViewMode('dependencies');
    useGraphStore.getState().setGraphData(depAggregated, [], NodeId('r'), {});
    const s = useGraphStore.getState();
    expect(s.rawNodes.length).toBe(7);       // 画布切到依赖聚合
    expect(s.savedRawNodes.length).toBe(50); // 骨架仍在（恢复语义的前提）
  });

  it('切回 code 恢复 savedRawNodes（骨架 50，不是依赖聚合 7）', () => {
    useGraphStore.getState().setViewMode('dependencies');
    useGraphStore.getState().setGraphData(depAggregated, [], NodeId('r'), {});
    useGraphStore.getState().setViewMode('code');
    expect(useGraphStore.getState().rawNodes.length).toBe(50);
    expect(useGraphStore.getState().rawNodes[0]!.id).toBe(skeleton[0]!.id);
  });

  it('宏视图（inheritance）fetch 回来 setGraphData(全量) 后切回 code 同样恢复骨架', () => {
    // cycle-125 新增的宏视图拉取分支也走 setGraphData——语义必须与 dependencies 一致
    useGraphStore.getState().setViewMode('inheritance');
    useGraphStore.getState().setGraphData(depAggregated, [], NodeId('r'), {});
    useGraphStore.getState().setViewMode('code');
    expect(useGraphStore.getState().rawNodes.length).toBe(50);
  });

  it('clearGraph 清空 savedRawNodes（跨工作区污染防护——workspaceSlice 既有语义回归）', () => {
    useGraphStore.getState().setViewMode('dependencies');
    useGraphStore.getState().setGraphData(depAggregated, [], NodeId('r'), {});
    useGraphStore.getState().clearGraph();
    expect(useGraphStore.getState().savedRawNodes).toHaveLength(0);
  });
});
