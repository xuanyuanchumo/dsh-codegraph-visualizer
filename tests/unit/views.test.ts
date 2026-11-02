/**
 * `partitionByView`（Π 视图划分函数）的单元测试（cycle-138 / 研究方案 §4 的 Π 维）。
 *
 * ## 它守的是什么
 *
 * §4 把 Π 定义为 $\\Pi: V \\cup E \\to 2^{\\mathcal{V}_{\\text{view}}}$。核心契约：
 *
 * 1. **结构视图恒属所有节点与边**（它是基图）；
 * 2. 其余三个视图是**叠加**的：一个节点可以同时属于多个视图（§4 的「多向自洽连接」）；
 * 3. **边级口径**：边属于某视图当且仅当两端点都属于（领域视图额外要求两端点在同一社区）；
 * 4. **跨社区边不属于任何领域视图**——它是「桥」，属于结构视图但不属于单一领域。
 */
import { describe, it, expect } from 'vitest';
import { partitionByView, serializeViewPartition, VIEW_NAMES, type ViewName } from '../../src/shared/views.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

function makeGraph() {
  return makeGraphData(
    [
      makeNode('n-a', 'a', 'function', 'src/a.ts', 1),
      makeNode('n-b', 'b', 'function', 'src/b.ts', 1),
      makeNode('n-c', 'c', 'function', 'src/c.ts', 1),
      makeNode('n-d', 'd', 'function', 'src/d.ts', 1),
    ],
    [
      makeEdge('e-ab', 'n-a', 'n-b', 'call'),
      makeEdge('e-cd', 'n-c', 'n-d', 'call'),
      makeEdge('e-bc', 'n-b', 'n-c', 'import'),
    ],
    'repo-1',
    1000,
  );
}

describe('partitionByView: 结构视图恒属', () => {
  it('没有任何事实输入时，所有节点与边都只属于结构视图', () => {
    const graph = makeGraph();
    const partition = partitionByView({ data: graph });
    for (const [id, views] of partition.nodeViews) {
      expect(views.has('structural')).toBe(true);
      expect(views.size).toBe(1);
      void id;
    }
    for (const [id, views] of partition.edgeViews) {
      expect(views.has('structural')).toBe(true);
      expect(views.size).toBe(1);
      void id;
    }
    expect(partition.viewCounts.structural).toBe(4);
    expect(partition.viewCounts.temporal).toBe(0);
  });
});

describe('partitionByView: 时序视图', () => {
  it('只把文件被 commit 切片触及的节点标为时序视图', () => {
    const graph = makeGraph();
    // 只触及 src/a.ts 与 src/b.ts
    const temporalFiles = new Set(['src/a.ts', 'src/b.ts']);
    const partition = partitionByView({ data: graph, temporalFiles });

    expect(partition.nodeViews.get('n-a')!.has('temporal')).toBe(true);
    expect(partition.nodeViews.get('n-b')!.has('temporal')).toBe(true);
    expect(partition.nodeViews.get('n-c')!.has('temporal')).toBe(false);
    expect(partition.nodeViews.get('n-d')!.has('temporal')).toBe(false);
    expect(partition.viewCounts.temporal).toBe(2);
  });

  it('边级口径：两端点都在时序切片里，边才算', () => {
    const graph = makeGraph();
    const temporalFiles = new Set(['src/a.ts', 'src/b.ts']);
    const partition = partitionByView({ data: graph, temporalFiles });

    // a→b 两端都在 ⇒ 边属于时序
    expect(partition.edgeViews.get('e-ab')!.has('temporal')).toBe(true);
    // b→c：c 不在 ⇒ 边不属于时序
    expect(partition.edgeViews.get('e-bc')!.has('temporal')).toBe(false);
    // c→d 两端都不在 ⇒ 不属于
    expect(partition.edgeViews.get('e-cd')!.has('temporal')).toBe(false);
  });
});

describe('partitionByView: 所有权视图', () => {
  it('只把有 blame 记录的节点标为所有权视图', () => {
    const graph = makeGraph();
    const attributedNodeIds = new Set(['n-a', 'n-b']);
    const partition = partitionByView({ data: graph, attributedNodeIds });

    expect(partition.nodeViews.get('n-a')!.has('ownership')).toBe(true);
    expect(partition.nodeViews.get('n-b')!.has('ownership')).toBe(true);
    expect(partition.nodeViews.get('n-c')!.has('ownership')).toBe(false);
  });
});

describe('partitionByView: 领域视图', () => {
  it('只把分配到社区的节点标为领域视图', () => {
    const graph = makeGraph();
    const domainByNodeId = new Map([['n-a', 'core'], ['n-b', 'core'], ['n-c', 'util'], ['n-d', 'util']]);
    const partition = partitionByView({ data: graph, domainByNodeId });

    expect(partition.nodeViews.get('n-a')!.has('domain')).toBe(true);
    expect(partition.viewCounts.domain).toBe(4);
  });

  it('**跨社区边不属于任何领域视图**（它是桥）', () => {
    const graph = makeGraph();
    // a,b 在 core；c,d 在 util。b→c 是跨社区边。
    const domainByNodeId = new Map([['n-a', 'core'], ['n-b', 'core'], ['n-c', 'util'], ['n-d', 'util']]);
    const partition = partitionByView({ data: graph, domainByNodeId });

    // a→b 同社区 ⇒ 属于领域
    expect(partition.edgeViews.get('e-ab')!.has('domain')).toBe(true);
    // c→d 同社区 ⇒ 属于领域
    expect(partition.edgeViews.get('e-cd')!.has('domain')).toBe(true);
    // b→c 跨社区 ⇒ **不属于**领域（但属于结构）
    expect(partition.edgeViews.get('e-bc')!.has('domain')).toBe(false);
    expect(partition.edgeViews.get('e-bc')!.has('structural')).toBe(true);
  });
});

describe('partitionByView: 多向自洽连接', () => {
  it('一个节点可以同时属于多个视图', () => {
    const graph = makeGraph();
    const partition = partitionByView({
      data: graph,
      temporalFiles: new Set(['src/a.ts']),
      attributedNodeIds: new Set(['n-a']),
      domainByNodeId: new Map([['n-a', 'core']]),
    });
    const views = partition.nodeViews.get('n-a')!;
    expect(views.has('structural')).toBe(true);
    expect(views.has('temporal')).toBe(true);
    expect(views.has('ownership')).toBe(true);
    expect(views.has('domain')).toBe(true);
    expect(views.size).toBe(4);
  });
});

describe('serializeViewPartition', () => {
  it('转成可 JSON 序列化的形状，且视图名已排序', () => {
    const graph = makeGraph();
    const partition = partitionByView({
      data: graph,
      temporalFiles: new Set(['src/a.ts']),
      attributedNodeIds: new Set(['n-a']),
      domainByNodeId: new Map([['n-a', 'core']]),
    });
    const serialized = serializeViewPartition(partition);
    // JSON.stringify 不抛错（Map/Set 不能直接序列化）
    expect(() => JSON.stringify(serialized)).not.toThrow();
    const aEntry = serialized.nodes.find((n) => n.id === 'n-a')!;
    expect(aEntry.views).toEqual(['domain', 'ownership', 'structural', 'temporal']);
  });
});

describe('VIEW_NAMES 是唯一真源', () => {
  it('包含四个视图且顺序稳定', () => {
    expect([...VIEW_NAMES]).toEqual(['structural', 'temporal', 'ownership', 'domain']);
  });

  it('每个视图名都是合法的 ViewName', () => {
    const valid = new Set<ViewName>(['structural', 'temporal', 'ownership', 'domain']);
    for (const name of VIEW_NAMES) expect(valid.has(name)).toBe(true);
  });
});
