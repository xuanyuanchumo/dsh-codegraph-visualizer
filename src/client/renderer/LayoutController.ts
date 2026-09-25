import type { Core, LayoutOptions } from 'cytoscape';
import type { LayoutType, RankDir } from '../../shared/viewModeUtils.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { computeSmartSpacing, type SmartSpacing } from '../../shared/layoutUtils.ts';
import { LAYOUT as LAYOUT_CONST, RENDERER } from '../../shared/constants.ts';
import { OverlapRemover } from './OverlapRemover.ts';

const log = scoped('layout');

export class LayoutController {
  private cy: Core;
  private layoutRaf: number | null = null;
  private positionCache: Map<string, { x: number; y: number }> = new Map();
  private workerLayoutResolve: ((positions: Record<string, { x: number; y: number }>) => void) | null = null;
  private worker: Worker | null = null;
  private workerInitFailed = false;
  private workerRetryCount = 0;

  private workerTimeout: ReturnType<typeof setTimeout> | null = null;
  private overlapRemover: OverlapRemover;
  rankDir: RankDir = 'TB';

  constructor(cy: Core) {
    this.cy = cy;
    this.overlapRemover = new OverlapRemover(cy);
    this.initWorker();
  }

  private initWorker(): void {
    try {
      let workerUrl: string | null = null;

      // In browser context (both ESM and CJS bundles), use document.baseURI
      // for relative URL resolution. This works in DSH web's classic <script>
      // loading as well as the dev server's ESM dynamic import.
      if (typeof document !== 'undefined' && document.baseURI) {
        try {
          workerUrl = new URL('plugins/dsh-codegraph-visualizer/worker/layoutWorker.js', document.baseURI).href;
        } catch (_e) { /* URL construction fallback — try next candidate */ }
      }

      if (workerUrl) {
        this.worker = new Worker(workerUrl, { type: 'module' });
      }

      if (this.worker) {
        this.worker.onmessage = (e: MessageEvent<{ positions: Record<string, { x: number; y: number }> }>) => {
          if (this.workerLayoutResolve) {
            this.workerLayoutResolve(e.data.positions);
            this.workerLayoutResolve = null;
          }
        };
        this.worker.onerror = () => {
          this.worker?.terminate();
          this.worker = null;
          this.workerInitFailed = true;
          log.warn('layout worker error — falling back to main-thread layout');
        };
      } else {
        this.workerInitFailed = true;
        log.warn('layout worker not available — using main-thread layout');
      }
    } catch (e) {
      this.workerInitFailed = true;
      log.warn('layout worker init failed — using main-thread layout', e);
    }
  }

  isWorkerAvailable(): boolean {
    return this.worker !== null && !this.workerInitFailed;
  }

  retryWorker(): void {
    this.retryWorkerInit();
  }

  private retryWorkerInit(): void {
    if (this.worker || !this.workerInitFailed) return;
    if (this.workerRetryCount >= 3) return;
    this.workerRetryCount++;
    this.workerInitFailed = false;
    this.initWorker();
  }

  applyLayoutWithWorker(
    nodes: GraphNode[],
    edges: GraphEdge[],
    layout: LayoutType,
  ): Promise<Record<string, { x: number; y: number }>> {

    if (!this.worker) return Promise.resolve({});

    return new Promise((resolve) => {
      this.workerTimeout = setTimeout(() => {
        if (this.workerLayoutResolve) {
          log.warn('layout worker timeout — falling back to empty positions');
          this.workerLayoutResolve({});
          this.workerLayoutResolve = null;
        }
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
          this.workerInitFailed = true;
          log.warn('layout worker terminated due to timeout — will retry on next layout');
        }
      }, RENDERER.LAYOUT_TIMEOUT_MS);

      this.workerLayoutResolve = (positions) => {
        if (this.workerTimeout) {
          clearTimeout(this.workerTimeout);
          this.workerTimeout = null;
        }
        resolve(positions);
      };

      this.worker!.postMessage({
        nodes: nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type })),
        layout,
        rankDir: this.rankDir,
        containerWidth: this.cy.width() || 800,
        containerHeight: this.cy.height() || 600,
      });
    });
  }

  applyWorkerLayout(positions: Record<string, { x: number; y: number }>): void {
    this.cy.batch(() => {
      for (const [id, pos] of Object.entries(positions)) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.position(pos);
      }
    });
    this.cy.fit(undefined, RENDERER.FIT_PADDING);
    this.cachePositions();
  }

  applyLayout(layout: LayoutType): void {
    if (this.layoutRaf !== null) cancelAnimationFrame(this.layoutRaf);

    this.layoutRaf = requestAnimationFrame(() => {
      this.cachePositions();
      const nodeCount = this.cy.nodes().length;
      let effectiveLayout = layout;
      let animate = true;

      if (nodeCount > LAYOUT_CONST.GRID_FALLBACK_NODE_THRESHOLD) {
        effectiveLayout = 'grid';
        animate = false;
      } else if (nodeCount > LAYOUT_CONST.LARGE_NODE_THRESHOLD && (layout === 'cose' || layout === 'fcose')) {
        effectiveLayout = 'dagre';
        animate = false;
      }

      const options = this.buildLayoutOptions(effectiveLayout, animate, nodeCount);
      if (options) {
        const l = this.cy.layout(options);
          l.one('layoutstop', () => this.overlapRemover.remove());
        l.run();
      }
      this.layoutRaf = null;
    });
  }

  applyIncrementalLayout(layout: LayoutType, newNodeIds: Set<string>): void {
    if (newNodeIds.size === 0) return;
    if (this.layoutRaf !== null) cancelAnimationFrame(this.layoutRaf);

    this.layoutRaf = requestAnimationFrame(() => {
      const newNodes = this.cy.nodes().filter((n) => newNodeIds.has(n.id()));
      if (newNodes.length === 0) {
        this.layoutRaf = null;
        return;
      }

      this.restoreCachedPositions();

      const totalNodes = this.cy.nodes().length;
      const sp = this.computeSmartSpacing(totalNodes);
      const newNodeIdArray = Array.from(newNodeIds);

      let anchorX = 0;
      let anchorY = 0;
      let anchorCount = 0;
      for (const newId of newNodeIdArray) {
        const newNode = this.cy.getElementById(newId);
        if (newNode.empty()) continue;
        newNode.connectedEdges().forEach((edge) => {
          const source = edge.source();
          const target = edge.target();
          const other = source.id() === newId ? target : source;
          if (!newNodeIds.has(other.id())) {
            const pos = other.position();
            anchorX += pos.x;
            anchorY += pos.y;
            anchorCount++;
          }
        });
      }

      let cx: number;
      let cy: number;
      if (anchorCount > 0) {
        cx = anchorX / anchorCount;
        cy = anchorY / anchorCount;
      } else {
        const existingNodes = this.cy.nodes().filter((n) => !newNodeIds.has(n.id()));
        if (existingNodes.length > 0) {
          const bbox = existingNodes.boundingBox();
          cx = (bbox.x1 + bbox.x2) / 2;
          cy = (bbox.y1 + bbox.y2) / 2;
        } else {
          cx = 0;
          cy = 0;
        }
      }

      const goldenAngle = LAYOUT_CONST.GOLDEN_ANGLE;
      const newNodeIndexMap = new Map<string, number>();
      for (let i = 0; i < newNodeIdArray.length; i++) {
        newNodeIndexMap.set(newNodeIdArray[i]!, i);
      }

      const presetOptions: LayoutOptions = {
        name: 'preset',
        positions: (node: { id: () => string }) => {
          const cached = this.positionCache.get(node.id());
          if (cached) return cached;
          const idx = newNodeIndexMap.get(node.id());
          if (idx === undefined) return { x: cx, y: cy };
          const radius = sp.incrementalRadius * Math.sqrt(idx + 1);
          const angle = idx * goldenAngle;
          return {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
          };
        },
        animate: false,
      } as LayoutOptions;

      this.cy.layout(presetOptions).run();

      if (layout === 'cose' || layout === 'fcose' || layout === 'dagre') {
        const incrementalOptions = this.buildLayoutOptions(layout, false, newNodes.length);
        if (incrementalOptions) {
          const l = newNodes.layout(incrementalOptions);
      l.one('layoutstop', () => this.overlapRemover.remove());
          l.run();
        }
      } else {
        this.overlapRemover.remove();
      }

      this.cachePositions();
      this.layoutRaf = null;
    });
  }

  private cachePositions(): void {
    this.positionCache.clear();
    this.cy.nodes().forEach((n) => {
      const p = n.position();
      this.positionCache.set(n.id(), { x: p.x, y: p.y });
    });
  }

  private restoreCachedPositions(): void {
    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => {
        const cached = this.positionCache.get(n.id());
        if (cached) n.position(cached);
      });
    });
  }

  private computeSmartSpacing(nodeCount: number): SmartSpacing {
    const w = this.cy.width() || 800;
    const h = this.cy.height() || 600;
    return computeSmartSpacing(nodeCount, w, h);
  }

  private buildLayoutOptions(layout: LayoutType, animate: boolean, nodeCount: number): LayoutOptions | undefined {
    const sp = this.computeSmartSpacing(nodeCount);
    switch (layout) {
      case 'cose':
        return {
          name: 'cose', fit: true, animate: false,
          nodeRepulse: sp.nodeRepulse, idealEdgeLength: sp.idealEdgeLength,
          edgeElasticity: 0.05, gravity: 0.02, numIter: LAYOUT_CONST.COSE_NUM_ITER,
          randomize: true, tile: true, padding: sp.padding, avoidOverlap: true,
        } as LayoutOptions;
      case 'fcose':
        return {
          name: 'fcose', fit: true, animate: false,
          nodeRepulse: sp.nodeRepulse, idealEdgeLength: sp.idealEdgeLength,
          edgeElasticity: 0.05, gravity: 0.02,
          numIter: nodeCount > LAYOUT_CONST.FCOSE_LARGE_NODE_THRESHOLD ? LAYOUT_CONST.FCOSE_LARGE_NUM_ITER : LAYOUT_CONST.COSE_NUM_ITER,
          randomize: true, tile: true, padding: sp.padding, avoidOverlap: true,
          quality: nodeCount > LAYOUT_CONST.FCOSE_LARGE_NODE_THRESHOLD ? LAYOUT_CONST.FCOSE_LARGE_QUALITY : 'default',
          samplingType: true, nodeSeparation: sp.minNodeSpacing,
        } as LayoutOptions;
      case 'dagre':
        return {
          name: 'dagre', fit: true, animate, rankDir: this.rankDir,
          rankSep: sp.rankSep, edgeSep: sp.edgeSep, nodeSep: sp.nodeSep,
          ranker: 'tight-tree', padding: sp.padding,
        } as LayoutOptions;
      case 'circle':
        return {
          name: 'circle', fit: true, animate, padding: sp.padding,
          radius: () => Math.min(this.cy.width(), this.cy.height()) / 2 - sp.padding,
        } as LayoutOptions;
      case 'grid':
        return {
          name: 'grid', fit: true, animate: false, padding: sp.padding,
          avoidOverlap: true,
          rows: Math.ceil(Math.sqrt(nodeCount)),
          cols: Math.ceil(Math.sqrt(nodeCount)),
        } as LayoutOptions;
      case 'radial': {
        let maxDeg = 1;
        if (nodeCount > LAYOUT_CONST.VERY_LARGE_NODE_THRESHOLD) {
          const sampleSize = Math.min(LAYOUT_CONST.LAYOUT_SAMPLE_SIZE, nodeCount);
          const step = Math.max(1, Math.floor(nodeCount / sampleSize));
          for (let i = 0; i < nodeCount; i += step) {
            const deg = this.cy.nodes()[i]?.degree() ?? 0;
            if (deg > maxDeg) maxDeg = deg;
          }
        } else {
          const degrees = this.cy.nodes().map((n) => n.degree()).sort((a, b) => a - b);
          maxDeg = degrees[degrees.length - 1] ?? 1;
        }
        const levelW = Math.max(1, Math.ceil(maxDeg / 4));
        return {
          name: 'concentric', fit: true, animate: false,
          padding: sp.padding, minNodeSpacing: sp.minNodeSpacing,
          concentric: (n: { degree: () => number }) => n.degree(),
          levelWidth: () => levelW,
        } as LayoutOptions;
      }
      case 'tree': {
        const rootByProp = this.cy.nodes().filter((n: { data: (key: string) => unknown }) => n.data('isRoot') === true);
        const rootNodes = rootByProp.nonempty() ? rootByProp : this.cy.nodes().roots();
        let roots: ReturnType<typeof this.cy.nodes>;
        if (rootNodes.nonempty()) {
          roots = rootNodes;
        } else {
          roots = this.cy.nodes().sort((a: { degree: () => number }, b: { degree: () => number }) => b.degree() - a.degree()).slice(0, 1);
        }
        return {
          name: 'breadthfirst', fit: true, animate: false,
          padding: sp.padding, directed: true, spacingFactor: sp.spacingFactor,
          roots,
        } as LayoutOptions;
      }
      default: {
        const _exhaustive: never = layout;
        throw new Error(`Unhandled layout: ${_exhaustive}`);
      }
    }
  }


  destroy(): void {
    if (this.layoutRaf !== null) cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = null;
    if (this.workerTimeout) {
      clearTimeout(this.workerTimeout);
      this.workerTimeout = null;
    }
    this.positionCache.clear();
    if (this.workerLayoutResolve) {
      this.workerLayoutResolve({});
      this.workerLayoutResolve = null;
    }
    this.worker?.terminate();
    this.worker = null;
  }
}