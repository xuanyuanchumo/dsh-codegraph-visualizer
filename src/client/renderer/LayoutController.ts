import type { Collection, Core, LayoutOptions } from 'cytoscape';
import type { LayoutType, RankDir } from '../../shared/viewModeUtils.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { computeSmartSpacing, type SmartSpacing } from '../../shared/layoutUtils.ts';
import { LAYOUT as LAYOUT_CONST, LAYOUT_WORKER, RENDERER } from '../../shared/constants.ts';
import { startMeasure, endMeasure } from '../../shared/PerformanceMonitor.ts';
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
  /** Set once the worker has answered at least one message — only that proves the bundle loaded. */
  private workerReady = false;
  /** Set when the retry budget is exhausted, or after destroy; blocks every later attempt. */
  private workerGaveUp = false;

  private workerTimeout: ReturnType<typeof setTimeout> | null = null;
  private overlapRemover: OverlapRemover;
  rankDir: RankDir = 'TB';

  constructor(cy: Core) {
    this.cy = cy;
    this.overlapRemover = new OverlapRemover(cy);
    this.initWorker();
  }

  private initWorker(): void {
    if (this.workerGaveUp) return;
    try {
      let workerUrl: string | null = null;

      // The worker bundle is served by this plugin's own host route (see LAYOUT_WORKER), so an
      // absolute same-origin URL is correct in DSH web, in the desktop shell and behind the dev
      // server's /api proxy — all of which serve the plugin's HTTP API from the page origin.
      if (typeof document !== 'undefined' && document.baseURI) {
        try {
          workerUrl = new URL(LAYOUT_WORKER.ROUTE_PATH, document.baseURI).href;
        } catch { /* URL construction fallback — try next candidate */ }
      }

      if (workerUrl) {
        // Classic worker: the bundle is built as a single IIFE on purpose, so no sibling chunk can
        // be requested from a URL the worker route does not serve.
        this.worker = new Worker(workerUrl);
      }

      if (this.worker) {
        this.worker.onmessage = (e: MessageEvent<{ positions: Record<string, { x: number; y: number }> }>) => {
          // A reply is the only proof the bundle loaded: reset the budget here, never at
          // construction time, or a failing URL would be retried forever.
          this.workerReady = true;
          this.workerInitFailed = false;
          this.workerRetryCount = 0;
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
          // Release any layout already waiting on this worker instead of letting it sit until
          // the timeout: the caller re-runs the layout on the main thread as soon as we resolve.
          this.failPendingLayout();
          this.retryWorkerInit();
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

  /** Resolve an in-flight worker layout with no positions, so the caller falls back immediately. */
  private failPendingLayout(): void {
    if (this.workerTimeout) {
      clearTimeout(this.workerTimeout);
      this.workerTimeout = null;
    }
    if (this.workerLayoutResolve) {
      const resolve = this.workerLayoutResolve;
      this.workerLayoutResolve = null;
      resolve({});
    }
  }

  isWorkerAvailable(): boolean {
    return this.worker !== null && !this.workerInitFailed && !this.workerGaveUp;
  }

  retryWorker(): void {
    this.retryWorkerInit();
  }

  private retryWorkerInit(): void {
    if (this.worker) return;
    if (this.workerGaveUp) return;
    if (this.workerRetryCount >= RENDERER.WORKER_MAX_INIT_RETRIES) {
      this.workerGaveUp = true;
      log.warn(
        `layout worker unavailable after ${RENDERER.WORKER_MAX_INIT_RETRIES} retries — main-thread layout for the rest of this session`,
      );
      return;
    }
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

    const worker = this.worker;
    if (this.workerLayoutResolve) {
      if (this.workerTimeout) { clearTimeout(this.workerTimeout); this.workerTimeout = null; }
      this.workerLayoutResolve({});
      this.workerLayoutResolve = null;
    }
    // Before the first reply the URL may still be a 404 that has not errored yet, so the first
    // round trip gets the shorter handshake budget; proven workers get the full layout budget.
    const timeoutMs = this.workerReady
      ? RENDERER.LAYOUT_TIMEOUT_MS
      : RENDERER.WORKER_HANDSHAKE_TIMEOUT_MS;
    return new Promise((resolve) => {
      this.workerTimeout = setTimeout(() => {
        log.warn('layout worker timeout — falling back to main-thread layout');
        this.failPendingLayout();
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
          this.workerInitFailed = true;
          log.warn('layout worker terminated due to timeout — retrying within the retry budget');
          this.retryWorkerInit();
        }
      }, timeoutMs);

      this.workerLayoutResolve = (positions) => {
        if (this.workerTimeout) {
          clearTimeout(this.workerTimeout);
          this.workerTimeout = null;
        }
        resolve(positions);
      };

      worker.postMessage({
        nodes: nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type })),
        layout,
        rankDir: this.rankDir,
        containerWidth: this.cy.width() || RENDERER.DEFAULT_CONTAINER_WIDTH,
        containerHeight: this.cy.height() || RENDERER.DEFAULT_CONTAINER_HEIGHT,
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
      startMeasure('layout');
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
        l.one('layoutstop', () => {
          endMeasure('layout');
          this.overlapRemover.remove();
        });
        l.run();
      } else {
        endMeasure('layout');
      }
      this.layoutRaf = null;
    });
  }

  applyIncrementalLayout(layout: LayoutType, newNodeIds: Set<string>): void {
    if (newNodeIds.size === 0) return;
    if (this.layoutRaf !== null) cancelAnimationFrame(this.layoutRaf);

    this.layoutRaf = requestAnimationFrame(() => {
      // A requestAnimationFrame callback sits outside every synchronous guard its caller has —
      // CytoscapeRenderer.safeCallVoid cannot see it — so a layout-library throw here would escape
      // as an uncaught exception. Guard the whole body and always clear the pending handle.
      try {
        this.runIncrementalLayout(layout, newNodeIds);
      } catch (e) {
        log.warn('incremental layout failed — keeping the previous positions', e);
      } finally {
        this.layoutRaf = null;
      }
    });
  }

  private runIncrementalLayout(layout: LayoutType, newNodeIds: Set<string>): void {
    const newNodes = this.cy.nodes().filter((n) => newNodeIds.has(n.id()));
    if (newNodes.length === 0) {
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

    // Compound links make Cytoscape's spatial layouts fragile as soon as the graph is partial: the
    // built-in `cose` indexes each node's parent inside the collection it is handed (a parent left
    // behind makes that lookup undefined and the layout throws `...reading 'children'`), and
    // fcose/cose-base trips over compounds whose members are only partly in the collection. Lay the
    // new nodes out flat instead — compound membership comes back right after — and let Cytoscape
    // recompute the compound box from the children's final positions.
    const detached = this.detachCompoundLinks(newNodes);
    try {
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
    } finally {
      this.restoreCompoundLinks(detached);
    }

    this.cachePositions();
  }

  /** Drop compound membership for the duration of a layout; returns what has to be put back. */
  private detachCompoundLinks(nodes: Collection): Array<{ child: string; parent: string }> {
    const detached: Array<{ child: string; parent: string }> = [];
    this.cy.batch(() => {
      nodes.forEach((node) => {
        const parent = node.parent();
        if (parent.nonempty()) {
          detached.push({ child: node.id(), parent: parent.first().id() });
          node.move({ parent: null });
        }
      });
    });
    return detached;
  }

  private restoreCompoundLinks(detached: Array<{ child: string; parent: string }>): void {
    if (detached.length === 0) return;
    this.cy.batch(() => {
      for (const { child, parent } of detached) {
        this.cy.getElementById(child).move({ parent });
      }
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
    const w = this.cy.width() || RENDERER.DEFAULT_CONTAINER_WIDTH;
    const h = this.cy.height() || RENDERER.DEFAULT_CONTAINER_HEIGHT;
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
    // Stop every later attempt: a worker error that lands after destroy must not be answered by
    // building a fresh worker for a controller nobody uses any more.
    this.workerGaveUp = true;
    this.positionCache.clear();
    this.failPendingLayout();
    this.worker?.terminate();
    this.worker = null;
  }
}