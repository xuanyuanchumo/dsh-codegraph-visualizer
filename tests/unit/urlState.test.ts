/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseExpandUrl, buildExpandParam, updateUrlExpand, readUrlExpand, restoreExpandedNodeIds, type ParsedExpandState } from '../../src/client/utils/urlState.ts';

function setLocation(url: string) {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: u.href,
      search: u.search,
      origin: u.origin,
      pathname: u.pathname,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      protocol: u.protocol,
      hash: u.hash,
    },
    writable: true,
    configurable: true,
  });
}

describe('urlState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocation('http://localhost:3080/');
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseExpandUrl', () => {
    it('returns empty state for empty search string', () => {
      const result = parseExpandUrl('');
      expect(result).toEqual({ expandedDirs: [], expandedFiles: [], expandedSymbols: [], expandedSubgroups: [] });
    });

    it('returns empty state when no expand param', () => {
      const result = parseExpandUrl('?foo=bar');
      expect(result).toEqual({ expandedDirs: [], expandedFiles: [], expandedSymbols: [], expandedSubgroups: [] });
    });

    it('parses directory expansions with d: prefix', () => {
      const result = parseExpandUrl('?expand=d:src,d:lib');
      expect(result.expandedDirs).toEqual(['src', 'lib']);
      expect(result.expandedFiles).toEqual([]);
      expect(result.expandedSymbols).toEqual([]);
      expect(result.expandedSubgroups).toEqual([]);
    });

    it('parses file expansions with f: prefix', () => {
      const result = parseExpandUrl('?expand=f:main.ts,f:utils.ts');
      expect(result.expandedFiles).toEqual(['main.ts', 'utils.ts']);
    });

    it('parses symbol expansions with s: prefix', () => {
      const result = parseExpandUrl('?expand=s:foo,s:bar');
      expect(result.expandedSymbols).toEqual(['foo', 'bar']);
    });

    it('parses subgroup expansions with g: prefix', () => {
      const result = parseExpandUrl('?expand=g:group1,g:group2');
      expect(result.expandedSubgroups).toEqual(['group1', 'group2']);
    });

    it('parses mixed expansions', () => {
      const result = parseExpandUrl('?expand=d:src,f:main.ts,s:foo,g:group1');
      expect(result.expandedDirs).toEqual(['src']);
      expect(result.expandedFiles).toEqual(['main.ts']);
      expect(result.expandedSymbols).toEqual(['foo']);
      expect(result.expandedSubgroups).toEqual(['group1']);
    });

    it('ignores unknown prefixes', () => {
      const result = parseExpandUrl('?expand=x:unknown,d:src');
      expect(result.expandedDirs).toEqual(['src']);
      expect(result.expandedSymbols).toEqual([]);
    });
  });

  describe('buildExpandParam', () => {
    it('returns empty string for empty set', () => {
      expect(buildExpandParam(new Set())).toBe('');
    });

    it('builds directory expansion from cluster__ IDs', () => {
      const ids = new Set(['cluster__src', 'cluster__lib']);
      const param = buildExpandParam(ids);
      expect(param).toContain('d:src');
      expect(param).toContain('d:lib');
    });

    it('builds file expansion from filecluster__ IDs', () => {
      const ids = new Set(['filecluster__main.ts']);
      const param = buildExpandParam(ids);
      expect(param).toContain('f:main.ts');
    });

    it('builds subgroup expansion from subgroup__ IDs', () => {
      const ids = new Set(['subgroup__group1']);
      const param = buildExpandParam(ids);
      expect(param).toContain('g:group1');
    });

    it('builds symbol expansion from IDs with # or ::', () => {
      const ids = new Set(['main.ts#foo', 'utils::bar']);
      const param = buildExpandParam(ids);
      expect(param).toContain('s:main.ts#foo');
      expect(param).toContain('s:utils::bar');
    });

    it('skips IDs that do not match any category', () => {
      const ids = new Set(['unknown_id', 'cluster__src']);
      const param = buildExpandParam(ids);
      expect(param).toContain('d:src');
      expect(param).not.toContain('unknown_id');
    });

    it('builds mixed expansions', () => {
      const ids = new Set(['cluster__src', 'filecluster__main.ts', 'subgroup__g1', 'main.ts#foo']);
      const param = buildExpandParam(ids);
      expect(param).toContain('d:src');
      expect(param).toContain('f:main.ts');
      expect(param).toContain('g:g1');
      expect(param).toContain('s:main.ts#foo');
    });
  });

  describe('updateUrlExpand', () => {
    it('sets expand param in URL when expandedNodeIds is non-empty', () => {
      setLocation('http://localhost:3080/');
      const ids = new Set(['cluster__src']);
      updateUrlExpand(ids);
      expect(window.history.replaceState).toHaveBeenCalled();
    });

    it('removes expand param from URL when expandedNodeIds is empty', () => {
      setLocation('http://localhost:3080/?expand=d:src');
      updateUrlExpand(new Set());
      expect(window.history.replaceState).toHaveBeenCalled();
    });

    it('trims symbol-level expansions when URL exceeds MAX_URL_LENGTH', () => {
      setLocation('http://localhost:3080/');
      const largeIds = new Set<string>();
      for (let i = 0; i < 200; i++) {
        largeIds.add(`filecluster__file${i}_with_a_very_long_name_to_exceed_url_limit.ts`);
      }
      updateUrlExpand(largeIds);
      expect(window.history.replaceState).toHaveBeenCalled();
    });
  });

  describe('readUrlExpand', () => {
    it('returns empty state when window has no expand param', () => {
      setLocation('http://localhost:3080/');
      const result = readUrlExpand();
      expect(result).toEqual({ expandedDirs: [], expandedFiles: [], expandedSymbols: [], expandedSubgroups: [] });
    });

    it('returns parsed state from URL expand param', () => {
      setLocation('http://localhost:3080/?expand=d:src,f:main.ts');
      const result = readUrlExpand();
      expect(result.expandedDirs).toEqual(['src']);
      expect(result.expandedFiles).toEqual(['main.ts']);
    });
  });

  describe('restoreExpandedNodeIds', () => {
    it('restores directory IDs with cluster__ prefix', () => {
      const parsed: ParsedExpandState = {
        expandedDirs: ['src', 'lib'],
        expandedFiles: [],
        expandedSymbols: [],
        expandedSubgroups: [],
      };
      const ids = restoreExpandedNodeIds(parsed);
      expect(ids.has('cluster__src')).toBe(true);
      expect(ids.has('cluster__lib')).toBe(true);
    });

    it('restores file IDs with filecluster__ prefix', () => {
      const parsed: ParsedExpandState = {
        expandedDirs: [],
        expandedFiles: ['main.ts'],
        expandedSymbols: [],
        expandedSubgroups: [],
      };
      const ids = restoreExpandedNodeIds(parsed);
      expect(ids.has('filecluster__main.ts')).toBe(true);
    });

    it('restores subgroup IDs with subgroup__ prefix', () => {
      const parsed: ParsedExpandState = {
        expandedDirs: [],
        expandedFiles: [],
        expandedSymbols: [],
        expandedSubgroups: ['group1'],
      };
      const ids = restoreExpandedNodeIds(parsed);
      expect(ids.has('subgroup__group1')).toBe(true);
    });

    it('restores symbol IDs without prefix modification', () => {
      const parsed: ParsedExpandState = {
        expandedDirs: [],
        expandedFiles: [],
        expandedSymbols: ['main.ts#foo'],
        expandedSubgroups: [],
      };
      const ids = restoreExpandedNodeIds(parsed);
      expect(ids.has('main.ts#foo')).toBe(true);
    });

    it('restores all types simultaneously', () => {
      const parsed: ParsedExpandState = {
        expandedDirs: ['src'],
        expandedFiles: ['main.ts'],
        expandedSymbols: ['foo'],
        expandedSubgroups: ['g1'],
      };
      const ids = restoreExpandedNodeIds(parsed);
      expect(ids.size).toBe(4);
      expect(ids.has('cluster__src')).toBe(true);
      expect(ids.has('filecluster__main.ts')).toBe(true);
      expect(ids.has('foo')).toBe(true);
      expect(ids.has('subgroup__g1')).toBe(true);
    });

    it('returns empty set for empty parsed state', () => {
      const parsed: ParsedExpandState = {
        expandedDirs: [],
        expandedFiles: [],
        expandedSymbols: [],
        expandedSubgroups: [],
      };
      const ids = restoreExpandedNodeIds(parsed);
      expect(ids.size).toBe(0);
    });
  });

  describe('round-trip: build → parse → restore', () => {
    it('preserves directory expansion through build → parse → restore', () => {
      const originalIds = new Set(['cluster__src']);
      const param = buildExpandParam(originalIds);
      const parsed = parseExpandUrl(`?expand=${param}`);
      const restoredIds = restoreExpandedNodeIds(parsed);
      expect(restoredIds.has('cluster__src')).toBe(true);
    });

    it('preserves file expansion through build → parse → restore', () => {
      const originalIds = new Set(['filecluster__main.ts']);
      const param = buildExpandParam(originalIds);
      const parsed = parseExpandUrl(`?expand=${param}`);
      const restoredIds = restoreExpandedNodeIds(parsed);
      expect(restoredIds.has('filecluster__main.ts')).toBe(true);
    });

    it('preserves subgroup expansion through build → parse → restore', () => {
      const originalIds = new Set(['subgroup__g1']);
      const param = buildExpandParam(originalIds);
      const parsed = parseExpandUrl(`?expand=${param}`);
      const restoredIds = restoreExpandedNodeIds(parsed);
      expect(restoredIds.has('subgroup__g1')).toBe(true);
    });

    it('preserves symbol expansion through build → parse → restore', () => {
      const originalIds = new Set(['main.ts#foo']);
      const param = buildExpandParam(originalIds);
      const parsed = parseExpandUrl(`?expand=${param}`);
      const restoredIds = restoreExpandedNodeIds(parsed);
      expect(restoredIds.has('main.ts#foo')).toBe(true);
    });

    it('preserves all types through build → parse → restore', () => {
      const originalIds = new Set(['cluster__src', 'filecluster__main.ts', 'subgroup__g1', 'main.ts#foo']);
      const param = buildExpandParam(originalIds);
      const parsed = parseExpandUrl(`?expand=${param}`);
      const restoredIds = restoreExpandedNodeIds(parsed);
      expect(restoredIds.has('cluster__src')).toBe(true);
      expect(restoredIds.has('filecluster__main.ts')).toBe(true);
      expect(restoredIds.has('subgroup__g1')).toBe(true);
      expect(restoredIds.has('main.ts#foo')).toBe(true);
    });
  });
});
