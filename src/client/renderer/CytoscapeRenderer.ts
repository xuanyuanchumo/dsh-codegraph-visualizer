import cytoscape, { type Core, type LayoutOptions, type NodeDataDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/graphStore.ts';
import type { IRenderer, LayoutType, ThemeType } from './IRenderer.ts';
import { buildStylesheet } from './styles/ThemeStylesheet.ts';

cytoscape.use(dagre);


export interface CytoscapeRendererOptions {
  container: HTMLElement;
  theme: ThemeType;
  onNodeTap?: (nodeId: string) => void;
  onEdgeTap?: (edgeId: string) => void;
  onNodeDoubleTap?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string, renderedPosition: { x: number; y: number }) => void;
  onNodeHoverOut?: () => void;
  onEdgeHover?: (edgeId: string, renderedPosition: { x: number; y: number }) => void;
  onEdgeHoverOut?: () => void;
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
      node.addClass('hovered');
      const pos = node.renderedPosition();
      this.options.onNodeHover?.(node.id(), { x: pos.x, y: pos.y });
    });

    this.cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hovered');
      this.options.onNodeHoverOut?.();
    });

    this.cy.on('mouseover', 'edge', (evt) => {
      const edge = evt.target;
      edge.addClass('hovered');
      const pos = edge.renderedMidpoint();
      this.options.onEdgeHover?.(edge.id(), { x: pos.x, y: pos.y });
    });

    this.cy.on('mouseout', 'edge', (evt) => {
      evt.target.removeClass('hovered');
      this.options.onEdgeHoverOut?.();
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
      let _hasPositions = true;
      nodes.forEach((n) => {
        const p = n.position();
        if (p.x == null || p.y == null || Number.isNaN(p.x) || Number.isNaN(p.y)) {
          _hasPositions = false;
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
    const maxIterations = 20;
    const skipThreshold = 2000;

    if (nodes.length > skipThreshold) {
      this.cy!.fit(undefined, 80);
      return;
    }

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

    const cellSize = minGap * 4;
    for (let iter = 0; iter < maxIterations; iter++) {
      const positions: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
      nodes.forEach((n) => {
        const p = n.position();
        positions.push({ id: n.id(), x: p.x, y: p.y, w: n.width(), h: n.height() });
      });

      const grid = new Map<string, number[]>();
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i]!;
        const gx = Math.floor(p.x / cellSize);
        const gy = Math.floor(p.y / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = `${gx + dx},${gy + dy}`;
            let bucket = grid.get(key);
            if (!bucket) { bucket = []; grid.set(key, bucket); }
            bucket.push(i);
          }
        }
      }

      const displacements = new Map<string, { dx: number; dy: number }>();
      let overlapCount = 0;
      const checked = new Set<string>();

      for (const [, bucket] of grid) {
        for (let i = 0; i < bucket.length; i++) {
          for (let j = i + 1; j < bucket.length; j++) {
            const ai = bucket[i]!;
            const bi = bucket[j]!;
            const pairKey = ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`;
            if (checked.has(pairKey)) continue;
            checked.add(pairKey);
            const a = positions[ai]!;
            const b = positions[bi]!;
            const ddx = b.x - a.x;
            const ddy = b.y - a.y;
            const minDx = (a.w + b.w) / 2 + minGap;
            const minDy = (a.h + b.h) / 2 + minGap;
            const absDx = Math.abs(ddx);
            const absDy = Math.abs(ddy);
            if (absDx < minDx && absDy < minDy) {
              overlapCount++;
              const overlapX = minDx - absDx;
              const overlapY = minDy - absDy;
              const pushX = overlapX / 2 + 3;
              const pushY = overlapY / 2 + 3;
              const signX = ddx >= 0 ? 1 : -1;
              const signY = ddy >= 0 ? 1 : -1;
              let da = displacements.get(a.id);
              if (!da) { da = { dx: 0, dy: 0 }; displacements.set(a.id, da); }
              let db = displacements.get(b.id);
              if (!db) { db = { dx: 0, dy: 0 }; displacements.set(b.id, db); }
              da.dx -= signX * pushX;
              da.dy -= signY * pushY;
              db.dx += signX * pushX;
              db.dy += signY * pushY;
            }
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

  getEdgeData(edgeId: string): GraphEdge | null {
    return this.currentEdges.get(edgeId) ?? null;
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
    const nodeCount = this.cy?.nodes().length ?? 0;
    return buildStylesheet(this.options.theme, nodeCount);
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
