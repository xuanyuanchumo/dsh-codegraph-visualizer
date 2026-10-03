import type { Core } from 'cytoscape';
import { parseSearchQuery, matchSearchQuery, fuzzyMatch } from '../../shared/searchUtils.ts';
import { Trie } from '../../shared/Trie.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('search');

interface RawNodeInfo {
  id: string;
  label: string;
  parentId?: string;
  filePath?: string;
  properties?: Record<string, unknown>;
}

const BUILD_CHUNK_SIZE = 200;
const BUILD_CHUNK_DELAY = 16;

type IdleCallbackHandle = number | ReturnType<typeof setTimeout>;
type IdleCallback = (deadline: { timeRemaining: () => number }) => void;

function requestIdleCallbackCompat(cb: IdleCallback): IdleCallbackHandle {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(cb);
  }
  return setTimeout(() => cb({ timeRemaining: () => 50 }), BUILD_CHUNK_DELAY);
}

function cancelIdleCallbackCompat(handle: IdleCallbackHandle): void {
  if (typeof cancelIdleCallback === 'function' && typeof handle === 'number') {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

export class SearchController {
  private cy: Core;
  private rawNodesMap: Map<string, RawNodeInfo>;
  private rawToVisibleMap: Map<string, string>;
  private trie: Trie = new Trie();
  private trieBuilt: boolean = false;
  private indexBuilding: boolean = false;
  private buildHandle: IdleCallbackHandle | null = null;

  constructor(
    cy: Core,
    rawNodesMap: Map<string, RawNodeInfo>,
    rawToVisibleMap: Map<string, string>,
  ) {
    this.cy = cy;
    this.rawNodesMap = rawNodesMap;
    this.rawToVisibleMap = rawToVisibleMap;
  }

  private startAsyncBuild(): void {
    if (this.indexBuilding) return;
    this.indexBuilding = true;
    this.trie.clear();
    const entries = [...this.rawNodesMap.values()];
    let index = 0;

    const processChunk = () => {
      const end = Math.min(index + BUILD_CHUNK_SIZE, entries.length);
      for (let i = index; i < end; i++) {
        const entry = entries[i];
        if (entry) this.trie.insert(entry.label, entry.id);
      }
      index = end;

      if (index < entries.length) {
        this.buildHandle = requestIdleCallbackCompat(processChunk);
      } else {
        this.trieBuilt = true;
        this.indexBuilding = false;
        this.buildHandle = null;
        log.info(`Trie index built: ${entries.length} nodes`);
      }
    };

    processChunk();
  }

  private buildTrieIfNeeded(): void {
    if (this.trieBuilt || this.indexBuilding) return;
    this.startAsyncBuild();
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

    if (this.isSimplePrefixQuery(query) && this.trieBuilt) {
      const trieResults = this.trie.search(query.trim());
      if (trieResults.length > 0) {
        for (const nodeId of trieResults) {
          const rawNode = this.rawNodesMap.get(nodeId);
          if (rawNode) {
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

  addNode(rawNode: RawNodeInfo): void {
    this.rawNodesMap.set(rawNode.id, rawNode);
    if (this.trieBuilt) {
      this.trie.insert(rawNode.label, rawNode.id);
    }
  }

  removeNode(nodeId: string): void {
    this.rawNodesMap.delete(nodeId);
    if (this.trieBuilt) {
      this.trieBuilt = false;
      this.indexBuilding = false;
      this.cancelBuild();
    }
  }

  rebuildIndex(): void {
    this.cancelBuild();
    this.trieBuilt = false;
    this.indexBuilding = false;
    this.buildTrieIfNeeded();
  }

  private cancelBuild(): void {
    if (this.buildHandle !== null) {
      cancelIdleCallbackCompat(this.buildHandle);
      this.buildHandle = null;
    }
  }

  destroy(): void {
    this.cancelBuild();
    this.cy.nodes().removeClass('search-match');
    this.trie.clear();
    this.trieBuilt = false;
    this.indexBuilding = false;
  }
}
