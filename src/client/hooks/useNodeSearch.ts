import { useMemo, useCallback } from 'react';
import { Trie } from '../../shared/Trie.ts';
import { parseSearchQuery, matchSearchQuery } from '../../shared/searchUtils.ts';


interface RawNodeLike {
  id: string;
  label: string;
  type: string;
  filePath?: string;
}

function isSimplePrefixQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes('"') || trimmed.includes('+')) return false;
  if (trimmed.includes(' ')) return false;
  return true;
}

export function useNodeSearch<T extends RawNodeLike>(rawNodes: T[]) {
  const trie = useMemo(() => {
    const t = new Trie();
    for (const node of rawNodes) {
      t.insert(node.label, node.id);
    }
    return t;
  }, [rawNodes]);

  const search = useCallback((query: string, limit: number = 50): T[] => {
    if (!query.trim()) return [];

    if (isSimplePrefixQuery(query)) {
      const trieResults = trie.search(query.trim());
      if (trieResults.length > 0) {
        const idSet = new Set(trieResults);
        const matched: T[] = [];
        for (const node of rawNodes) {
          if (idSet.has(node.id)) {
            matched.push(node);
            if (matched.length >= limit) break;
          }
        }
        return matched;
      }
    }

    const parsed = parseSearchQuery(query);
    return rawNodes
      .filter((n) => matchSearchQuery(n.label, parsed))
      .slice(0, limit);
  }, [trie, rawNodes]);

  return { search, trie };
}