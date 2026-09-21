import type { Core, NodeDataDefinition } from 'cytoscape';
import { NodeId, safeString, safeNumber, safeBoolean, isNodeType, type GraphNode, type GraphEdge } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/cluster/index.ts';
import { DATA_CONTROLLER } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('data-controller');

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

  constructor(cy: Core) {
    this.cy = cy;
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

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.buildRawToVisibleMap(nodes);
    const changes = this.detectChanges(nodes, edges);
    if (!changes.hasNewNodes && !changes.hasStaleNodes && !changes.hasNewEdges && !changes.hasStaleEdges) {
      const hasUpdatedNodes = this.detectPropertyChanges(nodes);
      if (!hasUpdatedNodes) return;
      this.applyIncrementalUpdates(nodes, edges);
      this.computeNodeWeights();
      return;
    }
    if (changes.hasStaleNodes) {
      this.handleFullReset(nodes, edges);
      return;
    }
    this.handleIncrementalUpdate(nodes, edges, changes);
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
    const hasNewEdges = edges.some((e) => !this.currentEdges.has(e.id));
    let hasStaleEdges = cyEdgeCount !== edges.length || this.currentEdges.size > newEdgeIds.size;
    if (!hasStaleEdges && this.currentEdges.size === newEdgeIds.size) {
      for (const id of this.currentEdges.keys()) {
        if (!newEdgeIds.has(id)) { hasStaleEdges = true; break; }
      }
    }
    return { hasNewNodes, hasStaleNodes, hasNewEdges, hasStaleEdges };
  }

  private handleFullReset(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.cy.elements().remove();
    this.currentNodes.clear();
    this.currentEdges.clear();
    this.lastAddedNodeIds.clear();
    this.cy.batch(() => {
      for (const n of nodes) {
        this.addNode(n);
        this.currentNodes.set(n.id, n);
        this.lastAddedNodeIds.add(n.id);
      }
      for (const e of edges) {
        this.addEdge(e);
        this.currentEdges.set(e.id, e);
      }
    });
    this.computeNodeWeights();
  }

  private handleIncrementalUpdate(
    nodes: GraphNode[], edges: GraphEdge[],
    changes: { hasNewNodes: boolean; hasStaleNodes: boolean; hasNewEdges: boolean; hasStaleEdges: boolean },
  ): void {
    const newNodeIds = new Set<string>(nodes.map((n) => n.id));
    const newEdgeIds = new Set<string>(edges.map((e) => e.id));
    const nodesToAdd: GraphNode[] = [];
    const edgesToAdd: GraphEdge[] = [];

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
        if (!newEdgeIds.has(id)) this.currentEdges.delete(id);
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
      if (!this.currentEdges.has(e.id)) edgesToAdd.push(e);
      else {
        const existing = this.currentEdges.get(e.id);
        const cyEdge = this.cy.getElementById(e.id);
        if (cyEdge.length > 0 && existing && (existing.source !== e.source || existing.target !== e.target)) {
          this.cy.remove(cyEdge);
          edgesToAdd.push(e);
        } else if (cyEdge.length > 0 && e.properties) {
          for (const [key, value] of Object.entries(e.properties)) {
            cyEdge.data(key, value);
          }
        }
      }
      this.currentEdges.set(e.id, e);
    }

    if (nodesToAdd.length === 0 && edgesToAdd.length === 0) {
      this.computeNodeWeights();
      return;
    }
    this.processBatchAdd(nodesToAdd, edgesToAdd);
  }

  private processBatchAdd(nodesToAdd: GraphNode[], edgesToAdd: GraphEdge[]): void {
    const BATCH_SIZE = DATA_CONTROLLER.BATCH_SIZE;
    if (nodesToAdd.length <= BATCH_SIZE) {
      this.cy.batch(() => {
        for (const n of nodesToAdd) this.addNode(n);
        for (const e of edgesToAdd) this.addEdge(e);
      });
      this.computeNodeWeights();
      return;
    }
    const firstBatchNodes = nodesToAdd.slice(0, BATCH_SIZE);
    const firstBatchNodeIds = new Set(firstBatchNodes.map((n) => n.id));
    const firstBatchEdges = edgesToAdd.filter((e) => firstBatchNodeIds.has(e.source) && firstBatchNodeIds.has(e.target));
    const firstBatchEdgeIds = new Set(firstBatchEdges.map((e) => e.id));
    const remainingNodes = nodesToAdd.slice(BATCH_SIZE);
    const remainingEdges = edgesToAdd.filter((e) => !firstBatchEdgeIds.has(e.id));

    this.cy.batch(() => {
      for (const n of firstBatchNodes) this.addNode(n);
      for (const e of firstBatchEdges) this.addEdge(e);
    });

    this.batchQueue = { nodes: remainingNodes, edges: remainingEdges };
    this.processBatchQueue();
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
    } as NodeDataDefinition;
    if (n.properties) {
      for (const [key, value] of Object.entries(n.properties)) {
        (data as Record<string, unknown>)[key] = value;
      }
    }
    this.cy.add({ group: 'nodes', data });
  }

  private addEdge(e: GraphEdge): void {
    if (this.cy.getElementById(e.source).empty() || this.cy.getElementById(e.target).empty()) {
      log.warn('edge dropped: missing endpoint', { edgeId: e.id, source: e.source, target: e.target });
      return;
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
  }

  private processBatchQueue(): void {
    if (!this.batchQueue) return;
    if (this.batchRaf !== null) cancelAnimationFrame(this.batchRaf);

    this.batchRaf = requestAnimationFrame(() => {
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
        for (const e of batchEdges) this.addEdge(e);
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
          node.data('weight', Math.min(totalConnections, 10));
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
        } else if (inDegree >= 5 || outDegree >= 5) {
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
