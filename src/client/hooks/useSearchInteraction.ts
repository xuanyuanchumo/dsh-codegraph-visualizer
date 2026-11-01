import { useMemo, useCallback, useState, useEffect } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { NodeId } from '../../types/index.ts';
import { useDebounce, useNodeSearch } from './index.ts';
import type { SearchResultItem } from '../components/SearchBar.tsx';
import { fetchKeywordQuery } from '../api/keywordQuery.ts';
import { UI } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('panel');

export interface GetDataApi {
  getSelectedNodeData: () => GraphNode | ClusterNode | null;
  getNodeData: (id: string) => GraphNode | ClusterNode | null;
  getEdgeData: (id: string) => GraphEdge | null;
  /** Reveals a node hidden by `hideNode` and centres the viewport on it; `false` when it cannot. */
  revealNode: (id: string) => boolean;
}

interface UseSearchInteractionOpts {
  searchQuery: string;
  rawNodes: GraphNode[];
  setSelectedNode: (id: NodeId | null) => void;
  setSelectedNodeData: (data: GraphNode | ClusterNode | null) => void;
  getDataRef: React.RefObject<GetDataApi | null>;
  setShowSearch: (v: boolean) => void;
}

interface UseSearchInteractionReturn {
  debouncedSearch: string;
  searchResults: SearchResultItem[];
  handleSelectSearchResult: (id: string) => void;
}

export function useSearchInteraction(opts: UseSearchInteractionOpts): UseSearchInteractionReturn {
  const { searchQuery, rawNodes, setSelectedNode, setSelectedNodeData, getDataRef, setShowSearch } = opts;

  const debouncedSearch = useDebounce(searchQuery, UI.SEARCH_DEBOUNCE_MS);
  const { search: searchNodes } = useNodeSearch(rawNodes);

  const searchResults = useMemo<SearchResultItem[]>(() => {
    if (!debouncedSearch) return [];
    return searchNodes(debouncedSearch, 50)
      .map((n) => ({ id: n.id, label: n.label, type: n.type, filePath: n.filePath }));
  }, [debouncedSearch, searchNodes]);

  // cycle-131 · 搜索域扩展：slim 显示层只有前 500 节点，本地匹配在大仓上必然
  // 「无匹配符号」（真机实证：原生索引 14,039 节点里 skillClosure 命中 2 个，
  // 显示层 0 个）。本地未命中时回退 /query 关键词检索（璇玑图索引已覆盖全量），
  // seeds 作为「索引命中」列表补进结果尾部——点击仍走 revealNode（渲染层可见
  // 才高亮；不可见时的 expand 链路是既有展开语义）。
  const [remoteHits, setRemoteHits] = useState<SearchResultItem[]>([]);
  useEffect(() => {
    if (!debouncedSearch || searchResults.length > 0) {
      setRemoteHits([]);
      return;
    }
    const controller = new AbortController();
    fetchKeywordQuery({ q: debouncedSearch, depth: 0 }, controller.signal)
      .then((outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.kind !== 'data') { setRemoteHits([]); return; }
        const hits = (outcome.data.seeds ?? [])
          .slice(0, 12)
          .map((s) => ({ id: s.id, label: s.label, type: 'function' as const, filePath: s.label, remote: true }));
        setRemoteHits(hits);
      })
      .catch(() => { if (!controller.signal.aborted) setRemoteHits([]); });
    return () => controller.abort();
  }, [debouncedSearch, searchResults.length]);

  const mergedResults = useMemo<SearchResultItem[]>(
    () => (searchResults.length > 0 ? searchResults : remoteHits),
    [searchResults, remoteHits],
  );

  const handleSelectSearchResult = useCallback((id: string) => {
    try {
      setSelectedNode(NodeId(id));
      const data = getDataRef.current?.getNodeData(NodeId(id)) ?? null;
      setSelectedNodeData(data);
      // Sourcetrail-style linkage: picking a result must also bring it into view. Without this the
      // selection only changed the detail panel, so a hidden or off-screen hit looked like a no-op.
      const revealed = getDataRef.current?.revealNode(id) ?? false;
      if (!revealed) log.warn('search result is not revealable in the rendered graph', { id });
      setShowSearch(false);
    } catch (err) {
      log.error('handleSelectSearchResult failed', { id, err });
    }
  }, [setSelectedNode, setSelectedNodeData, getDataRef, setShowSearch]);

  return { debouncedSearch, searchResults: mergedResults, handleSelectSearchResult };
}
/**
 * cycle-131 · 搜索域扩展（真机缺口）：slim 显示层只有前 500 节点，本地匹配
 * 在大仓上必然「无匹配符号」。未命中时回退 `/query` 关键词检索（璇玑图索引
 * 已覆盖全量节点）——远程结果只作为「索引命中」提示列表（选中后 expand 链路
 * 会按需拉取子图），不假装成可立即 reveal 的本地结果。
 */
export interface RemoteSearchHit {
  id: string;
  label: string;
  filePath: string;
}
