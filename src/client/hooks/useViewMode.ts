import { useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import type { ViewMode } from '../../types/index.ts';

import { scoped } from '../../shared/Logger.ts';
import { fetchWithTimeout } from '../api/index.ts';
import { isForeignRepo } from '../../shared/graphScope.ts';

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
  const t = useT();
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
      // P0 跨工作区污染防护：`/dependencies` 按 `?workspace=` 现算，不点名时 host 会回落到它自己
      // 认定的当前工作区（findWorkspacePath），可能与用户在工具栏里选中的 `currentWorkspace` 不是
      // 同一个——那会把 A 的依赖图当作 B 画出来。其它按工作区寻址的接口（bootstrap / outline /
      // edges）都显式带上该参数，这里补齐；`'.'` 是"未指定"的哨兵值，与它们保持一致不发送。
      const requestedWorkspace = currentWorkspace && currentWorkspace !== '.' ? currentWorkspace : undefined;
      const params = new URLSearchParams();
      if (requestedWorkspace) params.set('workspace', requestedWorkspace);
      const qs = params.toString();
      fetchWithTimeout(`/api/v1/codegraph/dependencies${qs ? `?${qs}` : ''}`, { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => {
          if (controller.signal.aborted) return;
          if (!data.nodes || data.nodes.length === 0) return;
          // 兜底：老版本 host 会忽略 `?workspace=` 并返回它自己的工作区。此时负载的 repoId 与本次
          // 请求点名的工作区不同源，直接丢弃（不回退全量：外来负载不携带当前工作区信息，回退也是错的）。
          if (isForeignRepo(data.metadata?.repoId, requestedWorkspace)) {
            log.info('dependency graph ignored for another workspace', {
              repoId: data.metadata?.repoId, requestedWorkspace, activeWorkspace: currentWorkspace,
            });
            return;
          }
          setViewMode(newMode);
          // 兜底标签：`requestedWorkspace` 由 `currentWorkspace` 派生（未指定时才是 undefined），因此
          // `requestedWorkspace || currentWorkspace` 恒等于 `currentWorkspace`，写出来只为标明"标签
          // 来自本次请求点名的工作区"这一来源，不构成行为差异——真正的防护是上面的守卫与 URL 参数。
          setGraphData(data.nodes, data.edges, data.metadata?.repoId || requestedWorkspace || currentWorkspace);
        })
        .catch(() => { if (!controller.signal.aborted) setError(t('error.loadDependencies')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    } else if (newMode === 'code') {
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
      setLoading(true);
      const loadBootstrap = useGraphStore.getState().loadBootstrap;
      loadBootstrap().then((ok) => {
        if (ok) {
          setViewMode(newMode);
        } else {
          setError(t('error.loadGraphData'));
        }
        setLoading(false);
      }).catch((e) => {
        log.warn('loadBootstrap failed', e);
        setError(t('error.loadGraph'));
        setLoading(false);
      });
    } else if (['inheritance', 'callgraph', 'package', 'class'].includes(newMode)) {
      // 宏视图数据拉取（cycle-125 补遗）：bootstrap 只回顶层骨架（file/module/import），
      // rawNodes 里没有 class/interface 节点 ⇒ 继承等宏视图组装出 0 节点空态。
      // 与 dependencies 同款守卫：/data 全量拉取 + 身份守卫 + abort。
      depsFetchAbortRef.current?.abort();
      setGraphType('all');
      setFilterType('all');
      setLoading(true);
      const controller = new AbortController();
      depsFetchAbortRef.current = controller;
      const requestedWorkspace = currentWorkspace && currentWorkspace !== '.' ? currentWorkspace : undefined;
      const params = new URLSearchParams();
      if (requestedWorkspace) params.set('workspace', requestedWorkspace);
      const qs = params.toString();
      fetchWithTimeout(`/api/v1/codegraph/data${qs ? `?${qs}` : ''}`, { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => {
          if (controller.signal.aborted) return;
          // 身份守卫（P0 同款）：外来负载不回退全量。
          if (isForeignRepo(data.metadata?.repoId, requestedWorkspace)) {
            log.info('macro view graph ignored for another workspace', {
              repoId: data.metadata?.repoId, requestedWorkspace, activeWorkspace: currentWorkspace,
            });
            return;
          }
          if (!data.nodes || data.nodes.length === 0) return;
          setViewMode(newMode);
          setGraphData(data.nodes, data.edges, data.metadata?.repoId || requestedWorkspace || currentWorkspace);
        })
        .catch(() => { if (!controller.signal.aborted) setError(t('error.loadGraphData')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
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