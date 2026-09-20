import type { Core, NodeDataDefinition } from 'cytoscape';
import { NodeId, safeString, safeNumber, safeBoolean, isNodeType, type GraphNode, type GraphEdge } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/cluster/index.ts';
import { getThemeColors } from './styles/ThemeStylesheet.ts';
import type { ThemeType } from './IRenderer.ts';
import { DATA_CONTROLLER } from '../../shared/constants.ts';
import { parseSearchQuery, matchSearchQuery } from '../../shared/searchUtils.ts';
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

  setRawNodes(rawNodes: GraphNode[]): void {
    this.rawNodesMap.clear();
    for (const n of rawNodes) this.rawNodesMap.set(n.id, n);
  }

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    const newNodeIds = new Set<string>(nodes.map((n) => n.id));
    const newEdgeIds = new Set<string>(edges.map((e) => e.id));

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

    if (!hasNewNodes && !hasStaleNodes && !hasNewEdges && !hasStaleEdges) {
      const hasUpdatedNodes = this.detectPropertyChanges(nodes);
      if (!hasUpdatedNodes) return;
      this.applyIncrementalUpdates(nodes, edges);
      this.computeNodeWeights();
      return;
    }

    const needsFullReset = hasStaleNodes;

    if (needsFullReset) {
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
      return;
    }

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

  filterByType(type: string): void {
    const hidden = new Set<string>();
    if (type !== 'all') {
      this.cy.nodes().forEach((node) => {
        const isCluster = node.data('isCluster') === true;
        if (!isCluster && node.data('type') !== type) hidden.add(node.id());
      });
    }
    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const isFiltered = hidden.has(node.id());
        node.data('typeFiltered', isFiltered);
        const connectionFiltered = node.data('connectionFiltered') === true;
        node.style('display', (isFiltered || connectionFiltered) ? 'none' : 'element');
      });
      this.cy.edges().forEach((edge) => {
        const hiddenEdge = hidden.has(edge.source().id()) || hidden.has(edge.target().id());
        edge.data('typeFiltered', hiddenEdge);
        const connectionFiltered = edge.data('connectionFiltered') === true;
        edge.style('display', (hiddenEdge || connectionFiltered) ? 'none' : 'element');
      });
    });
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    const allowedEdgeTypes = new Set<string>();
    if (graphType === 'all') {
      allowedEdgeTypes.add('call'); allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('extend'); allowedEdgeTypes.add('implement');
      allowedEdgeTypes.add('dependency'); allowedEdgeTypes.add('contains');
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
        edge.data('typeFiltered', !visible);
        const connectionFiltered = edge.data('connectionFiltered') === true;
        edge.style('display', (!visible || connectionFiltered) ? 'none' : 'element');
        if (visible) {
          connectedNodeIds.add(edge.source().id());
          connectedNodeIds.add(edge.target().id());
        }
      });
      this.cy.nodes().forEach((node) => {
        const isFiltered = !connectedNodeIds.has(node.id());
        node.data('typeFiltered', isFiltered);
        const connectionFiltered = node.data('connectionFiltered') === true;
        node.style('display', (isFiltered || connectionFiltered) ? 'none' : 'element');
      });
    });
  }

  applyConnectionFilters(
    fanInThreshold: number,
    fanOutThreshold: number,
    visibleNodeTypes: Set<GraphNode['type']>,
    visibleEdgeTypes: Set<GraphEdge['type']>,
  ): void {
    const fanInCount = new Map<string, number>();
    const fanOutCount = new Map<string, number>();
    this.cy.edges().forEach((edge) => {
      const source = edge.source().id();
      const target = edge.target().id();
      fanOutCount.set(source, (fanOutCount.get(source) ?? 0) + 1);
      fanInCount.set(target, (fanInCount.get(target) ?? 0) + 1);
    });

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const isCluster = node.data('isCluster') === true;
        let hidden = false;

        if (!isCluster && fanInThreshold > 0) {
          const inCount = fanInCount.get(node.id()) ?? 0;
          if (inCount < fanInThreshold) hidden = true;
        }

        if (!isCluster && fanOutThreshold > 0) {
          const outCount = fanOutCount.get(node.id()) ?? 0;
          if (outCount < fanOutThreshold) hidden = true;
        }

        if (!isCluster && visibleNodeTypes.size > 0) {
          const nodeType = node.data('type') as GraphNode['type'];
          if (!visibleNodeTypes.has(nodeType)) hidden = true;
        }

        node.data('connectionFiltered', hidden);
        const typeFiltered = node.data('typeFiltered') === true;
        node.style('display', (hidden || typeFiltered) ? 'none' : 'element');
      });

      this.cy.edges().forEach((edge) => {
        let hidden = false;

        if (visibleEdgeTypes.size > 0) {
          const edgeType = edge.data('type') as GraphEdge['type'];
          if (!visibleEdgeTypes.has(edgeType)) hidden = true;
        }

        const sourceHidden = edge.source().data('connectionFiltered') === true;
        const targetHidden = edge.target().data('connectionFiltered') === true;
        if (sourceHidden || targetHidden) hidden = true;

        edge.data('connectionFiltered', hidden);
        const typeFiltered = edge.data('typeFiltered') === true;
        edge.style('display', (hidden || typeFiltered) ? 'none' : 'element');
      });
    });
  }


  search(query: string): number {
    if (!query) {
      this.cy.nodes().removeClass('search-match');
      return 0;
    }
    const { requiredTerms, optionalTerms, exactPhrase } = parseSearchQuery(query);
    const matcher = (label: string): boolean => matchSearchQuery(label, { requiredTerms, optionalTerms, exactPhrase });

    let matches = 0;
    const matchedCyNodeIds = new Set<string>();

    for (const rawNode of this.rawNodesMap.values()) {
      if (matcher(rawNode.label)) {
        matches++;
        const visibleId = this.rawToVisibleMap.get(rawNode.id);
        if (visibleId) {
          const cyNode = this.cy.getElementById(visibleId);
          if (cyNode.length > 0) {
            matchedCyNodeIds.add(visibleId);
            continue;
          }
        }
        let parentId: string | undefined = rawNode.parentId;
        while (parentId) {
          const cyNode = this.cy.getElementById(parentId);
          if (cyNode.length > 0) {
            matchedCyNodeIds.add(parentId);
            break;
          }
          const parentRaw = this.rawNodesMap.get(parentId);
          parentId = parentRaw?.parentId;
        }
      }
    }

    if (matches === 0) {
      this.cy.nodes().forEach((node) => {
        const label = node.data('label');
        if (typeof label === 'string' && matcher(label)) {
          matchedCyNodeIds.add(node.id());
          matches++;
        }
      });
    }

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        node.toggleClass('search-match', matchedCyNodeIds.has(node.id()));
      });
    });
    return matches;
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
    return this.currentNodes.get(nodeId) ?? this.nodeFromCy(nodeId);
  }

  getEdgeData(edgeId: string): GraphEdge | null {
    return this.currentEdges.get(edgeId) ?? null;
  }

  exportJSON(): string {
    return JSON.stringify(this.cy.json(), null, 2);
  }

  exportMermaid(): string {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return 'graph TD\n';

    const nodeShapeMap: Record<string, string> = {
      function: '($label$)',
      class: '[$label$]',
      variable: '(($label$))',
      module: '{$label$}',
      interface: '/$label$/',
    };
    const defaultShape = '[$label$]';

    const edgeLabelMap: Record<string, string> = {
      call: 'call',
      extend: 'extend',
      implement: 'implement',
      import: 'import',
      dependency: 'dependency',
      contains: 'contains',
    };

    const lines: string[] = ['graph TD'];
    const seenIds = new Set<string>();

    nodes.forEach((node) => {
      const id = node.id().replace(/[^a-zA-Z0-9_]/g, '_');
      if (seenIds.has(id)) return;
      seenIds.add(id);
      const label = String(node.data('label') ?? id).replace(/"/g, "'");
      const type = String(node.data('type') ?? '');
      const shape = nodeShapeMap[type] ?? defaultShape;
      const shapeDef = shape.replace('$label$', `"${label}"`);
      lines.push(`  ${id}${shapeDef}`);
    });

    edges.forEach((edge) => {
      const sourceId = edge.source().id().replace(/[^a-zA-Z0-9_]/g, '_');
      const targetId = edge.target().id().replace(/[^a-zA-Z0-9_]/g, '_');
      const edgeType = String(edge.data('type') ?? '');
      const label = edgeLabelMap[edgeType];
      if (label) {
        lines.push(`  ${sourceId} -->|${label}| ${targetId}`);
      } else {
        lines.push(`  ${sourceId} --> ${targetId}`);
      }
    });

    return lines.join('\n') + '\n';
  }

  exportPNG(): string | null {
    return this.cy.png({ full: true, scale: 2 });
  }

  exportSVG(theme: ThemeType = 'dark'): string | null {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return null;

    const colors = getThemeColors(theme);
    const nodeColors: Record<string, string> = {
      function: colors.nodeFunction,
      class: colors.nodeClass,
      variable: colors.nodeVariable,
      module: colors.nodeModule,
      interface: colors.nodeInterface,
      type: colors.nodeDefault,
    };
    const edgeColors: Record<string, string> = {
      call: colors.edgeCall,
      extend: colors.edgeExtend,
      implement: colors.edgeImplement,
      import: colors.edgeImport,
      dependency: colors.edgeDependency,
      contains: colors.edgeContains,
    };

    const bbox = this.cy.elements().boundingBox();
    const w = Math.ceil(bbox.w) + 160;
    const h = Math.ceil(bbox.h) + 160;
    const offsetX = -bbox.x1 + DATA_CONTROLLER.SVG_OFFSET;
    const offsetY = -bbox.y1 + DATA_CONTROLLER.SVG_OFFSET;

    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);

    edges.forEach((edge) => {
      const srcPos = edge.source().position();
      const tgtPos = edge.target().position();
      const edgeType = edge.data('type') as string;
      const color = edgeColors[edgeType] ?? colors.edgeDefault;
      parts.push(`<line x1="${srcPos.x + offsetX}" y1="${srcPos.y + offsetY}" x2="${tgtPos.x + offsetX}" y2="${tgtPos.y + offsetY}" stroke="${color}" stroke-width="1" opacity="0.5"/>`);
    });

    nodes.forEach((node) => {
      const pos = node.position();
      const nodeType = node.data('type') as string;
      const label = node.data('label') as string;
      const color = nodeColors[nodeType] ?? colors.nodeDefault;
      const r = 12;
      parts.push(`<circle cx="${pos.x + offsetX}" cy="${pos.y + offsetY}" r="${r}" fill="${color}" opacity="0.8"/>`);
      parts.push(`<text x="${pos.x + offsetX}" y="${pos.y + offsetY + 4}" font-size="9" text-anchor="middle" fill="${colors.text}">${escapeXml(label)}</text>`);
    });

    parts.push('</svg>');
    return parts.join('');
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
    this.cy = null as unknown as Core;
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}