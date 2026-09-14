import { useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import type { ViewMode } from '../../types/index.ts';
import { fetchGraphData } from '../api/index.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('viewMode');


const MICRO_MODES: ViewMode[] = ['cfg', 'flowchart', 'sequence'];

function isMicroMode(mode: ViewMode): boolean {
  return MICRO_MODES.includes(mode);
}

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
        .catch((err) => { if (!controller.signal.aborted) setError(`Failed to load dependencies: ${err.message}`); })
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
        } else {
          setError('Failed to load code graph data');
        }
        setLoading(false);
      }).catch((e) => { log.warn('fetchGraphData failed', e); setError(`Failed to load code graph: ${e.message}`); setLoading(false); });
    } else {
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
      if (!isMicroMode(newMode)) {
        setSelectedFunction(null);
      }
      setViewMode(newMode);
    }
  }, [viewMode, setViewMode, setLoading, setGraphData, setError, currentWorkspace, setGraphType, setFilterType, setSelectedNode, setHighlightedNodes, setSelectedFunction]);

  const handleSelectFunction = useCallback((nodeId: string, filePath: string, functionName: string, mode: 'cfg' | 'flowchart' | 'sequence') => {
    if (!isMicroMode(viewMode)) {
      prevMacroViewModeRef.current = viewMode;
    }
    setSelectedFunction({ nodeId, filePath, functionName });
    setSelectedNode(null);
    setViewMode(mode);
  }, [viewMode, setSelectedFunction, setSelectedNode, setViewMode]);

  const handleCloseMicroView = useCallback(() => {
    setSelectedFunction(null);
    const targetMode = prevMacroViewModeRef.current;
    if (isMicroMode(targetMode)) {
      setViewMode('code');
    } else {
      setViewMode(targetMode);
    }
  }, [setSelectedFunction, setViewMode]);

  const handleAggregateCallChain = useCallback((nodeId: string) => {
    if (!isMicroMode(viewMode)) {
      prevMacroViewModeRef.current = viewMode;
    }
    setSelectedFunction(null);
    setSelectedNode(null);
    useGraphStore.getState().assembleMultiFunction(nodeId);
  }, [viewMode, setSelectedFunction, setSelectedNode]);

  return { handleViewModeChange, handleSelectFunction, handleCloseMicroView, handleAggregateCallChain };
}