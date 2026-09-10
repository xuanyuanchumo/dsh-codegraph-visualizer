import { useCallback, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import type { LayoutType } from '../store/graphStore.ts';
import type { ViewMode } from '../../types/index.ts';
import { fetchGraphData } from '../api/index.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('panel');

export function useViewMode(
  viewMode: ViewMode,
  layout: LayoutType,
  currentWorkspace: string,
  depsFetchAbortRef: React.RefObject<AbortController | null>,
) {
  const setLayout = useGraphStore((s) => s.setLayout);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const setLoading = useGraphStore((s) => s.setLoading);
  const setGraphData = useGraphStore((s) => s.setGraphData);
  const setError = useGraphStore((s) => s.setError);
  const setGraphType = useGraphStore((s) => s.setGraphType);
  const setFilterType = useGraphStore((s) => s.setFilterType);
  const setSelectedFunction = useGraphStore((s) => s.setSelectedFunction);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const prevLayoutRef = useRef(layout);

  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    if (newMode === viewMode) return;

    const layoutForMode: Record<string, LayoutType> = {
      code: prevLayoutRef.current,
      dependencies: 'dagre',
      inheritance: 'dagre',
      callgraph: 'dagre',
      'package': 'dagre',
      class: 'dagre',
      cfg: 'dagre',
      flowchart: 'dagre',
      sequence: 'dagre',
    };
    setLayout(layoutForMode[newMode] ?? 'cose');

    if (newMode === 'dependencies') {
      prevLayoutRef.current = layout;
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
            setGraphData(data.nodes, data.edges, data.metadata?.repoId || currentWorkspace);
          }
        })
        .catch(() => { if (!controller.signal.aborted) setError('Error'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    } else if (newMode === 'code') {
      prevLayoutRef.current = layout;
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
      setLoading(true);
      fetchGraphData().then((data) => {
        if (data) {
          setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata);
        }
        setLoading(false);
      }).catch(() => { setLoading(false); });
    } else {
      prevLayoutRef.current = layout;
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
    }

    setViewMode(newMode);
  }, [viewMode, setViewMode, setLoading, setGraphData, setError, currentWorkspace, layout, setLayout, setGraphType, setFilterType]);

  const handleSelectFunction = useCallback((nodeId: string, filePath: string, functionName: string, mode: 'cfg' | 'flowchart' | 'sequence') => {
    setSelectedFunction({ nodeId, filePath, functionName });
    setSelectedNode(null);
    setViewMode(mode);
  }, [setSelectedFunction, setSelectedNode, setViewMode]);

  const handleCloseMicroView = useCallback(() => {
    setSelectedFunction(null);
    setViewMode('code');
  }, [setSelectedFunction, setViewMode]);

  return { handleViewModeChange, handleSelectFunction, handleCloseMicroView };
}