import type { LayoutType, GraphType } from '../store/graphStore.ts';
import type { GraphNode, NodeId, ViewMode } from '../../types/index.ts';

export interface HistorySnapshot {
  layout: LayoutType;
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  clusterDepth: number;
  selectedNodeId: NodeId | null;
  expandedNodeIds: Set<string>;
  viewMode: ViewMode;
}

export class HistoryManager {
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 50) {
    this.maxHistory = maxHistory;
  }

  push(snapshot: HistorySnapshot): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): HistorySnapshot | null {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return null;
    this.redoStack.push(snapshot);
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  redo(): HistorySnapshot | null {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return null;
    this.undoStack.push(snapshot);
    return snapshot;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getCurrent(): HistorySnapshot | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }
}
