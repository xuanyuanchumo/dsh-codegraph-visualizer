import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchStatus,
  fetchGraphData,
  fetchWorkspace,
  requestScan,
  requestInit,
  requestWatch,
  fetchBootstrap,
  fetchNodeChildren,
  fetchGraphDataIncremental,
  fetchFileOutline,
  fetchSymbolAST,
} from '../../src/client/api/index.ts';

describe('client api', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchStatus', () => {
    it('returns parsed status on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ codegraph: true, lens: false }),
      }) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({ codegraph: true, lens: false });
    });

    it('returns false/false when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({ codegraph: false, lens: false });
    });

    it('returns false/false on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({ codegraph: false, lens: false });
    });
  });

  describe('fetchGraphData', () => {
    it('returns validated graph data on success', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'r1', timestamp: 1, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(1);
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).toBeNull();
    });

    it('returns null when validateGraphData returns null (empty nodes)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [], metadata: {} }),
      }) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).toBeNull();
    });
  });

  describe('fetchWorkspace', () => {
    it('returns parsed workspace on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: '/repo', list: ['a.ts', 'b.ts'] }),
      }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '/repo', list: ['a.ts', 'b.ts'] });
    });

    it('returns defaults when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '.', list: [] });
    });

    it('returns defaults on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '.', list: [] });
    });

    it('fills missing path/list with defaults', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '.', list: [] });
    });
  });

  describe('requestScan', () => {
    it('returns scan result on success', async () => {
      const payload = { success: true, nodes: [], edges: [], metadata: { foo: 'bar' } };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }) as unknown as typeof fetch;
      const result = await requestScan('/repo', 100);
      expect(result).toEqual(payload);
    });

    it('sends POST with path and maxNodes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, nodes: [], edges: [] }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await requestScan('/repo', 50);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/scan', expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/repo', maxNodes: 50 }),
      }));
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await requestScan('/repo');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await requestScan('/repo');
      expect(result).toBeNull();
    });
  });

  describe('requestInit', () => {
    it('returns init result on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'ok' }),
      }) as unknown as typeof fetch;
      const result = await requestInit('/repo');
      expect(result).toEqual({ success: true, message: 'ok' });
    });

    it('sends POST with path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'ok' }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await requestInit('/repo');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/init', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/repo' }),
      }));
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await requestInit('/repo');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await requestInit('/repo');
      expect(result).toBeNull();
    });
  });

  describe('requestWatch', () => {
    it('returns true when response ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
      const result = await requestWatch(true, '/repo');
      expect(result).toBe(true);
    });

    it('returns false when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
      const result = await requestWatch(false, '/repo');
      expect(result).toBe(false);
    });

    it('sends POST with enabled and path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await requestWatch(true, '/repo');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/watch', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enabled: true, path: '/repo' }),
      }));
    });

    it('returns false on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await requestWatch(true, '/repo');
      expect(result).toBe(false);
    });
  });

  describe('fetchBootstrap', () => {
    it('returns parsed bootstrap data on success', async () => {
      const bootstrapData = {
        rootNodes: [{ id: 'r1', label: 'root', type: 'module', filePath: '/', lineNumber: 0, properties: {} }],
        topLevelNodes: [{ id: 't1', label: 'top', type: 'directory', filePath: '/src', lineNumber: 0, properties: {} }],
        topLevelTotal: 1,
        edges: [],
        indexStatus: 'ready',
        metadata: { repoId: 'repo1', timestamp: 123, totalNodeCount: 100, totalEdgeCount: 50 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => bootstrapData,
      }) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).not.toBeNull();
      expect(result!.rootNodes).toHaveLength(1);
      expect(result!.topLevelNodes).toHaveLength(1);
      expect(result!.indexStatus).toBe('ready');
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).toBeNull();
    });

    it('fills missing fields with defaults', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).not.toBeNull();
      expect(result!.rootNodes).toEqual([]);
      expect(result!.topLevelNodes).toEqual([]);
      expect(result!.topLevelTotal).toBe(0);
      expect(result!.indexStatus).toBe('empty');
      expect(result!.metadata).toEqual({ repoId: '', timestamp: 0, totalNodeCount: 0, totalEdgeCount: 0 });
    });
  });

  describe('fetchNodeChildren', () => {
    it('returns parsed children data on success', async () => {
      const childrenData = {
        nodes: [{ id: 'c1', label: 'child', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        cursor: 'next-page',
        total: 10,
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => childrenData,
      }) as unknown as typeof fetch;
      const result = await fetchNodeChildren('node-1');
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(1);
      expect(result!.cursor).toBe('next-page');
      expect(result!.total).toBe(10);
    });

    it('sends request with nodeId and default limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [], cursor: null, total: 0 }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchNodeChildren('node-1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/codegraph/children?'),
        expect.anything(),
      );
      expect(mockFetch.mock.calls[0]![0]).toContain('nodeId=node-1');
      expect(mockFetch.mock.calls[0]![0]).toContain('limit=50');
    });

    it('sends request with cursor and custom limit when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [], cursor: null, total: 0 }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchNodeChildren('node-1', 'cursor-abc', 100);
      expect(mockFetch.mock.calls[0]![0]).toContain('cursor=cursor-abc');
      expect(mockFetch.mock.calls[0]![0]).toContain('limit=100');
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchNodeChildren('node-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchNodeChildren('node-1');
      expect(result).toBeNull();
    });
  });

  describe('fetchGraphDataIncremental', () => {
    it('returns null on 304 Not Modified', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ status: 304, ok: false }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental(123);
      expect(result).toBeNull();
    });

    it('returns validated graph data on success', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'r1', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental(123);
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(1);
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental(123);
      expect(result).toBeNull();
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental(123);
      expect(result).toBeNull();
    });
  });

  describe('fetchFileOutline', () => {
    it('returns parsed outline data on success', async () => {
      const outlineData = {
        symbols: [{ id: 's1', label: 'funcA', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
        edges: [{ id: 'e1', source: 's1', target: 's2', type: 'calls', properties: {} }],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => outlineData,
      }) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).not.toBeNull();
      expect(result!.symbols).toHaveLength(1);
      expect(result!.edges).toHaveLength(1);
    });

    it('encodes nodeId in the URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ symbols: [], edges: [] }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchFileOutline('path/to/file.ts');
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/files/path%2Fto%2Ffile.ts/outline');
    });

    it('fills missing symbols/edges with empty arrays', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).not.toBeNull();
      expect(result!.symbols).toEqual([]);
      expect(result!.edges).toEqual([]);
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).toBeNull();
    });
  });

  describe('fetchSymbolAST', () => {
    it('returns parsed AST data on success', async () => {
      const astData = {
        astNodes: [{ id: 'n1', label: 'node', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
        astEdges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'calls', properties: {} }],
        sourceLines: ['line1', 'line2'],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => astData,
      }) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).not.toBeNull();
      expect(result!.astNodes).toHaveLength(1);
      expect(result!.astEdges).toHaveLength(1);
      expect(result!.sourceLines).toEqual(['line1', 'line2']);
    });

    it('encodes nodeId in the URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ astNodes: [], astEdges: [], sourceLines: [] }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchSymbolAST('sym/with/slashes');
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/symbols/sym%2Fwith%2Fslashes/ast');
    });

    it('fills missing fields with empty arrays', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).not.toBeNull();
      expect(result!.astNodes).toEqual([]);
      expect(result!.astEdges).toEqual([]);
      expect(result!.sourceLines).toEqual([]);
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).toBeNull();
    });
  });
});