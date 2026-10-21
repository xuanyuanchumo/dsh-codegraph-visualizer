import type { Core } from 'cytoscape';
import { NodeId } from '../../types/index.ts';
import { HIGHLIGHT } from '../../shared/constants.ts';
import {
  DIFF_STATUSES, DIFF_STATUS_CLASS, DIFF_STATUS_CLASSES,
  type DiffIndex, type DiffMarkStats, summarizeDiff,
} from '../../shared/diffStatus.ts';
import { buildUndirectedAdjacencyMap } from './AdjacencyMapBuilder.ts';


export class HighlightController {
  private cy: Core;
  private highlightedNodeIds: Set<string> = new Set();
  private selectedNodeId: string | null = null;
  private lastInheritanceRelevant: Set<string> = new Set();
  private adjacencyMap: Map<string, Set<string>> | null = null;

  constructor(cy: Core) {
    this.cy = cy;
  }

  private getAdjacencyMap(): Map<string, Set<string>> {
    if (this.adjacencyMap) return this.adjacencyMap;
    this.adjacencyMap = buildUndirectedAdjacencyMap(this.cy);
    return this.adjacencyMap;
  }

  invalidateCache(): void {
    this.adjacencyMap = null;
  }

  highlightNodes(nodeIds: NodeId[]): void {
    const newSet = new Set<string>(nodeIds);
    this.cy.batch(() => {
      const nodesToUnhighlight: string[] = [];
      const nodesToHighlight: string[] = [];
      for (const id of this.highlightedNodeIds) {
        if (!newSet.has(id)) nodesToUnhighlight.push(id);
      }
      for (const id of newSet) {
        if (!this.highlightedNodeIds.has(id)) nodesToHighlight.push(id);
      }
      for (const id of nodesToUnhighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.removeClass('highlighted');
      }
      for (const id of nodesToHighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('highlighted');
      }
      this.cy.edges().forEach((edge) => {
        const srcId = edge.source().id();
        const tgtId = edge.target().id();
        const shouldHighlight = newSet.has(srcId) || newSet.has(tgtId);
        edge.toggleClass('highlighted', shouldHighlight);
      });
    });
    this.highlightedNodeIds = newSet;
  }

  selectNode(nodeId: NodeId | null): void {
    const id = nodeId ?? null;
    if (this.selectedNodeId === id) return;
    this.cy.batch(() => {
      if (this.selectedNodeId) {
        const prev = this.cy.getElementById(this.selectedNodeId);
        if (prev.nonempty()) prev.removeClass('selected');
      }
      if (id) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('selected');
      }
      this.cy.elements().removeClass('neighbor-highlight neighbor-dim');
      if (id) {
        const selectedNode = this.cy.getElementById(id);
        if (selectedNode.nonempty()) {
          const neighborIds = new Set<string>([id]);
          selectedNode.neighborhood().forEach((el) => {
            if (el.isNode()) neighborIds.add(el.id());
          });
          this.cy.nodes(':visible').forEach((n) => {
            if (!neighborIds.has(n.id())) n.addClass('neighbor-dim');
          });
          this.cy.edges(':visible').forEach((e) => {
            const srcIn = neighborIds.has(e.source().id());
            const tgtIn = neighborIds.has(e.target().id());
            if (!srcIn || !tgtIn) e.addClass('neighbor-dim');
            else e.addClass('neighbor-highlight');
          });
        }
      }
    });
    this.selectedNodeId = id;
  }

  highlightCallChain(nodeId: NodeId | null, maxDepth: number = HIGHLIGHT.CALL_CHAIN_MAX_DEPTH): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('call-chain');
      if (!nodeId) return;

      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
      let head = 0;

      while (head < queue.length) {
        const item = queue[head++]!;
        if (visited.has(item.id)) continue;
        if (item.depth > maxDepth) continue;
        visited.add(item.id);

        const node = this.cy.getElementById(item.id);
        if (node.nonempty()) node.addClass('call-chain');

        node.connectedEdges().forEach((edge) => {
          if (edge.source().id() !== item.id) return;
          edge.addClass('call-chain');
          const target = edge.target().id();
          if (!visited.has(target)) queue.push({ id: target, depth: item.depth + 1 });
        });
      }
    });
  }

  highlightInheritance(nodeId: NodeId | null): void {
    if (!nodeId) {
      this.cy.batch(() => {
        this.cy.elements().removeClass('inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
        this.cy.edges('[type="extend"]').addClass('inheritance-extend');
        this.cy.edges('[type="implement"]').addClass('inheritance-implement');
      });
      this.lastInheritanceRelevant.clear();
      return;
    }

    const focusNode = this.cy.getElementById(nodeId);
    if (focusNode.empty()) return;

    const relevant = new Set<string>([nodeId]);
    const relevantEdges = new Set<string>();
    const stack: Array<{ id: string; direction: 'up' | 'down' }> = [
      { id: nodeId, direction: 'up' },
      { id: nodeId, direction: 'down' },
    ];

    while (stack.length > 0) {
      const { id, direction } = stack.pop()!;
      const node = this.cy.getElementById(id);
      const edges = direction === 'up'
        ? node.outgoers('edge[type="extend"], edge[type="implement"]')
        : node.incomers('edge[type="extend"], edge[type="implement"]');
      edges.forEach((edge) => {
        const target = direction === 'up' ? edge.target().id() : edge.source().id();
        if (!relevant.has(target)) {
          relevant.add(target);
          relevantEdges.add(edge.id());
          stack.push({ id: target, direction });
        }
      });
    }

    const toHighlight: string[] = [];
    const toUnhighlight: string[] = [];
    for (const id of relevant) {
      if (!this.lastInheritanceRelevant.has(id)) toHighlight.push(id);
    }
    for (const id of this.lastInheritanceRelevant) {
      if (!relevant.has(id)) toUnhighlight.push(id);
    }

    this.cy.batch(() => {
      for (const id of toUnhighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.removeClass('inheritance-highlight inheritance-dim inheritance-focus');
      }
      this.cy.elements().removeClass('inheritance-focus');
      focusNode.addClass('inheritance-focus');
      for (const id of toHighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('inheritance-highlight');
      }

      this.cy.edges('[type="extend"], edge[type="implement"]').forEach((edge) => {
        if (!relevantEdges.has(edge.id()) && !relevant.has(edge.source().id()) && !relevant.has(edge.target().id())) {
          edge.addClass('inheritance-dim');
        } else {
          edge.removeClass('inheritance-dim');
          if (relevantEdges.has(edge.id())) edge.addClass('inheritance-highlight');
        }
      });
      this.cy.edges('[type!="extend"][type!="implement"]').addClass('inheritance-dim');

      for (const id of toHighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.removeClass('inheritance-dim');
      }
    });

    this.lastInheritanceRelevant = relevant;
  }

  destroy(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('highlighted selected neighbor-highlight neighbor-dim call-chain inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
    });
    this.highlightedNodeIds.clear();
    this.selectedNodeId = null;
    this.lastInheritanceRelevant.clear();
  }

  /**
   * 把一份 diff 索引标记到当前画布上（研究报告 §六 #13 的渲染层补口）。
   *
   * 三条约束：
   *
   * 1. **只加 class，不碰数据**。`diffStatus` 是宿主给出的原始事实，渲染层不得改写它；
   *    标记是「视图状态」，与「数据状态」分离，这样关闭对比时只需移除 class，不会污染
   *    store 里的 `rawNodes`（那会让下一次整图替换带着残留的 `diffStatus`）。
   * 2. **先清后加**。`removeClass` 覆盖全部三个 diff class 再按新索引添加，因此反复调用
   *    不会累积（`diff-added` 的节点第二次被标为 `modified` 时不会同时持有两个 class，
   *    否则样式规则的优先级会决定最终颜色，而那个优先级没有人显式声明过）。
   * 3. **找不到的元素静默跳过**。用户只展开了部分目录时，diff 覆盖的其余元素不在画布上——
   *    这是正常状态，缺失数量由 `summarizeDiff` 单独统计并披露，不在渲染层抛错。
   *
   * 返回**实际标记**的统计，供面板显示「已标记 N 处，另有 M 处不在当前视图」。
   */
  applyDiffMarkers(index: DiffIndex): DiffMarkStats {
    const presentNodeIds = new Set<string>();
    const presentEdgeIds = new Set<string>();
    this.cy.batch(() => {
      // 先清：三个 class 全部摘掉，避免状态迁移后残留（见上面第 2 条）。
      this.cy.elements().removeClass(DIFF_STATUS_CLASSES.join(' '));
      this.cy.nodes().forEach((node) => { presentNodeIds.add(node.id()); });
      this.cy.edges().forEach((edge) => { presentEdgeIds.add(edge.id()); });
      for (const status of DIFF_STATUSES) {
        const cls = DIFF_STATUS_CLASS[status];
        for (const id of index.nodes[status]) {
          const node = this.cy.getElementById(id);
          if (node.nonempty()) node.addClass(cls);
        }
        for (const id of index.edges[status]) {
          const edge = this.cy.getElementById(id);
          if (edge.nonempty()) edge.addClass(cls);
        }
      }
    });
    return summarizeDiff(index, presentNodeIds, presentEdgeIds);
  }

  /** 移除全部 diff 标记，并把 diff 相关 class 从所有元素上摘干净。 */
  clearDiffMarkers(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass(DIFF_STATUS_CLASSES.join(' '));
    });
  }
}
