import { useMemo, useCallback } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { NodeId } from '../../types/index.ts';
import { useDebounce, useNodeSearch } from './index.ts';
import type { SearchResultItem } from '../components/SearchBar.tsx';
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

  return { debouncedSearch, searchResults, handleSelectSearchResult };
}