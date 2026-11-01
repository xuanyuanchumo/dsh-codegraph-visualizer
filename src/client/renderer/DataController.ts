import type { Core, NodeDataDefinition } from 'cytoscape';
import { NodeId, safeString, safeNumber, safeBoolean, isNodeType, type GraphNode, type GraphEdge } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/cluster/index.ts';
import { AdjacencyCache } from './AdjacencyCache.ts';
import { DATA_CONTROLLER } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('data-controller');

/**
 * 数据更新后邻接缓存的**决定**（cycle-126 · T1）。
 *
 * - `dirty`：调用方**必须** invalidate（全量重建降级路径——端点变化 / 桩 / 细节不可追踪）。
 *   这是历史唯一行为，缺省即 dirty，语义上不可能「忘判」。
 * - `patch`：DataController 已用结构化 addEdge/removeEdge **并网**过 AdjacencyCache，
 *   内容与 cytoscape 逐边一致，调用方**禁止** invalidate（否则等于全量重建浪费）。
 *   version 尾部对账是最后一道防线（cycle-107 C-1 教训：双源内容漂移静默）。
 */
export interface AdjacencySyncOutcome {
  readonly kind: 'patch' | 'dirty';
  /** 仅 patch 时有意义：调用方用它做 O(1) 内容对账，失败即降级 invalidate。 */
  readonly expectedVersion?: number;
}

/** 缺省结果：任何未表态路径都必须回到「必须失效」的安全方向。 */
const DIRTY: AdjacencySyncOutcome = { kind: 'dirty' } as const;

export class DataController {
  private cy: Core;
  private destroyed = false;
  private currentNodes: Map<string, GraphNode> = new Map();
  private currentEdges: Map<string, GraphEdge> = new Map();
  private rawNodesMap: Map<string, GraphNode> = new Map();
  private rawToVisibleMap: Map<string, string> = new Map();
  private batchRaf: number | null = null;
  private batchQueue: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;
  private lastAddedNodeIds: Set<string> = new Set();
  /** 邻接缓存的并网通道（cycle-126 · T1）。null 时一切结果等价 dirty，调用方自会失效。 */
  private adjacencyCache: AdjacencyCache | null = null;

  constructor(cy: Core) {
    this.cy = cy;
  }

  /**
   * 注入邻接缓存并网通道（cycle-126 · T1）。
   * 注入后 DataController 在结构性增量路径上用 addEdge/removeEdge 把缓存与
   * cytoscape **并网**（逐边同步），全量重置路径则显式 invalidate —— 两类路径
   * 都不再依赖调用方的猜测。
   */
  setAdjacencyCache(cache: AdjacencyCache): void {
    this.adjacencyCache = cache;
  }

  getLastAddedNodeIds(): Set<string> {
    return this.lastAddedNodeIds;
  }

  clearLastAddedNodeIds(): void {
    this.lastAddedNodeIds.clear();
  }

  getRawNodesMap(): Map<string, GraphNode> {
    return this.rawNodesMap;
  }

  getRawToVisibleMap(): Map<string, string> {
    return this.rawToVisibleMap;
  }

  setRawNodes(rawNodes: GraphNode[]): void {
    this.rawNodesMap.clear();
    for (const n of rawNodes) this.rawNodesMap.set(n.id, n);
  }

  updateData(nodes: GraphNode[], edges: GraphEdge[]): AdjacencySyncOutcome {
    this.buildRawToVisibleMap(nodes);
    const changes = this.detectChanges(nodes, edges);
    if (!changes.hasNewNodes && !changes.hasStaleNodes && !changes.hasNewEdges && !changes.hasStaleEdges) {
      const hasUpdatedNodes = this.detectPropertyChanges(nodes);
      // cycle-126 · T2：图本体（节点集合 + 边集合）未变 ⇒ 缓存仍与 cytoscape 一致，
      // 纯属性更新不应触发邻接表失效。旧实现「属性变化 ⇒ invalidate」是误报风暴。
      if (!hasUpdatedNodes) return { kind: 'patch', expectedVersion: this.adjacencyCache?.getVersion() };
      this.applyIncrementalUpdates(nodes, edges);
      this.computeNodeWeights();
      return { kind: 'patch', expectedVersion: this.adjacencyCache?.getVersion() };
    }
    if (changes.hasStaleNodes) {
      this.handleFullReset(nodes, edges);
      return DIRTY;
    }
    return this.handleIncrementalUpdate(nodes, edges, changes);
  }

  private buildRawToVisibleMap(nodes: GraphNode[]): void {
    this.rawToVisibleMap.clear();
    for (const n of nodes) {
      if ('isCluster' in n && n.isCluster === true) {
        const clusterNode = n as ClusterNode;
        for (const childId of clusterNode.childIds) {
          this.rawToVisibleMap.set(childId, n.id);
        }
      } else {
        this.rawToVisibleMap.set(n.id, n.id);
      }
    }
  }

  private detectChanges(nodes: GraphNode[], edges: GraphEdge[]): {
    hasNewNodes: boolean; hasStaleNodes: boolean; hasNewEdges: boolean; hasStaleEdges: boolean;
  } {
    const newNodeIds = new Set<string>(nodes.map((n) => n.id));
    const newEdgeIds = new Set<string>(edges.map((e) => e.id));
    const cyNodeCount = this.cy.nodes().length;
    const cyEdgeCount = this.cy.edges().length;
    const hasNewNodes = nodes.some((n) => !this.currentNodes.has(n.id));
    let hasStaleNodes = cyNodeCount !== nodes.length || this.currentNodes.size > newNodeIds.size;
    if (!hasStaleNodes && this.currentNodes.size === newNodeIds.size) {
      for (const id of this.currentNodes.keys()) {
        if (!newNodeIds.has(id)) { hasStaleNodes = true; break; }
      }
    }
    // cycle-126 · T1（C-4 发现）：同 id 换端点是结构性变化——旧实现只按 id 判重，
    // 换端点落在「无变化」分支被静默忽略（图本体与缓存双双漂移）。
    const hasNewEdges = edges.some((e) => {
      const prev = this.currentEdges.get(e.id);
      if (!prev) return true;
      return prev.source !== e.source || prev.target !== e.target;
    });
    let hasStaleEdges = cyEdgeCount !== edges.length || this.currentEdges.size > newEdgeIds.size;
    if (!hasStaleEdges && this.currentEdges.size === newEdgeIds.size) {
      for (const id of this.currentEdges.keys()) {
        if (!newEdgeIds.has(id)) { hasStaleEdges = true; break; }
      }
    }
    return { hasNewNodes, hasStaleNodes, hasNewEdges, hasStaleEdges };
  }

  private handleFullReset(nodes: GraphNode[], edges: GraphEdge[]): AdjacencySyncOutcome {
    this.cy.elements().remove();
    this.currentNodes.clear();
    this.currentEdges.clear();
    this.lastAddedNodeIds.clear();
    // cycle-126 · T1：全量重置后缓存内容整体失效——显式 invalidate，
    // 不再依赖调用方事后补救。随后 rebuild 会一次性重建全部邻接项。
    this.adjacencyCache?.invalidate();
    this.cy.batch(() => {
      for (const n of nodes) {
        this.addNode(n);
        this.currentNodes.set(n.id, n);
        this.lastAddedNodeIds.add(n.id);
      }
      for (const e of edges) {
        if (this.addEdge(e)) {
          this.currentEdges.set(e.id, e);
        }
      }
    });
    this.computeNodeWeights();
    return DIRTY;
  }

  private handleIncrementalUpdate(
    nodes: GraphNode[], edges: GraphEdge[],
    changes: { hasNewNodes: boolean; hasStaleNodes: boolean; hasNewEdges: boolean; hasStaleEdges: boolean },
  ): AdjacencySyncOutcome {
    const newNodeIds = new Set<string>(nodes.map((n) => n.id));
    const newEdgeIds = new Set<string>(edges.map((e) => e.id));
    const nodesToAdd: GraphNode[] = [];
    const edgesToAdd: GraphEdge[] = [];
    // cycle-126 · T1：结构性增删的并网账本。每个动作要么逐边入账，要么把本轮
    // 降级为 dirty——两套数据源（cytoscape 图本体 vs AdjacencyCache）只允许在
    // 「逐边可追踪」时并存，否则必须整体失效。
    const cache = this.adjacencyCache;
    const patchOps: Array<{ op: 'add' | 'remove'; edge: GraphEdge; prev?: GraphEdge }> = [];
    let dirty = false;

    const recordAdd = (e: GraphEdge): void => {
      if (!cache) return;
      const prev = this.currentEdges.get(e.id);
      if (prev && (prev.source !== e.source || prev.target !== e.target)) {
        patchOps.push({ op: 'remove', edge: prev });
      }
      patchOps.push({ op: 'add', edge: e, prev: prev && prev.source === e.source && prev.target === e.target ? prev : undefined });
    };

    if (changes.hasStaleNodes) {
      const staleNodes = this.cy.nodes().filter((n) => !newNodeIds.has(n.id()));
      if (staleNodes.length > 0) this.cy.remove(staleNodes);
      for (const id of this.currentNodes.keys()) {
        if (!newNodeIds.has(id)) this.currentNodes.delete(id);
      }
    }
    if (changes.hasStaleEdges) {
      const staleEdges = this.cy.edges().filter((e) => !newEdgeIds.has(e.id()));
      if (staleEdges.length > 0) this.cy.remove(staleEdges);
      for (const id of this.currentEdges.keys()) {
        if (!newEdgeIds.has(id)) {
          if (cache) {
            const removed = this.currentEdges.get(id);
            if (removed) patchOps.push({ op: 'remove', edge: removed });
            else dirty = true;
          }
          this.currentEdges.delete(id);
        }
      }
    }

    for (const n of nodes) {
      if (!this.currentNodes.has(n.id)) {
        nodesToAdd.push(n);
        this.lastAddedNodeIds.add(n.id);
      } else {
        this.updateNodeData(n);
      }
      this.currentNodes.set(n.id, n);
    }
    for (const e of edges) {
      if (!this.currentEdges.has(e.id)) {
        edgesToAdd.push(e);
        recordAdd(e);
      }
      else {
        const existing = this.currentEdges.get(e.id);
        const cyEdge = this.cy.getElementById(e.id);
        if (cyEdge.length > 0 && existing && (existing.source !== e.source || existing.target !== e.target)) {
          // 同 id 换端点：recordAdd 内部会先入账 remove(旧端点) 再入账 add(新端点)，
          // 这里只负责图本体（cytoscape 侧删旧加新）。
          this.cy.remove(cyEdge);
          edgesToAdd.push(e);
          recordAdd(e);
        } else {
          if (cyEdge.length > 0 && e.properties) {
            for (const [key, value] of Object.entries(e.properties)) {
              cyEdge.data(key, value);
            }
          }
          this.currentEdges.set(e.id, e);
        }
      }
    }

    if (nodesToAdd.length === 0 && edgesToAdd.length === 0) {
      // cycle-126 · T2：无结构性变化（无增无删无换端点）——图本体未动，邻接表
      // 仍与 cytoscape 一致。返回 patch（缓存免失效），由调用方做 version 对账。
      this.computeNodeWeights();
      return { kind: 'patch', expectedVersion: cache?.getVersion() };
    }
    return this.processBatchAdd(nodesToAdd, edgesToAdd, patchOps, dirty);
  }

  private processBatchAdd(
    nodesToAdd: GraphNode[],
    edgesToAdd: GraphEdge[],
    patchOps: Array<{ op: 'add' | 'remove'; edge: GraphEdge; prev?: GraphEdge }> = [],
    dirty = false,
  ): AdjacencySyncOutcome {
    const BATCH_SIZE = DATA_CONTROLLER.BATCH_SIZE;
    if (nodesToAdd.length <= BATCH_SIZE) {
      this.cy.batch(() => {
        for (const n of nodesToAdd) this.addNode(n);
        for (const e of edgesToAdd) {
          if (this.addEdge(e)) this.currentEdges.set(e.id, e);
        }
      });
      this.computeNodeWeights();
      return this.reconcileAdjacency(patchOps, dirty);
    }
    const firstBatchNodes = nodesToAdd.slice(0, BATCH_SIZE);
    const firstBatchNodeIds = new Set(firstBatchNodes.map((n) => n.id));
    const firstBatchEdges = edgesToAdd.filter((e) => firstBatchNodeIds.has(e.source) && firstBatchNodeIds.has(e.target));
    const firstBatchEdgeIds = new Set(firstBatchEdges.map((e) => e.id));
    const remainingNodes = nodesToAdd.slice(BATCH_SIZE);
    const remainingEdges = edgesToAdd.filter((e) => !firstBatchEdgeIds.has(e.id));

    this.cy.batch(() => {
      for (const n of firstBatchNodes) this.addNode(n);
      for (const e of firstBatchEdges) {
        if (this.addEdge(e)) this.currentEdges.set(e.id, e);
      }
    });

    // 分批异步追加：剩余批次在 RAF 里逐批入图，邻接缓存此刻无法逐边追踪
    // ——降级为 dirty（安全方向：多一次全量重建，绝不持有漂移内容）。
    this.batchQueue = { nodes: remainingNodes, edges: remainingEdges };
    this.processBatchQueue();
    return DIRTY;
  }

  /**
   * 把并网账本回放到 AdjacencyCache（cycle-126 · T1）。
   *
   * 顺序敏感：同一 id 的「换端点」会先 remove 旧端点再 add 新端点，必须按入账
   * 顺序执行（remove(旧)→add(新)），否则 add 先写、remove 后删会把新边从缓存
   * 里删掉（同 id 键冲突）。
   * 任何一步与预期不符（返回 false / 抛错）⇒ 整体 invalidate，回到安全方向。
   */
  private reconcileAdjacency(
    patchOps: Array<{ op: 'add' | 'remove'; edge: GraphEdge; prev?: GraphEdge }>,
    dirty: boolean,
  ): AdjacencySyncOutcome {
    const cache = this.adjacencyCache;
    if (dirty || !cache) return DIRTY;
    if (patchOps.length === 0) {
      // 无可入账的结构性边变化：缓存内容仍与图本体一致。
      return { kind: 'patch', expectedVersion: cache.getVersion() };
    }
    try {
      for (const op of patchOps) {
        if (op.op === 'add') {
          cache.addEdge(op.edge.source, op.edge.target, op.edge.id, op.edge.type);
        } else {
          const removed = cache.removeEdge(op.edge.source, op.edge.target, op.edge.id, op.edge.type);
          if (!removed) throw new Error(`adjacency removeEdge missed: ${op.edge.id}`);
        }
      }
      return { kind: 'patch', expectedVersion: cache.getVersion() };
    } catch (err) {
      log.warn('adjacency reconcile failed — invalidating cache', { err: String(err) });
      cache.invalidate();
      return DIRTY;
    }
  }

  private detectPropertyChanges(nodes: GraphNode[]): boolean {
    const criticalKeys = new Set(['diagramType', 'depth', 'isRoot', 'isEntry', 'isPackage', 'umlLabel']);
    for (const n of nodes) {
      const existing = this.currentNodes.get(n.id);
      if (!existing) continue;
      if (n.label !== existing.label) return true;
      if (n.type !== existing.type) return true;
      const oldProps = existing.properties ?? {};
      const newProps = n.properties ?? {};
      for (const key of criticalKeys) {
        if (oldProps[key] !== newProps[key]) return true;
      }
    }
    return false;
  }

  private applyIncrementalUpdates(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.cy.batch(() => {
      for (const n of nodes) {
        this.updateNodeData(n);
        this.currentNodes.set(n.id, n);
      }
      for (const e of edges) {
        const cyEdge = this.cy.getElementById(e.id);
        if (cyEdge.length > 0 && e.properties) {
          for (const [key, value] of Object.entries(e.properties)) {
            cyEdge.data(key, value);
          }
        }
        this.currentEdges.set(e.id, e);
      }
    });
  }

  private updateNodeData(n: GraphNode): void {
    const cyNode = this.cy.getElementById(n.id);
    if (cyNode.length === 0) return;
    if (n.properties) {
      for (const [key, value] of Object.entries(n.properties)) {
        cyNode.data(key, value);
      }
    }
  }

  private addNode(n: GraphNode): void {
    const existing = this.cy.getElementById(n.id);
    if (existing.length > 0) {
      existing.remove();
    }
    const isCluster = 'isCluster' in n && n.isCluster === true;
    const data: NodeDataDefinition = {
      id: n.id, label: n.label, type: n.type,
      filePath: n.filePath, lineNumber: n.lineNumber,
      parent: n.parentId as string | undefined,
      isCluster,
      childCount: isCluster ? (n as ClusterNode).childCount : 0,
      layer: n.layer ?? 'core',
    } as NodeDataDefinition;
    if (n.properties) {
      for (const [key, value] of Object.entries(n.properties)) {
        (data as Record<string, unknown>)[key] = value;
      }
    }
    this.cy.add({ group: 'nodes', data });
  }

  private addEdge(e: GraphEdge): boolean {
    if (this.cy.getElementById(e.source).empty() || this.cy.getElementById(e.target).empty()) {
      log.warn('edge dropped: missing endpoint', { edgeId: e.id, source: e.source, target: e.target });
      return false;
    }
    const existing = this.cy.getElementById(e.id);
    if (existing.length > 0) {
      existing.remove();
    }
    const isCluster = 'isCluster' in e && e.isCluster === true;
    const ce = isCluster ? (e as ClusterEdge) : null;
    const data: Record<string, unknown> = {
      id: e.id, source: e.source, target: e.target, type: e.type,
      isCluster,
      aggregatedCount: ce?.aggregatedCount ?? 0,
      label: isCluster ? `${ce?.aggregatedCount ?? 0} deps` : '',
    };
    if (e.properties) {
      for (const [key, value] of Object.entries(e.properties)) {
        data[key] = value;
      }
    }
    this.cy.add({ group: 'edges', data });
    return true;
  }

  private processBatchQueue(): void {
    if (!this.batchQueue) return;
    if (this.batchRaf !== null) cancelAnimationFrame(this.batchRaf);

    this.batchRaf = requestAnimationFrame(() => {
      if (this.destroyed) { this.batchRaf = null; return; }
      if (!this.batchQueue) { this.batchRaf = null; return; }
      const { nodes, edges } = this.batchQueue;
      const BATCH_SIZE = DATA_CONTROLLER.BATCH_SIZE;
      const batchNodes = nodes.slice(0, BATCH_SIZE);
      const batchNodeIds = new Set(batchNodes.map((n) => n.id));
      const batchEdges = edges.filter((e) => batchNodeIds.has(e.source) && batchNodeIds.has(e.target));
      const batchEdgeIds = new Set(batchEdges.map((e) => e.id));
      const leftoverNodes = nodes.slice(BATCH_SIZE);
      const leftoverEdges = edges.filter((e) => !batchEdgeIds.has(e.id));

      this.cy.batch(() => {
        for (const n of batchNodes) this.addNode(n);
        for (const e of batchEdges) {
          if (this.addEdge(e)) this.currentEdges.set(e.id, e);
        }
      });

      if (leftoverNodes.length > 0) {
        this.batchQueue = { nodes: leftoverNodes, edges: leftoverEdges };
        this.processBatchQueue();
      } else {
        this.batchQueue = null;
      }
      this.computeNodeWeights();
      this.batchRaf = null;
    });
  }

  private nodeFromCy(nodeId: string): GraphNode | ClusterNode | null {
    if (!this.cy) return null;
    const cyNode = this.cy.getElementById(nodeId);
    if (cyNode.length === 0) return null;
    const data = cyNode.data();
    if (!data) return null;
    const isCluster = safeBoolean(data.isCluster);
    const baseProps: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      if (!['id', 'label', 'type', 'filePath', 'lineNumber', 'parent', 'isCluster', 'childCount'].includes(key)) {
        baseProps[key] = data[key];
      }
    }
    if (isCluster) {
      return {
        id: NodeId(safeString(data.id)),
        label: safeString(data.label, safeString(data.id)),
        type: 'module',
        filePath: safeString(data.filePath),
        lineNumber: 0,
        properties: baseProps,
        isCluster: true,
        childCount: safeNumber(data.childCount),
        childIds: [],
        clusterPath: safeString(data.filePath),
        clusterLevel: 'directory',
      };
    }
    const node: GraphNode = {
      id: NodeId(safeString(data.id)),
      label: safeString(data.label, safeString(data.id)),
      type: isNodeType(data.type) ? data.type : 'module',
      filePath: safeString(data.filePath),
      lineNumber: safeNumber(data.lineNumber),
      properties: baseProps,
    };
    if (data.parent) node.parentId = NodeId(safeString(data.parent));
    return node;
  }

  getSelectedNodeData(): GraphNode | ClusterNode | null {
    const selected = this.cy.nodes('.selected');
    if (selected.length === 0) return null;
    const id = selected.first().id();
    return this.currentNodes.get(id) ?? this.nodeFromCy(id);
  }

  getNodeData(nodeId: string): GraphNode | ClusterNode | null {
    if (this.destroyed) return null;
    return this.currentNodes.get(nodeId) ?? this.nodeFromCy(nodeId);
  }

  getEdgeData(edgeId: string): GraphEdge | null {
    if (this.destroyed) return null;
    return this.currentEdges.get(edgeId) ?? null;
  }

  private computeNodeWeights(): void {
    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const isCluster = node.data('isCluster') === true;
        if (isCluster) {
          const clusterPath = (node.data('clusterPath') as string) ?? node.id();
          let hash = 0;
          for (let i = 0; i < clusterPath.length; i++) {
            hash = ((hash << 5) - hash + clusterPath.charCodeAt(i)) | 0;
          }
          node.data('clusterHue', Math.abs(hash) % 12);
          return;
        }
        const inDegree = node.indegree(false);
        const outDegree = node.outdegree(false);
        const totalConnections = inDegree + outDegree;
        if (totalConnections > 0) {
          node.data('weight', Math.min(totalConnections, DATA_CONTROLLER.MAX_WEIGHT));
          const instability = outDegree / totalConnections;
          node.data('instability', instability);
        } else {
          node.removeData('weight');
          node.removeData('instability');
        }

        if (inDegree === 0 && outDegree === 0) {
          node.data('nodeRole', 'orphan');
        } else if (inDegree === 0 && outDegree > 0) {
          node.data('nodeRole', 'entry');
        } else if (inDegree > 0 && outDegree === 0) {
          node.data('nodeRole', 'leaf');
        } else if (inDegree >= DATA_CONTROLLER.HUB_DEGREE_THRESHOLD || outDegree >= DATA_CONTROLLER.HUB_DEGREE_THRESHOLD) {
          node.data('nodeRole', 'hub');
        } else {
          node.removeData('nodeRole');
        }
      });
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.batchRaf !== null) cancelAnimationFrame(this.batchRaf);
    this.batchRaf = null;
    this.batchQueue = null;
    this.currentNodes.clear();
    this.currentEdges.clear();
    this.rawNodesMap.clear();
    this.rawToVisibleMap.clear();
    this.lastAddedNodeIds.clear();

  }
}
