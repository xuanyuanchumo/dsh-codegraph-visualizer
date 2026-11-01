import { useMemo, useCallback, useState, useEffect } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { NodeId } from '../../types/index.ts';
import { useDebounce, useNodeSearch } from './index.ts';
import type { SearchResultItem } from '../components/SearchBar.tsx';
import { fetchKeywordQuery } from '../api/keywordQuery.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { UI } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('panel');

export interface GetDataApi {
  getSelectedNodeData: () => GraphNode | ClusterNode | null;
  getNodeData: (id: string) => GraphNode | ClusterNode | null;
  getEdgeData: (id: string) => GraphEdge | null;
  /** Reveals a node hidden by `hideNode` and centres the viewport on it; `false` when it cannot. */
  revealNode: (id: string) => boolean;
  /**
   * cycle-133：把一个不在当前显示层的节点（远程索引命中）合并进画布并选中。
   * 只对 remote 命中项调用；本地命中项走既有的 getNodeData + revealNode 路径。
   * 第二参 label 是 /query 的查询词（宿主按 label/filePath 匹配，id 不是匹配维度）。
   */
  revealRemoteNode?: (id: string, label: string) => Promise<boolean>;
}

interface UseSearchInteractionOpts {
  searchQuery: string;
  rawNodes: GraphNode[];
  setSelectedNode: (id: NodeId | null) => void;
  setSelectedNodeData: (data: GraphNode | ClusterNode | null) => void;
  getDataRef: React.RefObject<GetDataApi | null>;
  setShowSearch: (v: boolean) => void;
  /** 结果条目的 remote 标记查询（cycle-133：remote 项点击走 revealRemoteNode 链路）。 */
  isRemoteHit?: (id: string) => boolean;
}

interface UseSearchInteractionReturn {
  debouncedSearch: string;
  searchResults: SearchResultItem[];
  handleSelectSearchResult: (id: string) => void;
}

export function useSearchInteraction(opts: UseSearchInteractionOpts): UseSearchInteractionReturn {
  const { searchQuery, rawNodes, setSelectedNode, setSelectedNodeData, getDataRef, setShowSearch, isRemoteHit } = opts;

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
    // cycle-133：**必须带当前工作区**。缺省时宿主把查询落到「会话默认工作区」
    // （dsh-anic），而画布上显示的是插件自己的工作区——真机实证：搜索
    // sanitizeTypedGraph 回 200 但 seeds 为空（request 无 workspace 参数），
    // 表现就是「索引命中列表永远空」。工作区与画布同源才可能命中同一张图。
    const workspace = useGraphStore.getState().currentWorkspace;
    fetchKeywordQuery(
      { q: debouncedSearch, depth: 0, ...(workspace && workspace !== '.' ? { workspace } : {}) },
      controller.signal,
    )
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
      // cycle-133：remote 命中项不在显示层——走 store 的 revealRemoteNode（拉有界
      // 子图合并进画布再选中），而不是 setSelectedNode 一个渲染层里不存在的 id
      // （那正是「点了没反应」的来源；旧路径的 log.warn 只对开发者可见）。
      if (isRemoteHit?.(id) && getDataRef.current?.revealRemoteNode) {
        setShowSearch(false);
        // 查询词取结果项的 label。**必须查 mergedResults**：remote 命中项只存在于
        // mergedResults（本地 searchResults 零命中时是空数组）——捕获后者会让
        // find 永远落空、label 回退成 id，而 id 不是宿主的匹配维度（E2E 实测：
        // /query?q=n3 返回的载荷不含 n3 之外的相关节点，合并失败）。
        const hitLabel = mergedResults.find((r) => r.id === id)?.label ?? id;
        void getDataRef.current.revealRemoteNode(id, hitLabel).then((ok) => {
          if (!ok) log.warn('remote search hit could not be revealed', { id });
        });
        return;
      }
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
  }, [setSelectedNode, setSelectedNodeData, getDataRef, setShowSearch, isRemoteHit, mergedResults]);

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
