import type { Core, NodeDataDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/graphStore.ts';

export class DataController {
  private cy: Core;
  private currentNodes: Map<string, GraphNode> = new Map();
  private currentEdges: Map<string, GraphEdge> = new Map();
  private batchRaf: number | null = null;
  private batchQueue: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;

  constructor(cy: Core) {
    this.cy = cy;
  }

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    const newNodeIds = new Set<string>(nodes.map((n) => n.id));
    const newEdgeIds = new Set<string>(edges.map((e) => e.id));

    const hasNewNodes = nodes.some((n) => !this.currentNodes.has(n.id));
    const hasStaleNodes = this.currentNodes.size !== nodes.length ||
      [...this.currentNodes.keys()].some((id) => !newNodeIds.has(id));
    const hasNewEdges = edges.some((e) => !this.currentEdges.has(e.id));
    const hasStaleEdges = this.currentEdges.size !== edges.length ||
      [...this.currentEdges.keys()].some((id) => !newEdgeIds.has(id));

    if (!hasNewNodes && !hasStaleNodes && !hasNewEdges && !hasStaleEdges) return;

    const nodesToAdd: GraphNode[] = [];
    const edgesToAdd: GraphEdge[] = [];

    if (hasStaleNodes) {
      const staleNodes = this.cy.nodes().filter((n) => !newNodeIds.has(n.id()));
      if (staleNodes.length > 0) this.cy.remove(staleNodes);
      for (const id of this.currentNodes.keys()) {
        if (!newNodeIds.has(id)) this.currentNodes.delete(id);
      }
    }
    if (hasStaleEdges) {
      const staleEdges = this.cy.edges().filter((e) => !newEdgeIds.has(e.id()));
      if (staleEdges.length > 0) this.cy.remove(staleEdges);
      for (const id of this.currentEdges.keys()) {
        if (!newEdgeIds.has(id)) this.currentEdges.delete(id);
      }
    }

    for (const n of nodes) {
      if (!this.currentNodes.has(n.id)) nodesToAdd.push(n);
      this.currentNodes.set(n.id, n);
    }
    for (const e of edges) {
      if (!this.currentEdges.has(e.id)) edgesToAdd.push(e);
      this.currentEdges.set(e.id, e);
    }

    if (nodesToAdd.length === 0 && edgesToAdd.length === 0) return;

    const BATCH_SIZE = 200;
    if (nodesToAdd.length <= BATCH_SIZE) {
      this.cy.batch(() => {
        for (const n of nodesToAdd) this.addNode(n);
        for (const e of edgesToAdd) this.addEdge(e);
      });
      return;
    }

    const firstBatchNodes = nodesToAdd.slice(0, BATCH_SIZE);
    const firstBatchNodeIds = new Set(firstBatchNodes.map((n) => n.id));
    const firstBatchEdges = edgesToAdd.filter((e) => firstBatchNodeIds.has(e.source) && firstBatchNodeIds.has(e.target));
    const remainingNodes = nodesToAdd.slice(BATCH_SIZE);
    const remainingEdges = edgesToAdd.filter((e) => !firstBatchEdges.includes(e));

    this.cy.batch(() => {
      for (const n of firstBatchNodes) this.addNode(n);
      for (const e of firstBatchEdges) this.addEdge(e);
    });

    this.batchQueue = { nodes: remainingNodes, edges: remainingEdges };
    this.processBatchQueue();
  }

  private addNode(n: GraphNode): void {
    const cn = n as ClusterNode;
    this.cy.add({
      group: 'nodes',
      data: {
        id: n.id, label: n.label, type: n.type,
        filePath: n.filePath, lineNumber: n.lineNumber,
        parent: n.parentId ?? undefined,
        isCluster: cn.isCluster ?? false,
        childCount: cn.childCount ?? 0,
      } as NodeDataDefinition,
    });
  }

  private addEdge(e: GraphEdge): void {
    const ce = e as ClusterEdge;
    this.cy.add({
      group: 'edges',
      data: {
        id: e.id, source: e.source, target: e.target, type: e.type,
        isCluster: ce.isCluster ?? false,
        aggregatedCount: ce.aggregatedCount ?? 0,
        label: ce.isCluster ? `${ce.aggregatedCount} deps` : '',
      },
    });
  }

  private processBatchQueue(): void {
    if (!this.batchQueue) return;
    if (this.batchRaf !== null) cancelAnimationFrame(this.batchRaf);

    this.batchRaf = requestAnimationFrame(() => {
      if (!this.batchQueue) { this.batchRaf = null; return; }
      const { nodes, edges } = this.batchQueue;
      const BATCH_SIZE = 200;
      const batchNodes = nodes.slice(0, BATCH_SIZE);
      const batchNodeIds = new Set(batchNodes.map((n) => n.id));
      const batchEdges = edges.filter((e) => batchNodeIds.has(e.source) && batchNodeIds.has(e.target));
      const leftoverNodes = nodes.slice(BATCH_SIZE);
      const leftoverEdges = edges.filter((e) => !batchEdges.includes(e));

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
      this.batchRaf = null;
    });
  }

  filterByType(type: string): void {
    const hidden = new Set<string>();
    if (type !== 'all') {
      this.cy.nodes().forEach((node) => {
        if (node.data('type') !== type) hidden.add(node.id());
      });
    }
    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        node.style('display', hidden.has(node.id()) ? 'none' : 'element');
      });
      this.cy.edges().forEach((edge) => {
        const hiddenEdge = hidden.has(edge.source().id()) || hidden.has(edge.target().id());
        edge.style('display', hiddenEdge ? 'none' : 'element');
      });
    });
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    const allowedEdgeTypes = new Set<string>();
    if (graphType === 'all') {
      allowedEdgeTypes.add('call'); allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('extend'); allowedEdgeTypes.add('implement');
      allowedEdgeTypes.add('dependency');
    } else if (graphType === 'call') {
      allowedEdgeTypes.add('call');
    } else if (graphType === 'dependency') {
      allowedEdgeTypes.add('import'); allowedEdgeTypes.add('dependency');
    }

    const connectedNodeIds = new Set<string>();
    this.cy.batch(() => {
      this.cy.edges().forEach((edge) => {
        const edgeType = edge.data('type') as string;
        const visible = allowedEdgeTypes.has(edgeType);
        edge.style('display', visible ? 'element' : 'none');
        if (visible) {
          connectedNodeIds.add(edge.source().id());
          connectedNodeIds.add(edge.target().id());
        }
      });
      this.cy.nodes().forEach((node) => {
        node.style('display', connectedNodeIds.has(node.id()) ? 'element' : 'none');
      });
    });
  }

  search(query: string): number {
    if (!query) {
      this.cy.nodes().removeClass('search-match');
      return 0;
    }
    const q = query.toLowerCase();
    let matches = 0;
    let firstMatchId: string | null = null;
    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const label = node.data('label');
        const isMatch = typeof label === 'string' && label.toLowerCase().includes(q);
        node.toggleClass('search-match', isMatch);
        if (isMatch) {
          matches++;
          if (firstMatchId === null) firstMatchId = node.id();
        }
      });
    });
    return matches;
  }

  getSelectedNodeData(): GraphNode | null {
    const selected = this.cy.nodes('.selected');
    if (selected.length === 0) return null;
    const id = selected.first().id();
    return this.currentNodes.get(id) ?? null;
  }

  getNodeData(nodeId: string): GraphNode | null {
    return this.currentNodes.get(nodeId) ?? null;
  }

  getEdgeData(edgeId: string): GraphEdge | null {
    return this.currentEdges.get(edgeId) ?? null;
  }

  exportJSON(): string {
    return JSON.stringify(this.cy.json(), null, 2);
  }

  exportPNG(): string | null {
    return this.cy.png({ full: true, scale: 2 });
  }

  exportSVG(): string | null {
    const png = this.cy.png({ full: true, scale: 2 });
    const w = this.cy.width();
    const h = this.cy.height();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${png}" width="${w}" height="${h}"/></svg>`;
  }

  destroy(): void {
    if (this.batchRaf !== null) cancelAnimationFrame(this.batchRaf);
    this.batchRaf = null;
    this.batchQueue = null;
    this.currentNodes.clear();
    this.currentEdges.clear();
  }
}