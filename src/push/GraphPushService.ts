// Push service - Listen for upstream changes and broadcast to client
import type { RepoId } from '../types';
import { RepoId } from '../types';

interface PushServiceOptions {
  pollInterval?: number; // ms, default 3000
}

export class GraphPushService {
  private pollInterval: number;
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private listeners = new Set<(data: { repoId: string; event: string; data: unknown }) => void>();

  constructor(options: PushServiceOptions = {}) {
    this.pollInterval = options.pollInterval ?? 3000;
  }

  // Start polling for a repo
  startPolling(repoId: RepoId, ctx: {
    tools: { invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown> };
    broadcast: (event: string, data: unknown) => void;
  }): void {
    const repoKey = repoId;
    if (this.timers.has(repoKey)) return;

    const timer = setInterval(async () => {
      try {
        const status = await ctx.tools.invoke('codegraph_status', { repoId }) as {
          status: string;
          lastUpdated: number;
        };
        
        if (status.status === 'ready') {
          ctx.broadcast('graph:auto-update', { repoId, timestamp: Date.now() });
        }
      } catch {
        // Polling failure is non-fatal
      }
    }, this.pollInterval);

    this.timers.set(repoKey, timer);
  }

  // Stop polling for a repo
  stopPolling(repoId: RepoId): void {
    const repoKey = repoId;
    const timer = this.timers.get(repoKey);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(repoKey);
    }
  }

  // Subscribe to push events
  subscribe(callback: (data: { repoId: string; event: string; data: unknown }) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // Emit event to all listeners
  private emit(event: string, data: unknown): void {
    for (const listener of this.listeners) {
      listener({ repoId: '', event, data });
    }
  }

  // Cleanup all resources
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.listeners.clear();
  }
}