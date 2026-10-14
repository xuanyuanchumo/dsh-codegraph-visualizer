import { describe, it, expect, beforeEach } from 'vitest';
import {
  CLUSTER,
  DYNAMIC_CLUSTER,
  VIRTUAL_VIEWPORT,
  getDynamicMaxVisibleNodes,
} from '../../src/shared/constants.ts';
import { computeProgressiveClusters } from '../../src/client/store/cluster/progressiveCluster.ts';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { NodeId } from '../../src/types/index.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

/**
 * 契约测试：虚拟视口（`VirtualViewportController`）在真实数据下**可达**。
 *
 * ## 为什么需要这个文件（cycle-93 的核心发现）
 *
 * 这个特性此前是「代码在、测试绿、功能死」：
 *
 *   - 唯一消费点 `src/client/hooks/useGraphRenderer.ts:341-349` 用**显示层**的
 *     `nodes.length` 调 `shouldEnableVirtualScroll`；
 *   - `VirtualViewportController.ts:89-91` 的判据是 `nodeCount > VIRTUAL_VIEWPORT.SCROLL_THRESHOLD`；
 *   - 而显示层在默认 `code` 视图下由 `computeProgressiveClusters` 产出，
 *     其上限是 `CLUSTER.MAX_VISIBLE_NODES`(1500)（`progressiveCluster.ts:496-498`
 *     的 `enforceNodeLimit`）。
 *
 * 旧阈值 2500 **高于** 1500 这个硬上限 ⇒ 无论喂多大的图，判定都恒为 false。
 * 两个常量在 git 历史上从未联合校准：`VIRTUAL_VIEWPORT` 由 2000 → 5000 → 2500
 * 独立演进，`MAX_VISIBLE_NODES` 是另一次提交引入的。
 *
 * 注意还有一个更隐蔽的层次：`code` 视图的显示层通常根本不是 1500 而是**一级目录的个数**
 * （depth 0 时每个目录一个聚类节点）。所以「阈值必须低于硬上限」只是必要条件，
 * 本文件还要用**真实数据**证明它真的能被跨过。
 *
 * 三条断言各有分工，缺一条这个契约就会退化成同义反复：
 *   1. 阈值 < 三个动态上限与硬上限（源码级不等式）；
 *   2. 大图确实能把显示层推过阈值（可达性）；
 *   3. 小图不会推过阈值（反向自检：否则「任何数据都通过」）。
 */

function makeFunctionNode(id: string, filePath: string): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: 'function',
    filePath,
    lineNumber: 1,
    properties: {},
  };
}

/** 每个节点独占一个一级目录：depth 0 聚类后每个节点都变成一个目录聚类节点。 */
function makeWideGraph(count: number): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push(makeFunctionNode(`f${i}`, `src/dir${i}/file${i}.ts`));
  }
  return nodes;
}

describe('虚拟滚动可达性契约（cycle-93）', () => {
  it('阈值必须低于聚类上限，否则 code 视图永远够不到', () => {
    // 硬上限：显示层超过它就会被 enforceNodeLimit 折叠回来。
    expect(
      VIRTUAL_VIEWPORT.SCROLL_THRESHOLD,
      'SCROLL_THRESHOLD 高于 CLUSTER.MAX_VISIBLE_NODES 时，code 视图的显示层永远到不了阈值'
    ).toBeLessThan(CLUSTER.MAX_VISIBLE_NODES);
    // 动态上限（按面板宽度取）：三者都不得低于阈值，否则窄屏/宽屏下会各自不可达。
    expect(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD).toBeLessThan(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL);
    expect(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD).toBeLessThan(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_MEDIUM);
    expect(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD).toBeLessThan(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_LARGE);
    // 三个动态上限本身必须自洽（getDynamicMaxVisibleNodes 的取值面）。
    expect(getDynamicMaxVisibleNodes(1000)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL);
    expect(getDynamicMaxVisibleNodes(3000)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_LARGE);
  });

  it('真实大图能把 code 视图的显示层推过阈值（可达，不是纸面可达）', () => {
    const display = computeProgressiveClusters(makeWideGraph(4000), [], new Set(), 0);
    expect(display.nodes.length).toBeGreaterThan(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD);
  });

  it('反向自检：小图的显示层不得跨过阈值', () => {
    const display = computeProgressiveClusters(makeWideGraph(20), [], new Set(), 0);
    expect(display.nodes.length).toBeLessThanOrEqual(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD);
  });

  it('store 级可达：setGraphData 之后 store.nodes 就超过阈值', () => {
    useGraphStore.getState().clearGraph();
    useGraphStore.setState({ viewMode: 'code', clusterDepth: 0, expandedNodeIds: new Set() });
    const nodes = makeWideGraph(4000);
    const edges: GraphEdge[] = [];
    useGraphStore.getState().setGraphData(nodes, edges, 'reachability-repo');
    expect(useGraphStore.getState().nodes.length).toBeGreaterThan(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD);
    useGraphStore.getState().clearGraph();
  });

  beforeEach(() => {
    useGraphStore.getState().clearGraph();
  });
});
