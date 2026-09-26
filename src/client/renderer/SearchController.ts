import type { Core } from 'cytoscape';
import { parseSearchQuery, matchSearchQuery, fuzzyMatch } from '../../shared/searchUtils.ts';
import { Trie } from '../../shared/Trie.ts';

interface RawNodeInfo {
  id: string;
  label: string;
  parentId?: string;
  filePath?: string;
  properties?: Record<string, unknown>;
}

export class SearchController {
  private cy: Core;
  private rawNodesMap: Map<string, RawNodeInfo>;
  private rawToVisibleMap: Map<string, string>;
  private trie: Trie = new Trie();
  private trieBuilt: boolean = false;

  constructor(
    cy: Core,
    rawNodesMap: Map<string, RawNodeInfo>,
    rawToVisibleMap: Map<string, string>,
  ) {
    this.cy = cy;
    this.rawNodesMap = rawNodesMap;
    this.rawToVisibleMap = rawToVisibleMap;
  }

  private buildTrieIfNeeded(): void {
    if (this.trieBuilt) return;
    this.trie.clear();
    for (const rawNode of this.rawNodesMap.values()) {
      this.trie.insert(rawNode.label);
    }
    this.trieBuilt = true;
  }

  private isSimplePrefixQuery(query: string): boolean {
    const trimmed = query.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.includes('"') || trimmed.includes('+')) return false;
    if (trimmed.includes(' ')) return false;
    return true;
  }

  private getNodeSearchText(rawNode: RawNodeInfo): string {
    const parts = [rawNode.label];
    if (rawNode.filePath) parts.push(rawNode.filePath);
    if (rawNode.properties) {
      const doc = rawNode.properties.docstring;
      const sig = rawNode.properties.signature;
      if (typeof doc === 'string') parts.push(doc);
      if (typeof sig === 'string') parts.push(sig);
    }
    return parts.join(' ');
  }

  search(query: string): number {
    if (!query) {
      this.cy.nodes().removeClass('search-match');
      return 0;
    }

    const { requiredTerms, optionalTerms, exactPhrase } = parseSearchQuery(query);
    const matcher = (label: string): boolean => matchSearchQuery(label, { requiredTerms, optionalTerms, exactPhrase });

    let matches = 0;
    const matchedCyNodeIds = new Set<string>();

    if (this.isSimplePrefixQuery(query)) {
      this.buildTrieIfNeeded();
      const trieResults = this.trie.search(query.trim());
      if (trieResults.length > 0) {
        const resultSet = new Set(trieResults.map(s => s.toLowerCase()));
        for (const rawNode of this.rawNodesMap.values()) {
          if (resultSet.has(rawNode.label.toLowerCase())) {
            matches++;
            this.mapToVisible(rawNode, matchedCyNodeIds);
          }
        }
      }
    }

    if (matches === 0) {
      for (const rawNode of this.rawNodesMap.values()) {
        const searchText = this.getNodeSearchText(rawNode);
        if (matcher(searchText) || fuzzyMatch(rawNode.label.toLowerCase(), query.trim().toLowerCase())) {
          matches++;
          this.mapToVisible(rawNode, matchedCyNodeIds);
        }
      }
    }

    if (matches === 0) {
      this.cy.nodes().forEach((node) => {
        const label = node.data('label');
        const filePath = node.data('filePath');
        const searchText = typeof label === 'string' && typeof filePath === 'string'
          ? `${label} ${filePath}`
          : typeof label === 'string' ? label : '';
        if (matcher(searchText)) {
          matchedCyNodeIds.add(node.id());
          matches++;
        }
      });
    }

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        node.toggleClass('search-match', matchedCyNodeIds.has(node.id()));
      });
    });
    return matches;
  }

  private mapToVisible(rawNode: RawNodeInfo, matchedCyNodeIds: Set<string>): void {
    const visibleId = this.rawToVisibleMap.get(rawNode.id);
    if (visibleId) {
      const cyNode = this.cy.getElementById(visibleId);
      if (cyNode.length > 0) {
        matchedCyNodeIds.add(visibleId);
        return;
      }
    }
    let parentId: string | undefined = rawNode.parentId;
    while (parentId) {
      const cyNode = this.cy.getElementById(parentId);
      if (cyNode.length > 0) {
        matchedCyNodeIds.add(parentId);
        break;
      }
      const parentRaw = this.rawNodesMap.get(parentId);
      parentId = parentRaw?.parentId;
    }
  }

  rebuildIndex(): void {
    this.trieBuilt = false;
    this.buildTrieIfNeeded();
  }

  destroy(): void {
    this.cy.nodes().removeClass('search-match');
    this.trie.clear();
    this.trieBuilt = false;
  }
}
