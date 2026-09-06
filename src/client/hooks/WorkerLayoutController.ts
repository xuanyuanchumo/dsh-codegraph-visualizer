import type { LayoutType } from '../renderer/IRenderer.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { LayoutWorkerRequest, LayoutWorkerResponse } from '../worker/layoutWorker.ts';

export class WorkerLayoutController {
  private worker: Worker | null = null;
  private pendingResolve: ((positions: Record<string, { x: number; y: number }>) => void) | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('../worker/layoutWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<LayoutWorkerResponse>) => {
        if (this.pendingResolve) {
          this.pendingResolve(e.data.positions);
          this.pendingResolve = null;
        }
      };
      this.worker.onerror = () => {
        if (this.pendingResolve) {
          this.pendingResolve({});
          this.pendingResolve = null;
        }
      };
    } catch {
      this.worker = null;
    }
  }

  isAvailable(): boolean {
    return this.worker !== null;
  }

  computeLayout(
    nodes: GraphNode[],
    edges: GraphEdge[],
    layout: LayoutType,
  ): Promise<Record<string, { x: number; y: number }>> {
    if (!this.worker) return Promise.resolve({});

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      const request: LayoutWorkerRequest = {
        nodes: nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type })),
        layout,
      };
      this.worker!.postMessage(request);
    });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pendingResolve = null;
  }
}