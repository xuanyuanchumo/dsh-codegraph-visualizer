import { useRef, useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { HistoryManager, type HistorySnapshot } from '../history/HistoryManager.ts';

function createSnapshot(): HistorySnapshot {
  const s = useGraphStore.getState();
  return {
    layout: s.layout,
    filterType: s.filterType,
    graphType: s.graphType,
    clusterDepth: s.clusterDepth,
    selectedNodeId: s.selectedNodeId,
    expandedNodeIds: new Set(s.expandedNodeIds),
    viewMode: s.viewMode,
  };
}

function isSameSnapshot(a: HistorySnapshot, b: HistorySnapshot): boolean {
  if (a.layout !== b.layout) return false;
  if (a.filterType !== b.filterType) return false;
  if (a.graphType !== b.graphType) return false;
  if (a.clusterDepth !== b.clusterDepth) return false;
  if (a.selectedNodeId !== b.selectedNodeId) return false;
  if (a.viewMode !== b.viewMode) return false;
  if (a.expandedNodeIds.size !== b.expandedNodeIds.size) return false;
  for (const id of a.expandedNodeIds) {
    if (!b.expandedNodeIds.has(id)) return false;
  }
  return true;
}

function applySnapshot(snapshot: HistorySnapshot): void {
  const s = useGraphStore.getState();
  if (snapshot.viewMode !== s.viewMode) {
    s.setViewMode(snapshot.viewMode);
  }
  if (snapshot.clusterDepth !== s.clusterDepth) {
    s.setClusterDepth(snapshot.clusterDepth);
  }
  if (snapshot.layout !== s.layout) {
    s.setLayout(snapshot.layout);
  }
  if (snapshot.filterType !== s.filterType) {
    s.setFilterType(snapshot.filterType);
  }
  if (snapshot.graphType !== s.graphType) {
    s.setGraphType(snapshot.graphType);
  }
  if (snapshot.selectedNodeId !== s.selectedNodeId) {
    s.setSelectedNode(snapshot.selectedNodeId);
  }
  const currentExpanded = s.expandedNodeIds;
  const sameSize = currentExpanded.size === snapshot.expandedNodeIds.size;
  const sameContent = sameSize && [...snapshot.expandedNodeIds].every((id) => currentExpanded.has(id));
  if (!sameContent) {
    useGraphStore.setState({ expandedNodeIds: snapshot.expandedNodeIds });
    s.setClusterDepth(snapshot.clusterDepth);
  }
}

export function useHistory() {
  const managerRef = useRef<HistoryManager>(new HistoryManager());
  const lastSnapshotRef = useRef<HistorySnapshot | null>(null);
  const isUndoRedoRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateFlags = useCallback(() => {
    setCanUndo(managerRef.current.canUndo());
    setCanRedo(managerRef.current.canRedo());
  }, []);

  const pushHistory = useCallback(() => {
    if (isUndoRedoRef.current) return;
    const snapshot = createSnapshot();
    const last = lastSnapshotRef.current;
    if (last && isSameSnapshot(last, snapshot)) return;
    managerRef.current.push(snapshot);
    lastSnapshotRef.current = snapshot;
    updateFlags();
  }, [updateFlags]);

  const undo = useCallback(() => {
    const prev = managerRef.current.undo();
    if (prev) {
      isUndoRedoRef.current = true;
      applySnapshot(prev);
      lastSnapshotRef.current = prev;
      isUndoRedoRef.current = false;
      updateFlags();
    }
  }, [updateFlags]);

  const redo = useCallback(() => {
    const next = managerRef.current.redo();
    if (next) {
      isUndoRedoRef.current = true;
      applySnapshot(next);
      lastSnapshotRef.current = next;
      isUndoRedoRef.current = false;
      updateFlags();
    }
  }, [updateFlags]);

  useEffect(() => {
    const unsub = useGraphStore.subscribe((state, prevState) => {
      if (
        state.layout !== prevState.layout ||
        state.filterType !== prevState.filterType ||
        state.graphType !== prevState.graphType ||
        state.clusterDepth !== prevState.clusterDepth ||
        state.selectedNodeId !== prevState.selectedNodeId ||
        state.expandedNodeIds !== prevState.expandedNodeIds ||
        state.viewMode !== prevState.viewMode
      ) {
        pushHistory();
      }
    });
    return unsub;
  }, [pushHistory]);

  return { undo, redo, canUndo, canRedo, pushHistory };
}
