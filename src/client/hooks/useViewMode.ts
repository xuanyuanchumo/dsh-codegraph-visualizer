import { useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import type { ViewMode } from '../../types/index.ts';
import { fetchGraphData } from '../api/index.ts';


export function useViewMode(
  viewMode: ViewMode,
  currentWorkspace: string,
  depsFetchAbortRef: React.RefObject<AbortController | null>,
) {
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const setLoading = useGraphStore((s) => s.setLoading);
  const setGraphData = useGraphStore((s) => s.setGraphData);
  const setError = useGraphStore((s) => s.setError);
  const setGraphType = useGraphStore((s) => s.setGraphType);
  const setFilterType = useGraphStore((s) => s.setFilterType);
  const setSelectedFunction = useGraphStore((s) => s.setSelectedFunction);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const setHighlightedNodes = useGraphStore((s) => s.setHighlightedNodes);
  const prevMacroViewModeRef = useRef<ViewMode>('code');

  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    if (newMode === viewMode) return;

    setSelectedNode(null);
    setHighlightedNodes([]);

    if (newMode === 'dependencies') {
      setGraphType('dependency');
      setFilterType('all');
      setLoading(true);
      const controller = new AbortController();
      depsFetchAbortRef.current?.abort();
      depsFetchAbortRef.current = controller;
      fetch('/api/v1/codegraph/dependencies', { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.nodes && data.nodes.length > 0) {
            setViewMode(newMode);
            setGraphData(data.nodes, data.edges, data.metadata?.repoId || currentWorkspace);
          }
        })
        .catch(() => { if (!controller.signal.aborted) setError('Error'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    } else if (newMode === 'code') {
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
      setLoading(true);
      fetchGraphData().then((data) => {
        if (data) {
          setViewMode(newMode);
          setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata);
        }
        setLoading(false);
      }).catch(() => { setLoading(false); });
    } else {
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
      setViewMode(newMode);
    }
  }, [viewMode, setViewMode, setLoading, setGraphData, setError, currentWorkspace, setGraphType, setFilterType, setSelectedNode, setHighlightedNodes]);

  const handleSelectFunction = useCallback((nodeId: string, filePath: string, functionName: string, mode: 'cfg' | 'flowchart' | 'sequence') => {
    prevMacroViewModeRef.current = viewMode;
    setSelectedFunction({ nodeId, filePath, functionName });
    setSelectedNode(null);
    setViewMode(mode);
  }, [viewMode, setSelectedFunction, setSelectedNode, setViewMode]);

  const handleCloseMicroView = useCallback(() => {
    setSelectedFunction(null);
    setViewMode(prevMacroViewModeRef.current);
  }, [setSelectedFunction, setViewMode]);

  return { handleViewModeChange, handleSelectFunction, handleCloseMicroView };
}