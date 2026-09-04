import cytoscape, { type Core, type LayoutOptions, type NodeDataDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/graphStore.ts';
import type { IRenderer, LayoutType, ThemeType } from './IRenderer.ts';

cytoscape.use(dagre);


export interface CytoscapeRendererOptions {
  container: HTMLElement;
  theme: ThemeType;
  onNodeTap?: (nodeId: string) => void;
  onEdgeTap?: (edgeId: string) => void;
  onNodeDoubleTap?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string, renderedPosition: { x: number; y: number }) => void;
  onNodeHoverOut?: () => void;
}

interface ThemeColors {
  nodeDefault: string;
  nodeFunction: string;
  nodeClass: string;
  nodeVariable: string;
  nodeModule: string;
  nodeInterface: string;
  edgeDefault: string;
  edgeCall: string;
  edgeImport: string;
  edgeExtend: string;
  text: string;
  border: string;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function getThemeColors(theme: ThemeType): ThemeColors {
  const isDark = theme === 'dark';
  return {
    nodeDefault: readCssVar('--cg-accent', isDark ? '#6366f1' : '#263148'),
    nodeFunction: readCssVar('--cg-success', isDark ? '#10b981' : '#059669'),
    nodeClass: readCssVar('--cg-accent-hover', isDark ? '#818cf8' : '#1a2230'),
    nodeVariable: readCssVar('--cg-warning', isDark ? '#f59e0b' : '#d97706'),
    nodeModule: isDark ? '#ec4899' : '#db2777',
    nodeInterface: isDark ? '#14b8a6' : '#0d9488',
    edgeDefault: readCssVar('--cg-border-strong', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
    edgeCall: isDark ? '#60a5fa' : '#3b82f6',
    edgeImport: isDark ? '#34d399' : '#10b981',
    edgeExtend: isDark ? '#f472b6' : '#ec4899',
    text: readCssVar('--cg-text', isDark ? '#f9fafb' : '#0f1115'),
    border: readCssVar('--cg-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'),
  };
}

export class CytoscapeRenderer implements IRenderer {
  private cy: Core | null = null;
  private options: CytoscapeRendererOptions;
  private currentNodes: Map<string, GraphNode> = new Map();
  private currentEdges: Map<string, GraphEdge> = new Map();
  private layoutRaf: number | null = null;

  constructor(options: CytoscapeRendererOptions) {
    this.options = options;
  }

  init(): void {
    if (this.cy) return;

    this.cy = cytoscape({
      container: this.options.container,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
      style: this.getStylesheet(),
      layout: { name: 'cose' },
      headless: false,
    });

    this.cy.on('tap', 'node', (evt) => {
      this.options.onNodeTap?.(evt.target.id());
    });

    this.cy.on('tap', 'edge', (evt) => {
      this.options.onEdgeTap?.(evt.target.id());
    });

    this.cy.on('dbltap', 'node', (evt) => {
      this.options.onNodeDoubleTap?.(evt.target.id());
    });

    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const pos = node.renderedPosition();
      this.options.onNodeHover?.(node.id(), { x: pos.x, y: pos.y });
    });

    this.cy.on('mouseout', 'node', () => {
      this.options.onNodeHoverOut?.();
    });
  }

  private batchRaf: number | null = null;
  private batchQueue: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.cy) return;

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
        for (const n of nodesToAdd) {
          const cn = n as ClusterNode;
          this.cy!.add({
            group: 'nodes',
            data: {
              id: n.id,
              label: n.label,
              type: n.type,
              filePath: n.filePath,
              lineNumber: n.lineNumber,
              parent: n.parentId ?? undefined,
              isCluster: cn.isCluster ?? false,
              childCount: cn.childCount ?? 0,
            } as NodeDataDefinition,
          });
        }
        for (const e of edgesToAdd) {
          const ce = e as ClusterEdge;
          this.cy!.add({
            group: 'edges',
            data: {
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type,
              isCluster: ce.isCluster ?? false,
              aggregatedCount: ce.aggregatedCount ?? 0,
              label: ce.isCluster ? `${ce.aggregatedCount} deps` : '',
            },
          });
        }
      });
      return;
    }

    const firstBatchNodes = nodesToAdd.slice(0, BATCH_SIZE);
    const firstBatchNodeIds = new Set(firstBatchNodes.map((n) => n.id));
    const firstBatchEdges = edgesToAdd.filter((e) => firstBatchNodeIds.has(e.source) && firstBatchNodeIds.has(e.target));
    const remainingNodes = nodesToAdd.slice(BATCH_SIZE);
    const remainingEdges = edgesToAdd.filter((e) => !firstBatchEdges.includes(e));

    this.cy.batch(() => {
      for (const n of firstBatchNodes) {
        const cn = n as ClusterNode;
        this.cy!.add({
          group: 'nodes',
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            filePath: n.filePath,
            lineNumber: n.lineNumber,
            parent: n.parentId ?? undefined,
            isCluster: cn.isCluster ?? false,
            childCount: cn.childCount ?? 0,
          } as NodeDataDefinition,
        });
      }
      for (const e of firstBatchEdges) {
        const ce = e as ClusterEdge;
        this.cy!.add({
          group: 'edges',
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
            isCluster: ce.isCluster ?? false,
            label: ce.isCluster ? `${ce.aggregatedCount} deps` : '',
          },
        });
      }
    });

    this.batchQueue = { nodes: remainingNodes, edges: remainingEdges };
    this.processBatchQueue();
  }

  private processBatchQueue(): void {
    if (!this.batchQueue || !this.cy) return;
    if (this.batchRaf !== null) cancelAnimationFrame(this.batchRaf);

    this.batchRaf = requestAnimationFrame(() => {
      if (!this.batchQueue || !this.cy) { this.batchRaf = null; return; }
      const { nodes, edges } = this.batchQueue;
      const BATCH_SIZE = 200;
      const batchNodes = nodes.slice(0, BATCH_SIZE);
      const batchNodeIds = new Set(batchNodes.map((n) => n.id));
      const batchEdges = edges.filter((e) => batchNodeIds.has(e.source) && batchNodeIds.has(e.target));
      const leftoverNodes = nodes.slice(BATCH_SIZE);
      const leftoverEdges = edges.filter((e) => !batchEdges.includes(e));

      this.cy.batch(() => {
        for (const n of batchNodes) {
          const cn = n as ClusterNode;
          this.cy!.add({
            group: 'nodes',
            data: {
              id: n.id,
              label: n.label,
              type: n.type,
              filePath: n.filePath,
              lineNumber: n.lineNumber,
              parent: n.parentId ?? undefined,
              isCluster: cn.isCluster ?? false,
              childCount: cn.childCount ?? 0,
            } as NodeDataDefinition,
          });
        }
        for (const e of batchEdges) {
          const ce = e as ClusterEdge;
          this.cy!.add({
            group: 'edges',
            data: {
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type,
              isCluster: ce.isCluster ?? false,
              aggregatedCount: ce.aggregatedCount ?? 0,
              label: ce.isCluster ? `${ce.aggregatedCount} deps` : '',
            },
          });
        }
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

  applyLayout(layout: LayoutType): void {
    if (!this.cy) return;

    if (this.layoutRaf !== null) {
      cancelAnimationFrame(this.layoutRaf);
    }

    this.layoutRaf = requestAnimationFrame(() => {
      const nodeCount = this.cy!.nodes().length;
      let effectiveLayout = layout;
      let animate = true;

      if (nodeCount > 2000) {
        effectiveLayout = 'grid';
        animate = false;
      } else if (nodeCount > 500 && layout === 'cose') {
        effectiveLayout = 'dagre';
        animate = false;
      }

      const nodes = this.cy!.nodes();
      let hasPositions = true;
      nodes.forEach((n) => {
        const p = n.position();
        if (p.x == null || p.y == null || Number.isNaN(p.x) || Number.isNaN(p.y)) {
          hasPositions = false;
        }
      });

      let options: LayoutOptions | undefined;
      switch (effectiveLayout) {
        case 'cose':
          options = {
            name: 'cose',
            fit: true,
            animate: false,
            nodeRepulse: () => 120000,
            idealEdgeLength: () => 400,
            edgeElasticity: () => 0.05,
            gravity: 0.02,
            numIter: 15000,
            randomize: true,
            tile: true,
            padding: 120,
            avoidOverlap: true,
          } as LayoutOptions;
          break;
        case 'dagre':
          options = {
            name: 'dagre',
            fit: true,
            animate,
            rankDir: 'TB',
            rankSep: 300,
            edgeSep: 120,
            nodeSep: 250,
            ranker: 'tight-tree',
            padding: 100,
          } as LayoutOptions;
          break;
        case 'circle':
          options = {
            name: 'circle',
            fit: true,
            animate,
            padding: 80,
            radius: () => Math.min(this.cy!.width(), this.cy!.height()) / 2 - 120,
          } as LayoutOptions;
          break;
        case 'grid':
          options = {
            name: 'grid',
            fit: true,
            animate: false,
            padding: 80,
            avoidOverlap: true,
            rows: Math.ceil(Math.sqrt(nodeCount)),
            cols: Math.ceil(Math.sqrt(nodeCount)),
          } as LayoutOptions;
          break;
        default: {
          const _exhaustive: never = effectiveLayout;
          throw new Error(`Unhandled layout: ${_exhaustive}`);
        }
      }
      if (options) {
        const layout = this.cy!.layout(options);
        layout.one('layoutstop', () => {
          this.removeOverlaps();
        });
        layout.run();
      }
      this.layoutRaf = null;
    });
  }

  private removeOverlaps(): void {
    if (!this.cy) return;
    const nodes = this.cy.nodes();
    if (nodes.length === 0) return;

    const minGap = 40;
    let iterations = 0;
    const maxIterations = 50;

    const bbox = this.cy!.nodes().boundingBox();
    const cx = (bbox.x1 + bbox.x2) / 2;
    const cy = (bbox.y1 + bbox.y2) / 2;
    const scaleFactor = 1.4;
    this.cy!.batch(() => {
      nodes.forEach((n) => {
        const p = n.position();
        n.position({
          x: cx + (p.x - cx) * scaleFactor,
          y: cy + (p.y - cy) * scaleFactor,
        });
      });
    });

    while (iterations < maxIterations) {
      iterations++;
      let overlapCount = 0;
      const positions: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
      nodes.forEach((n) => {
        const p = n.position();
        positions.push({ id: n.id(), x: p.x, y: p.y, w: n.width(), h: n.height() });
      });

      const displacements = new Map<string, { dx: number; dy: number }>();
      for (const p of positions) displacements.set(p.id, { dx: 0, dy: 0 });

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const a = positions[i]!;
          const b = positions[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDx = (a.w + b.w) / 2 + minGap;
          const minDy = (a.h + b.h) / 2 + minGap;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          if (absDx < minDx && absDy < minDy) {
            overlapCount++;
            const overlapX = minDx - absDx;
            const overlapY = minDy - absDy;
            const pushX = overlapX / 2 + 3;
            const pushY = overlapY / 2 + 3;
            const signX = dx >= 0 ? 1 : -1;
            const signY = dy >= 0 ? 1 : -1;
            const da = displacements.get(a.id)!;
            const db = displacements.get(b.id)!;
            da.dx -= signX * pushX;
            da.dy -= signY * pushY;
            db.dx += signX * pushX;
            db.dy += signY * pushY;
          }
        }
      }

      if (overlapCount === 0) break;

      this.cy!.batch(() => {
        for (const [id, d] of displacements) {
          const node = this.cy!.getElementById(id);
          if (node.nonempty()) {
            const p = node.position();
            node.position({ x: p.x + d.dx, y: p.y + d.dy });
          }
        }
      });
    }

    this.cy!.fit(undefined, 80);
  }

  private highlightedNodeIds: Set<string> = new Set();

  highlightNodes(nodeIds: NodeId[]): void {
    if (!this.cy) return;
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
        const node = this.cy!.getElementById(id);
        if (node.nonempty()) node.removeClass('highlighted');
      }
      for (const id of nodesToHighlight) {
        const node = this.cy!.getElementById(id);
        if (node.nonempty()) node.addClass('highlighted');
      }

      this.cy!.edges().forEach((edge) => {
        const srcId = edge.source().id();
        const tgtId = edge.target().id();
        const shouldHighlight = newSet.has(srcId) || newSet.has(tgtId);
        edge.toggleClass('highlighted', shouldHighlight);
      });
    });

    this.highlightedNodeIds = newSet;
  }

  selectNode(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().forEach((ele) => {
        ele.toggleClass('selected', ele.isNode() && ele.id() === nodeId);
      });
    });
  }

  filterByType(type: string): void {
    if (!this.cy) return;
    const hidden = new Set<string>();
    if (type !== 'all') {
      this.cy.nodes().forEach((node) => {
        if (node.data('type') !== type) hidden.add(node.id());
      });
    }
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        node.style('display', hidden.has(node.id()) ? 'none' : 'element');
      });
      this.cy!.edges().forEach((edge) => {
        const hiddenEdge = hidden.has(edge.source().id()) || hidden.has(edge.target().id());
        edge.style('display', hiddenEdge ? 'none' : 'element');
      });
    });
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    if (!this.cy) return;
    const allowedEdgeTypes = new Set<string>();
    if (graphType === 'all') {
      allowedEdgeTypes.add('call');
      allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('extend');
      allowedEdgeTypes.add('implement');
      allowedEdgeTypes.add('dependency');
    } else if (graphType === 'call') {
      allowedEdgeTypes.add('call');
    } else if (graphType === 'dependency') {
      allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('dependency');
    }

    const connectedNodeIds = new Set<string>();
    this.cy.batch(() => {
      this.cy!.edges().forEach((edge) => {
        const edgeType = edge.data('type') as string;
        const visible = allowedEdgeTypes.has(edgeType);
        edge.style('display', visible ? 'element' : 'none');
        if (visible) {
          connectedNodeIds.add(edge.source().id());
          connectedNodeIds.add(edge.target().id());
        }
      });
      this.cy!.nodes().forEach((node) => {
        node.style('display', connectedNodeIds.has(node.id()) ? 'element' : 'none');
      });
    });
  }


  search(query: string): number {
    if (!this.cy) return 0;
    if (!query) {
      this.cy.nodes().removeClass('search-match');
      return 0;
    }
    const q = query.toLowerCase();
    let matches = 0;
    let firstMatchId: string | null = null;
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        const label = node.data('label');
        const isMatch = typeof label === 'string' && label.toLowerCase().includes(q);
        node.toggleClass('search-match', isMatch);
        if (isMatch) {
          matches++;
          if (firstMatchId === null) firstMatchId = node.id();
        }
      });
    });
    if (firstMatchId) this.focusOnNode(firstMatchId);
    return matches;
  }

  focusOnNode(nodeId: string): void {
    if (!this.cy) return;
    const node = this.cy.getElementById(nodeId);
    if (node.nonempty()) {
      this.cy.animate({
        center: { eles: node },
        zoom: Math.max(this.cy.zoom(), 1.2),
        duration: 300,
      });
    }
  }

  highlightCallChain(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('call-chain');
      if (!nodeId) return;

      // Traverse via getElementById + connectedEdges (no string selectors, so
      // node ids with quotes/brackets can neither break nor inject a query).
      const visited = new Set<string>();
      const queue = [nodeId];
      let head = 0;

      while (head < queue.length) {
        const id = queue[head++]!;
        if (visited.has(id)) continue;
        visited.add(id);

        const node = this.cy!.getElementById(id);
        if (node.nonempty()) {
          node.addClass('call-chain');
        }

        node.connectedEdges().forEach((edge) => {
          if (edge.source().id() !== id) return;
          edge.addClass('call-chain');
          const target = edge.target().id();
          if (!visited.has(target)) {
            queue.push(target as NodeId);
          }
        });
      }
    });
  }

  detectCycles(): Set<string> {
    const cycles = new Set<string>();
    if (!this.cy) return cycles;

    // Build an adjacency list once: O(V + E), no per-step selector queries.
    const adjacency = new Map<string, string[]>();
    this.cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      const list = adjacency.get(s);
      if (list) list.push(t);
      else adjacency.set(s, [t]);
    });

    // Iterative DFS with explicit frames — no recursion, safe on 10k+ nodes.
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const enter = (start: string): void => {
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleStart = path.indexOf(target);
          if (cycleStart >= 0) {
            for (let i = cycleStart; i < path.length; i++) cycles.add(path[i]!);
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
          frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
    }

    return cycles;
  }

  highlightCycles(cycleIds: Set<string>): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('cycle-highlight');
      cycleIds.forEach((id) => {
        const node = this.cy!.getElementById(id);
        if (node.nonempty()) {
          node.addClass('cycle-highlight');
        }
      });
    });
  }

  highlightImpact(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('impact-d1 impact-d2 impact-d3 impact-source');
      if (!nodeId) return;

      const sourceNode = this.cy!.getElementById(nodeId);
      if (sourceNode.nonempty()) {
        sourceNode.addClass('impact-source');
      }

      const visited = new Map<string, number>();
      const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
      let head = 0;

      while (head < queue.length) {
        const { id, depth } = queue[head++]!;
        if (visited.has(id) && visited.get(id)! <= depth) continue;
        visited.set(id, depth);

        const node = this.cy!.getElementById(id);
        if (depth > 0 && node.nonempty()) {
          const cls = depth <= 1 ? 'impact-d1' : depth === 2 ? 'impact-d2' : 'impact-d3';
          node.addClass(cls);
        }

        if (depth < 3) {
          node.incomers().forEach((edge) => {
            const src = edge.source().id();
            if (!visited.has(src) || visited.get(src)! > depth + 1) {
              queue.push({ id: src, depth: depth + 1 });
            }
          });
        }
      }
    });
  }

  highlightInheritance(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
      if (!nodeId) {
        this.cy!.edges('[type="extend"]').addClass('inheritance-extend');
        this.cy!.edges('[type="implement"]').addClass('inheritance-implement');
        this.cy!.edges('[type!="extend"][type!="implement"]').addClass('inheritance-dim');
        this.cy!.nodes('[type!="class"][type!="interface"]').addClass('inheritance-dim');
        return;
      }

      const focusNode = this.cy!.getElementById(nodeId);
      if (focusNode.empty()) return;
      focusNode.addClass('inheritance-focus');

      const relevant = new Set<string>([nodeId]);
      const traverse = (id: string, direction: 'up' | 'down') => {
        const node = this.cy!.getElementById(id);
        if (direction === 'up') {
          node.outgoers('edge[type="extend"], edge[type="implement"]').forEach((edge) => {
            const target = edge.target().id();
            if (!relevant.has(target)) {
              relevant.add(target);
              edge.addClass('inheritance-highlight');
              traverse(target, 'up');
            }
          });
        } else {
          node.incomers('edge[type="extend"], edge[type="implement"]').forEach((edge) => {
            const source = edge.source().id();
            if (!relevant.has(source)) {
              relevant.add(source);
              edge.addClass('inheritance-highlight');
              traverse(source, 'down');
            }
          });
        }
      };
      traverse(nodeId, 'up');
      traverse(nodeId, 'down');

      relevant.forEach((id) => {
        const node = this.cy!.getElementById(id);
        if (node.nonempty()) node.addClass('inheritance-highlight');
      });

      this.cy!.edges('[type="extend"], edge[type="implement"]').forEach((edge) => {
        if (!relevant.has(edge.source().id()) && !relevant.has(edge.target().id())) {
          edge.addClass('inheritance-dim');
        }
      });
      this.cy!.edges('[type!="extend"][type!="implement"]').addClass('inheritance-dim');
      this.cy!.nodes().forEach((node) => {
        if (!relevant.has(node.id())) node.addClass('inheritance-dim');
      });
    });
  }

  focusNeighborhood(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('focus-highlight focus-dim');
      if (!nodeId) return;

      const focusNode = this.cy!.getElementById(nodeId);
      if (focusNode.empty()) return;

      const relevant = new Set<string>([nodeId]);
      focusNode.neighborhood().forEach((el) => {
        if (el.isNode()) relevant.add(el.id());
      });

      relevant.forEach((id) => {
        const el = this.cy!.getElementById(id);
        if (el.nonempty()) el.addClass('focus-highlight');
      });

      this.cy!.elements().forEach((el) => {
        if (!relevant.has(el.id())) el.addClass('focus-dim');
      });

      this.cy!.animate({
        fit: { eles: this.cy!.elements().filter((el) => relevant.has(el.id())), padding: 80 },
        duration: 400,
      });
    });
  }

  getThumbnail(): string | null {
    if (!this.cy) return null;
    return this.cy.png({ full: true, scale: 0.15, bg: 'transparent' });
  }

  getViewportInfo(): { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null {
    if (!this.cy) return null;
    const zoom = this.cy.zoom();
    const pan = this.cy.pan();
    const renderedSize = { w: this.cy.width(), h: this.cy.height() };
    const bounds = this.cy.elements().boundingBox();
    const totalSize = { w: bounds.w, h: bounds.h };
    return { zoom, pan, renderedSize, totalSize };
  }

  exportJSON(): string {
    if (!this.cy) return '';
    return JSON.stringify(this.cy.json(), null, 2);
  }

  exportPNG(): string | null {
    if (!this.cy) return null;
    return this.cy.png({ full: true, scale: 2 });
  }

  // NOTE: exportSVG returns an SVG wrapper containing an embedded PNG raster
  // image, not a true vector SVG. Cytoscape does not support native SVG export.
  exportSVG(): string | null {
    if (!this.cy) return null;
    const png = this.cy.png({ full: true, scale: 2 });
    const w = this.cy.width();
    const h = this.cy.height();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${png}" width="${w}" height="${h}"/></svg>`;
  }


  getSelectedNodeData(): GraphNode | null {
    if (!this.cy) return null;
    const selected = this.cy.nodes('.selected');
    if (selected.length === 0) return null;
    const id = selected.first().id();
    return this.currentNodes.get(id) ?? null;
  }

  getNodeData(nodeId: string): GraphNode | null {
    return this.currentNodes.get(nodeId) ?? null;
  }

  resize(): void {
    if (!this.cy) return;
    this.cy.resize();
  }

  updateTheme(theme: ThemeType): void {
    if (!this.cy) return;
    this.options.theme = theme;
    this.cy.style().fromJson(this.getStylesheet()).update();
  }

  private getStylesheet(): cytoscape.StylesheetJson {
    const c = getThemeColors(this.options.theme);
    const isDark = this.options.theme === 'dark';
    const nodeCount = this.cy?.nodes().length ?? 0;
    const isLargeGraph = nodeCount > 200;
    return [
      {
        selector: 'node',
        style: {
          'background-color': c.nodeDefault,
          'label': isLargeGraph ? '' : 'data(label)',
          'font-size': '10px',
          'color': c.text,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '70px',
          'width': isLargeGraph ? 14 : 32,
          'height': isLargeGraph ? 14 : 32,
          'shape': 'ellipse',
          'border-width': isLargeGraph ? 1 : 1.5,
          'border-color': c.border,
          ...(isLargeGraph ? {} : { 'transition-property': 'background-color, border-color, border-width', 'transition-duration': 200 }),
        },
      },
      {
        selector: 'node:hover',
        style: {
          'border-width': isLargeGraph ? 2 : 3,
          'border-color': isDark ? '#818cf8' : '#1a2230',
          'overlay-opacity': 0,
        },
      },
      {
        selector: 'node[weight]',
        style: {
          'width': 'mapData(weight, 1, 10, 24, 56)',
          'height': 'mapData(weight, 1, 10, 24, 56)',
        },
      },
      {
        selector: ':parent',
        style: {
          'background-color': 'rgba(0,0,0,0.05)',
          'border-width': 2,
          'border-color': c.border,
          'border-style': 'dashed',
          'label': 'data(label)',
          'font-size': '10px',
          'color': c.text,
          'text-valign': 'top',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '100px',
          'padding': '10px',
        },
      },
      {
        selector: 'node[type="function"]',
        style: { 'shape': 'round-triangle', 'background-color': c.nodeFunction },
      },
      {
        selector: 'node[type="class"]',
        style: { 'shape': 'rectangle', 'background-color': c.nodeClass },
      },
      {
        selector: 'node[type="variable"]',
        style: { 'shape': 'diamond', 'background-color': c.nodeVariable },
      },
      {
        selector: 'node[type="module"]',
        style: { 'shape': 'round-rectangle', 'background-color': c.nodeModule },
      },
      {
        selector: 'node[type="interface"]',
        style: { 'shape': 'hexagon', 'background-color': c.nodeInterface },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': c.edgeDefault,
          'target-arrow-color': c.edgeDefault,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'opacity': 0.5,
        },
      },
      {
        selector: 'edge[type="call"]',
        style: { 'line-color': c.edgeCall, 'target-arrow-color': c.edgeCall },
      },
      {
        selector: 'edge[type="import"]',
        style: { 'line-color': c.edgeImport, 'target-arrow-color': c.edgeImport },
      },
      {
        selector: 'edge[type="extend"]',
        style: { 'line-color': c.edgeExtend, 'target-arrow-color': c.edgeExtend },
      },
      {
        selector: '.highlighted',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-warning', '#f59e0b'),
          'z-index': 20,
        },
      },
      {
        selector: '.selected',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-error', '#ef4444'),
          'z-index': 30,
        },
      },
      {
        selector: '.search-match',
        style: {
          'border-width': 3,
          'border-color': readCssVar('--cg-success', '#10b981'),
        },
      },
      {
        selector: '.call-chain',
        style: {
          'background-color': readCssVar('--cg-warning', '#f59e0b'),
          'border-width': 3,
          'border-color': readCssVar('--cg-warning', '#f59e0b'),
          'opacity': 0.9,
          'z-index': 25,
        },
      },
      {
        selector: 'edge.call-chain',
        style: {
          'line-color': readCssVar('--cg-warning', '#f59e0b'),
          'target-arrow-color': readCssVar('--cg-warning', '#f59e0b'),
          'width': 3,
          'opacity': 1,
          'z-index': 25,
        },
      },
      {
        selector: '.cycle-highlight',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-error', '#ef4444'),
          'background-color': readCssVar('--cg-error', '#ef4444'),
        },
      },
      {
        selector: '.impact-source',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-error', '#ef4444'),
          'background-color': readCssVar('--cg-error', '#ef4444'),
          'z-index': 35,
        },
      },
      {
        selector: '.impact-d1',
        style: {
          'border-width': 3,
          'border-color': '#f59e0b',
          'background-color': '#f59e0b',
          'z-index': 28,
        },
      },
      {
        selector: '.impact-d2',
        style: {
          'border-width': 3,
          'border-color': '#fbbf24',
          'background-color': '#fbbf24',
          'opacity': 0.8,
          'z-index': 22,
        },
      },
      {
        selector: '.impact-d3',
        style: {
          'border-width': 2,
          'border-color': '#fde68a',
          'background-color': '#fde68a',
          'opacity': 0.6,
          'z-index': 18,
        },
      },
      {
        selector: '.inheritance-extend',
        style: {
          'width': 2.5,
          'line-color': isDark ? '#f472b6' : '#ec4899',
          'target-arrow-color': isDark ? '#f472b6' : '#ec4899',
          'opacity': 0.9,
          'z-index': 20,
        },
      },
      {
        selector: '.inheritance-implement',
        style: {
          'width': 2,
          'line-color': isDark ? '#2dd4bf' : '#14b8a6',
          'target-arrow-color': isDark ? '#2dd4bf' : '#14b8a6',
          'opacity': 0.9,
          'z-index': 20,
          'line-style': 'dashed',
        },
      },
      {
        selector: '.inheritance-highlight',
        style: {
          'border-width': 3,
          'border-color': isDark ? '#f472b6' : '#ec4899',
          'opacity': 1,
          'z-index': 25,
        },
      },
      {
        selector: 'edge.inheritance-highlight',
        style: {
          'width': 3,
          'opacity': 1,
          'z-index': 25,
        },
      },
      {
        selector: '.inheritance-focus',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-error', '#ef4444'),
          'background-color': readCssVar('--cg-error', '#ef4444'),
          'z-index': 35,
        },
      },
      {
        selector: '.inheritance-dim',
        style: {
          'opacity': 0.15,
        },
      },
      {
        selector: '.focus-highlight',
        style: {
          'border-width': 3,
          'border-color': readCssVar('--cg-accent', isDark ? '#6366f1' : '#263148'),
          'opacity': 1,
          'z-index': 30,
        },
      },
      {
        selector: 'edge.focus-highlight',
        style: {
          'width': 2.5,
          'line-color': readCssVar('--cg-accent', isDark ? '#6366f1' : '#263148'),
          'target-arrow-color': readCssVar('--cg-accent', isDark ? '#6366f1' : '#263148'),
          'opacity': 1,
          'z-index': 30,
        },
      },
      {
        selector: '.focus-dim',
        style: {
          'opacity': 0.1,
        },
      },
      {
        selector: 'node[isCluster]',
        style: {
          'shape': 'round-rectangle',
          'background-color': isDark ? 'rgba(99,102,241,0.15)' : 'rgba(38,49,72,0.10)',
          'border-width': 2,
          'border-color': isDark ? '#818cf8' : '#263148',
          'border-style': 'solid',
          'label': 'data(label)',
          'font-size': '11px',
          'font-weight': 'bold',
          'color': c.text,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '90px',
          'width': 'mapData(childCount, 1, 3000, 40, 80)',
          'height': 'mapData(childCount, 1, 3000, 40, 80)',
          'z-index': 5,
          'transition-property': 'background-color, border-color, border-width',
          'transition-duration': 200,
        },
      },
      {
        selector: 'node[isCluster]:hover',
        style: {
          'background-color': isDark ? 'rgba(99,102,241,0.35)' : 'rgba(38,49,72,0.25)',
          'border-width': 4,
          'border-color': isDark ? '#a5b4fc' : '#1a2230',

        },
      },
      {
        selector: 'edge[isCluster]',
        style: {
          'width': 'mapData(aggregatedCount, 1, 200, 1.5, 4)',
          'line-color': isDark ? '#818cf8' : '#263148',
          'target-arrow-color': isDark ? '#818cf8' : '#263148',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '10px',
          'color': c.text,
          'text-rotation': 'autorotate',
          'text-background-color': isDark ? '#232324' : '#f9fafb',
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'opacity': 0.75,
        },
      },
      {
        selector: 'edge[isCluster]:hover',
        style: {
          'opacity': 1,
          'width': 'mapData(aggregatedCount, 1, 200, 2.5, 6)',
        },
      },

    ];
  }

  destroy(): void {
    if (this.layoutRaf !== null) {
      cancelAnimationFrame(this.layoutRaf);
      this.layoutRaf = null;
    }
    this.cy?.destroy();
    this.cy = null;
    this.currentNodes.clear();
    this.currentEdges.clear();
  }
}
