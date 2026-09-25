import { scoped } from '../../shared/Logger.ts';

const log = scoped('url-state');

const MAX_URL_LENGTH = 2000;
const PREFIX_DIR = 'd:';
const PREFIX_FILE = 'f:';
const PREFIX_SYMBOL = 's:';
const PREFIX_SUBGROUP = 'g:';

export interface ParsedExpandState {
  expandedDirs: string[];
  expandedFiles: string[];
  expandedSymbols: string[];
  expandedSubgroups: string[];
}

export function parseExpandUrl(search: string): ParsedExpandState {
  const result: ParsedExpandState = {
    expandedDirs: [],
    expandedFiles: [],
    expandedSymbols: [],
    expandedSubgroups: [],
  };
  if (!search) return result;
  const params = new URLSearchParams(search);
  const expand = params.get('expand');
  if (!expand) return result;
  const parts = expand.split(',');
  for (const part of parts) {
    if (part.startsWith(PREFIX_DIR)) {
      result.expandedDirs.push(part.slice(PREFIX_DIR.length));
    } else if (part.startsWith(PREFIX_FILE)) {
      result.expandedFiles.push(part.slice(PREFIX_FILE.length));
    } else if (part.startsWith(PREFIX_SYMBOL)) {
      result.expandedSymbols.push(part.slice(PREFIX_SYMBOL.length));
    } else if (part.startsWith(PREFIX_SUBGROUP)) {
      result.expandedSubgroups.push(part.slice(PREFIX_SUBGROUP.length));
    }
  }
  return result;
}

function classifyNodeId(nodeId: string): 'dir' | 'file' | 'symbol' | 'subgroup' | 'other' {
  if (nodeId.startsWith('cluster__')) return 'dir';
  if (nodeId.startsWith('filecluster__')) return 'file';
  if (nodeId.startsWith('subgroup__')) return 'subgroup';
  if (nodeId.includes('#') || nodeId.includes('::')) return 'symbol';
  return 'other';
}

export function buildExpandParam(expandedNodeIds: Set<string>): string {
  const parts: string[] = [];
  for (const id of expandedNodeIds) {
    const kind = classifyNodeId(id);
    if (kind === 'dir') {
      const path = id.replace(/^cluster__/, '');
      parts.push(`${PREFIX_DIR}${path}`);
    } else if (kind === 'file') {
      const path = id.replace(/^filecluster__/, '');
      parts.push(`${PREFIX_FILE}${path}`);
    } else if (kind === 'subgroup') {
      const path = id.replace(/^subgroup__/, '');
      parts.push(`${PREFIX_SUBGROUP}${path}`);
    } else if (kind === 'symbol') {
      parts.push(`${PREFIX_SYMBOL}${id}`);
    }
  }
  return parts.join(',');
}

export function updateUrlExpand(expandedNodeIds: Set<string>): void {
  if (typeof window === 'undefined') return;
  const expandParam = buildExpandParam(expandedNodeIds);
  const url = new URL(window.location.href);
  if (expandParam) {
    url.searchParams.set('expand', expandParam);
  } else {
    url.searchParams.delete('expand');
  }
  const urlString = url.toString();
  if (urlString.length > MAX_URL_LENGTH) {
    const trimmed = expandParam.split(',').filter(p => !p.startsWith(PREFIX_SYMBOL));
    url.searchParams.set('expand', trimmed.join(','));
    log.warn('URL too long, trimmed symbol-level expansions');
  }
  window.history.replaceState(null, '', url.toString());
}

export function readUrlExpand(): ParsedExpandState {
  if (typeof window === 'undefined') {
    return { expandedDirs: [], expandedFiles: [], expandedSymbols: [], expandedSubgroups: [] };
  }
  return parseExpandUrl(window.location.search);
}

export function restoreExpandedNodeIds(parsed: ParsedExpandState): Set<string> {
  const ids = new Set<string>();
  for (const dir of parsed.expandedDirs) {
    ids.add(`cluster__${dir}`);
  }
  for (const file of parsed.expandedFiles) {
    ids.add(`filecluster__${file}`);
  }
  for (const subgroup of parsed.expandedSubgroups) {
    ids.add(`subgroup__${subgroup}`);
  }
  for (const symbol of parsed.expandedSymbols) {
    ids.add(symbol);
  }
  return ids;
}